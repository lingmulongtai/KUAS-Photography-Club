from expo_site import *
import expo_site as es
from pathlib import Path

DEST = BASE / "candidates/expo-managed-surfaces"
ORIG = BASE / "candidates/expo-managed"
PC = BASE / "surface-cache-v1"
PC.mkdir(exist_ok=True)


def build_cache(l, daemon, tmp):
    k = l["kind"]
    n = l["source"]
    cache = PC / (k + "-" + str(n) + ".pkl")
    if cache.exists():
        return pickle.load(cache.open("rb"))
    s = Tile(k, n)
    shift = (s.rtc - RTC) @ CY
    outputs = []
    fat = {it["id"]: it for it in l["items"]}
    for index, pid in enumerate(s.table["gml_id"]):
        if pid not in fat:
            continue
        item = {
            "id": pid,
            "metadata": dict(
                fat[pid]["metadata"], representation="simplified measured surface"
            ),
            "triangles": [],
            "source": 0,
            "maxError": 0.0,
            "maxEdgeOriginal": 0.0,
            "maxEdgeOutput": 0.0,
        }
        for mi, at, fs in s.groups:
            match = fs[at["_BATCHID"][fs[:, 0], 0] == index]
            if not len(match):
                continue
            used, inv = np.unique(match, return_inverse=True)
            points = at["POSITION"][used].astype(np.float32)
            f = inv.reshape(-1, 3).astype(np.uint32)
            item["source"] += len(f)
            normals = at["NORMAL"][used].astype(np.float32)
            pbr = s.g["materials"][mi]["pbrMetallicRoughness"]
            t = s.textureinfo(mi)
            col = np.broadcast_to(
                np.array(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3], float),
                (len(points), 3),
            ).copy()
            if "COLOR_0" in at:
                col0 = at["COLOR_0"][used, :3]
                if np.issubdtype(col0.dtype, np.integer):
                    col0 = col0 / np.iinfo(col0.dtype).max
                col *= col0
            if t:
                raw, pix, samp = t
                im = Image.fromarray(pix)
                im.thumbnail((256, 256), Image.Resampling.LANCZOS)
                pix = np.asarray(im).astype(np.float32) / 255
                h, w = pix.shape[:2]
                uv = at["TEXCOORD_0"][used]
                u = uv[:, 0] * w - 0.5
                v = uv[:, 1] * h - 0.5
                ix = np.floor(u).astype(np.int32)
                iy = np.floor(v).astype(np.int32)
                fu = (u - ix)[:, None]
                fv = (v - iy)[:, None]
                ix0 = ix % w if samp["wrapS"] == 10497 else ix.clip(0, w - 1)
                ix1 = (
                    (ix + 1) % w if samp["wrapS"] == 10497 else (ix + 1).clip(0, w - 1)
                )
                iy0 = iy % h if samp["wrapT"] == 10497 else iy.clip(0, h - 1)
                iy1 = (
                    (iy + 1) % h if samp["wrapT"] == 10497 else (iy + 1).clip(0, h - 1)
                )
                srgb = (pix[iy0, ix0] * (1 - fu) + pix[iy0, ix1] * fu) * (1 - fv) + (
                    pix[iy1, ix0] * (1 - fu) + pix[iy1, ix1] * fu
                ) * fv
                col *= np.where(
                    srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4
                )
            srcEdges = np.linalg.norm(points[f] - points[f[:, [1, 2, 0]]], axis=2)
            item["maxEdgeOriginal"] = max(
                item["maxEdgeOriginal"], float(srcEdges.max())
            )
            if len(f) > 105:
                # Weld identical position only within the same original feature and primitive. Topology-aware edge collapse cannot bridge separate components.
                pos, first, mapping = np.unique(
                    points, axis=0, return_index=True, return_inverse=True
                )
                inp = tmp / "pos"
                idx = tmp / "idx"
                out = tmp / "out"
                np.ascontiguousarray(pos, dtype=np.float32).tofile(inp)
                np.ascontiguousarray(mapping[f], dtype=np.uint32).tofile(idx)
                daemon.stdin.write(
                    json.dumps(
                        [
                            str(inp),
                            str(idx),
                            str(out),
                            max(65, int(len(f) * 0.20)),
                            0.45,
                        ]
                    )
                    + "\n"
                )
                daemon.stdin.flush()
                reply = json.loads(daemon.stdout.readline())
                if "error" in reply:
                    raise ValueError(reply)
                ff = np.fromfile(out, dtype=np.uint32).reshape(-1, 3)
                if len(ff) and len(ff) < len(f):
                    f = first[ff]
                    item["maxError"] = max(item["maxError"], reply["err"])
            edges = np.linalg.norm(points[f] - points[f[:, [1, 2, 0]]], axis=2)
            item["maxEdgeOutput"] = max(item["maxEdgeOutput"], float(edges.max()))
            xyz = (points.astype(float) + shift).astype(np.float32)
            item["triangles"].append(
                np.ascontiguousarray(
                    np.column_stack((xyz, normals, col))[f].reshape(-1, 9),
                    dtype=np.float32,
                )
            )
        if not item["triangles"]:
            raise ValueError((k, n, pid))
        outputs.append(item)
    with cache.open("wb") as f:
        pickle.dump(outputs, f, protocol=5)
    return outputs


def model(k, name, items):
    out = {
        "asset": {
            "version": "2.0",
            "generator": "KUAS photography club Expo surface study",
        },
        "materials": [
            {
                "doubleSided": True,
                "pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": 0.95},
            }
        ],
        "accessors": [],
        "bufferViews": [],
        "buffers": [],
        "meshes": [{"primitives": []}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
        "extensionsUsed": ["CESIUM_RTC", "EXT_meshopt_compression"],
        "extensionsRequired": ["CESIUM_RTC", "EXT_meshopt_compression"],
        "extensions": {"CESIUM_RTC": {"center": RTC.tolist()}},
    }
    rows = []
    for j, it in enumerate(items):
        for v in it["triangles"]:
            rows.append(np.column_stack((v, np.full(len(v), j, np.float32))))
    with tempfile.TemporaryDirectory(dir=BASE) as td:
        tmp = Path(td)
        wr = Writer(out, tmp)
        wr.mesh(
            0,
            np.concatenate(rows),
            [("POSITION", 3), ("NORMAL", 3), ("COLOR_0", 3), ("_BATCHID", 1)],
            TYPE,
        )
        wr.fp.close()
        (tmp / "prefix.bin").write_bytes(prefix(items))
        (tmp / "raw.json").write_text(json.dumps(out))
        subprocess.run(
            [
                "node",
                str(BASE / "packmesh.mjs"),
                str(tmp),
                str(BASE / "tools/meshoptimizer"),
            ],
            check=True,
        )
        dst = DEST / k / "surface" / (name + ".b3dm")
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.replace(tmp / "tile.b3dm", dst)
    return {
        "bytes": dst.stat().st_size,
        "hash": hashlib.sha256(dst.read_bytes()).hexdigest(),
        "triangles": wr.tris,
        "draws": len(out["meshes"][0]["primitives"]),
        "maxAttributeBytes": wr.maxview,
        "uri": "surface/" + dst.name,
    }


def run(k="frn"):
    lower_priority()
    for f in ORIG.rglob("*"):
        if f.is_file() and f.name != "tileset.json":
            copyfile(f, DEST / f.relative_to(ORIG))
    atomic(
        DEST / "bldg/tileset.json", json.loads((ORIG / "bldg/tileset.json").read_text())
    )
    doc = json.loads((ORIG / k / "tileset.json").read_text())
    leaves = [pickle.load(make_proxy(k, t).open("rb")) for t in leaflist(k)]
    leaves = [l for l in leaves if l["items"]]
    lookup = {}
    reports = []
    stats = []
    surf = {}
    with tempfile.TemporaryDirectory(dir=BASE) as temp:
        daemon = subprocess.Popen(
            ["node", str(BASE / "simp_topological.mjs")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            for l in leaves:
                n = l["source"]
                its = build_cache(l, daemon, Path(temp))
                lookup[n] = its
                for it in its:
                    stats.append(
                        {
                            a: b
                            for a, b in it.items()
                            if a not in ("triangles", "metadata")
                        }
                        | {
                            "sourceLeaf": n,
                            "triangles": sum(len(t) // 3 for t in it["triangles"]),
                        }
                    )
        finally:
            daemon.stdin.close()
            daemon.wait()
    for j, block in enumerate(regions(leaves, 12 if k == "bldg" else 24)):
        items = [it for l in block for it in lookup[l["source"]]]
        parent = doc["root"]["children"][j]
        a = model(k, "region-" + str(j), items)
        parent["content"]["uri"] = a["uri"]
        reports.append(a)
        for l, ch in zip(block, parent["children"]):
            n = l["source"]
            rec = model(k, "leaf-" + str(n), lookup[n])
            ch["content"]["uri"] = rec["uri"]
            reports.append(rec)
        print("region", j, "of", len(doc["root"]["children"]), a, flush=True)
    atomic(DEST / k / "tileset.json", doc)
    atomic(
        DEST / (k + "-surfaces.json"),
        {
            "features": stats,
            "contents": reports,
            "method": "source-vertex topological edge collapse with 0.45m geometric error, distinct source feature/primitive/component topology, color baked from native data only, complete original near leaves",
        },
    )
    print("FINISHED", k, len(stats), sum(r["triangles"] for r in stats), flush=True)


if __name__ == "__main__":
    run()
