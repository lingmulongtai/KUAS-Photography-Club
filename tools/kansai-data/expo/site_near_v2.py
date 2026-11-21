from spatial import (
    write_model,
    Tile,
    BASE,
    Path,
    json,
    np,
    atomic,
    copy,
    lower_priority,
    native,
    wgs,
)
from concurrent.futures import ProcessPoolExecutor
from spatial import union, REF
import spatial, expo_site, os, hashlib, tempfile, collections

ORIG = BASE / "candidates/expo-managed-surfaces"
DEST = BASE / "candidates/expo-surface-paged"
MD = BASE / "native-reports-v2"


def kd(points, idx, budget):
    if len(idx) <= budget:
        return [idx]
    p = points[idx]
    ax = np.argmax(np.ptp(p[:, :2], axis=0))
    order = np.argsort(p[:, ax], kind="stable")
    mid = len(idx) // 2
    return kd(points, idx[order[:mid]], budget) + kd(points, idx[order[mid:]], budget)


def wire():
    MD.mkdir(exist_ok=True)
    DEST.mkdir(exist_ok=True, parents=True)
    for o in (ORIG, BASE / "candidates/expo-managed-paged"):
        for f in o.rglob("*"):
            if not f.is_file() or f.name == "tileset.json":
                continue
            if o != ORIG and (f.parent.name != "textures" or f.suffix != ".ktx2"):
                continue
            if o == ORIG and f.parent.parent.name == "frn" and f.parent.name == "proxy":
                continue
            expo_site.copyfile(f, DEST / f.relative_to(o))


def runjob(job):
    lower_priority()
    k, n = job
    spatial.SP = DEST
    spatial.TEX = DEST / "textures"
    report = MD / (k + "-" + str(n) + ".json")
    if report.exists():
        return str(report)
    s = Tile(k, n)
    nt = sum(len(f) for m, a, f in s.groups)
    maxim = max([0] + [max(a.shape[:2]) for _, a in s.images.values()])
    size = s.path.stat().st_size
    if nt <= 4096 and maxim <= 512:
        atomic(
            report,
            {
                "kind": k,
                "source": n,
                "sourceTriangles": nt,
                "sourceBytes": size,
                "sourceSha256": hashlib.sha256(s.path.read_bytes()).hexdigest(),
                "units": [],
            },
        )
        return str(report)
    pages = collections.defaultdict(list)
    err = 0.0
    for m, at, fs in s.groups:
        for lo in range(0, len(fs), 16000):
            f = fs[lo : lo + 16000]
            ids, inv = np.unique(f, return_inverse=True)
            a = {key: val[ids] for key, val in at.items()}
            segs, e = native(s, m, a, inv.reshape(-1, 3))
            err = max(err, e)
            for mi, mode, cell, keys, rows in segs:
                pages[(mi, mode, cell, tuple(keys))].append(rows)
    packs = []
    left = []
    for spec, seq in pages.items():
        rows = np.concatenate(seq).reshape(-1, 3, seq[0].shape[1])
        mi, mode, cell, keys = spec
        pos = sum(v for key, v in keys[: [key for key, v in keys].index("POSITION")])
        cen = rows[:, :, pos : pos + 3].mean(1) @ expo_site.ENU
        for ii in kd(cen, np.arange(len(cen)), 3000):
            q = rows[ii].reshape(-1, rows.shape[2])
            rec = (mi, mode, cell, keys, q)
            center = cen[ii].mean(0)
            if len(ii) >= 1500:
                packs.append([rec])
            else:
                left.append((center, rec))
    # Geographic-first consolidation of small same-page pieces. Cross-page groups cap both geometry and texture upload.
    while left:
        center, q = left.pop()
        out = [q]
        tris = len(q[4]) // 3
        if left:
            pos = np.asarray([x[0] for x in left])
            distance = np.linalg.norm(pos - center, axis=1)
            keep = []
            for ix in np.argsort(distance):
                add = left[ix][1]
                count = len(add[4]) // 3
                if count + tris <= 4096 and len(out) < 4:
                    out.append(add)
                    keep.append(ix)
                    tris += count
                if len(out) >= 4:
                    break
            for i in sorted(keep, reverse=True):
                left.pop(i)
        packs.append(out)
    units = []
    for j, p in enumerate(packs):
        u = write_model(s, "fine-" + str(n) + "-" + str(j), p)
        xyz = []
        for _, _, _, keys, rows in p:
            idx = sum(v for _, v in keys[: [key for key, v in keys].index("POSITION")])
            xyz.append(rows[:, idx : idx + 3])
        u["region"] = wgs(np.concatenate(xyz), s.rtc)
        units.append(u)
    atomic(
        report,
        {
            "kind": k,
            "source": n,
            "sourceTriangles": nt,
            "sourceBytes": size,
            "sourceSha256": hashlib.sha256(s.path.read_bytes()).hexdigest(),
            "maxSourceImageDim": maxim,
            "maxBarycentricAreaError": err,
            "units": units,
        },
    )
    return str(report)


def branch(units):
    if len(units) <= 8:
        return [
            {
                "boundingVolume": {"region": u["region"]},
                "refine": "REPLACE",
                "geometricError": 0,
                "content": {"uri": u["uri"]},
            }
            for u in units
        ]
    cen = np.array(
        [[(u["region"][i] + u["region"][i + 2]) * 0.5 for i in (0, 1)] for u in units]
    )
    ax = np.argmax(np.ptp(cen, axis=0))
    order = np.argsort(cen[:, ax])
    clusters = np.array_split(order, 4)
    return [
        {
            "boundingVolume": {"region": union([units[ix]["region"] for ix in ids])},
            "refine": "REPLACE",
            "geometricError": 0.22,
            "children": branch([units[ix] for ix in ids]),
        }
        for ids in clusters
        if len(ids)
    ]


def sync():
    records = []
    for k in ("frn", "bldg"):
        doc = json.loads((ORIG / k / "tileset.json").read_text())

        def walk(t):
            ch = t.get("children", [])
            if len(ch) == 1 and ch[0].get("content", {}).get("uri", "").startswith(
                "native/data"
            ):
                n = int(Path(ch[0]["content"]["uri"]).stem[4:])
                p = MD / (k + "-" + str(n) + ".json")
                if p.exists():
                    rec = json.loads(p.read_text())
                    records.append(rec)
                    if rec["units"]:
                        t["children"] = branch(rec["units"])
                return
            for child in ch:
                walk(child)

        walk(doc["root"])
        atomic(DEST / k / "tileset.json", doc)
    emitted = [u for r in records for u in r["units"]]
    atomic(
        DEST / "native-budget.json",
        {
            "completeSourceLeaves": len(records),
            "convertedSourceLeaves": sum(bool(r["units"]) for r in records),
            "contents": len(emitted),
            "geometryBytes": sum(u["bytes"] for u in emitted),
            "maxAttributeBytes": max([0] + [u["maxAttrUploadBytes"] for u in emitted]),
            "maxTrianglesPerContent": max([0] + [u["triangles"] for u in emitted]),
            "maxReferencedPagesPerContent": max(
                [0] + [len(u["pages"]) for u in emitted]
            ),
        },
    )


if __name__ == "__main__":
    lower_priority()
    wire()
    sync()
    priority = [
        ("bldg", 49),
        ("bldg", 31),
        ("bldg", 37),
        ("bldg", 69),
        ("bldg", 14),
        ("bldg", 67),
        ("bldg", 60),
    ]
    jobs = [
        (k, int(Path(t["content"]["uri"]).stem[4:]))
        for k in ("bldg", "frn")
        for t in expo_site.leaflist(k)
        if k != "frn" or t["content"]["uri"] != "data/data54.b3dm"
    ]
    jobs = sorted(
        jobs, key=lambda a: priority.index(a) if a in priority else len(priority)
    )
    from concurrent.futures import as_completed

    with ProcessPoolExecutor(max_workers=3) as pp:
        futures = {pp.submit(runjob, j): j for j in jobs}
        for ix, ff in enumerate(as_completed(futures)):
            ff.result()
            if ix % 6 == 0:
                sync()
                print("sources", ix + 1, "of", len(jobs), flush=True)
    sync()
    print("complete", len(jobs), flush=True)
