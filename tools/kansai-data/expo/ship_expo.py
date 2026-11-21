from site_near_v2 import *
from bootstrap import ROOTS
from urllib.parse import urljoin, urlparse
from datautil import readtile
from textures import texsum
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import struct, requests, shutil, sys, argparse

DATASET = "https://www.geospatial.jp/ckan/dataset/plateau-27999-osaka-shi-2025"
TERMS = "https://gic-plateau.s3.ap-northeast-1.amazonaws.com/2025/expo-doc/3d-license/license.pdf"
CREDIT = (
    "2025年大阪・関西万博会場 3D都市モデル（国土交通省都市局・Project PLATEAU）を加工"
)
ROOT = BASE / "delivery"
REFERENCE = BASE / "delivery-proof"
PROFILES = ("central", "balanced", "full", "overview")
CENTRAL = {("bldg", 31), ("bldg", 37), ("bldg", 49), ("bldg", 14), ("bldg", 69)}


def kinddoc(k, profile, partial):
    doc = json.loads((ORIG / k / "tileset.json").read_text())
    modified = {}
    externals = {}
    manifest = {t["content"]["uri"]: t for t in expo_site.leaflist(k)}

    def scan(t):
        cs = t.get("children", [])
        if len(cs) == 1 and cs[0].get("content", {}).get("uri", "").startswith(
            "native/data"
        ):
            n = int(Path(cs[0]["content"]["uri"]).stem[4:])
            record = MD / (k + "-" + str(n) + ".json")
            source = BASE / "source" / k / "data" / ("data" + str(n) + ".b3dm")
            if (
                not partial
                and (
                    profile in ("balanced", "full")
                    or (profile == "central" and (k, n) in CENTRAL)
                )
                and not record.exists()
            ):
                raise ValueError("unfinished source " + str(record))
            use = False
            if record.exists():
                r = json.loads(record.read_text())
                units = r["units"]
                use = bool(units) and (
                    profile == "full"
                    or (profile == "central" and (k, n) in CENTRAL)
                    or (
                        profile == "balanced"
                        and (
                            r["sourceBytes"] >= 3_000_000
                            or r.get("maxSourceImageDim", 0) >= 4096
                        )
                    )
                )
            if use:
                t["children"] = branch(units)
                modified[str(n)] = {
                    a: r[a]
                    for a in (
                        "sourceSha256",
                        "sourceBytes",
                        "sourceTriangles",
                        "maxBarycentricAreaError",
                    )
                }
                modified[str(n)].update(
                    units=len(units), triangles=sum(u["triangles"] for u in units)
                )
            else:
                u = urljoin(ROOTS[k], "data/data" + str(n) + ".b3dm")
                cs[0]["content"]["uri"] = u
                externals[u] = {
                    "bytes": source.stat().st_size,
                    "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                }
            return
        for ch in cs:
            scan(ch)

    scan(doc["root"])
    doc["asset"]["extras"] = {"source": DATASET, "terms": TERMS, "attribution": CREDIT}
    return doc, modified, externals


def write_file(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    os.link(src, dest)


def mapped_b3dm(src, dst, pages, seen, dest, rfile=""):
    a, h, o, g, start = readtile(src)
    changed = False
    # Optional top-level arrays in glTF must be omitted when there are no resources of that type.
    for field in ("images", "textures", "samplers"):
        if g.get(field) == []:
            del g[field]
            changed = True
    for im in g.get("images", []):
        if "uri" not in im:
            continue
        local = (src.parent / im["uri"]).resolve()
        assert local.is_relative_to(DEST.resolve())
        if local not in pages:
            t = texsum(local)
            sha = t["sha256"]
            out = dest / "textures" / (sha + ".ktx2")
            write_file(local, out)
            pages[local] = (out, t)
        out, _ = pages[local]
        uri = "../../textures/" + out.name
        changed |= uri != im["uri"]
        im["uri"] = uri
    if not changed:
        write_file(src, dst)
    else:
        j = json.dumps(g, ensure_ascii=False, separators=(",", ":")).encode()
        j += b" " * ((-len(j)) % 4)
        rem = a[start - 8 :]
        length = 20 + len(j) + len(rem)
        glb = (
            struct.pack("<III", 0x46546C67, 2, length)
            + struct.pack("<II", len(j), 0x4E4F534A)
            + j
            + rem
        )
        head = bytearray(a[:o])
        struct.pack_into("<I", head, 8, o + len(glb))
        dst.parent.mkdir(parents=True, exist_ok=True)
        scratch = dst.with_suffix(".writing")
        scratch.write_bytes(head + glb)
        os.replace(scratch, dst)


def run(profile, partial, headcheck):
    label = profile + ("-preview" if partial else "")
    dest = ROOT / label
    proof = REFERENCE / label
    proof.mkdir(exist_ok=True, parents=True)
    dest.mkdir(exist_ok=True, parents=True)
    paths = set()
    seen = {}
    pages = {}
    sources = {}
    remote = {}
    ref_count = 0
    mapdata = {}
    for k in ("bldg", "frn"):
        doc, modified, externals = kinddoc(k, profile, partial)
        sources[k] = modified
        remote.update(externals)

        def tree(t):
            nonlocal ref_count
            u = t.get("content", {}).get("uri", "")
            if u and not u.startswith("https:"):
                path = (DEST / k / u).resolve()
                assert path.is_relative_to(DEST.resolve())
                dst = dest / k / u
                if dst not in paths:
                    mapped_b3dm(path, dst, pages, seen, dest)
                    paths.add(dst)
                ref_count += 1
            for ch in t.get("children", []):
                tree(ch)

        tree(doc["root"])
        atomic(dest / k / "tileset.json", doc)
        paths.add(dest / k / "tileset.json")
    attribution = dest / "CREDITS.txt"
    attribution.write_text(
        CREDIT + "\n" + DATASET + "\n" + TERMS + "\n", encoding="utf-8"
    )
    paths.add(attribution)
    for p, desc in pages.values():
        paths.add(p)
    actual = {p for p in dest.rglob("*") if p.is_file()}
    # Preview may be refreshed. Refuse to remove unknown files; always publish final versions into an unused profile.
    if paths != actual:
        raise ValueError(
            "package contains "
            + str(len(actual - paths))
            + " stale files; prepare another empty directory"
        )
    inventory = []
    tex = {}
    models = {}
    used = set()
    for p in sorted(paths):
        rel = p.relative_to(dest).as_posix()
        sz = p.stat().st_size
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        inventory.append({"path": rel, "bytes": sz, "sha256": sha})
        if p.suffix == ".ktx2":
            stats = texsum(p)
            assert (
                stats["width"] <= 520 and stats["height"] <= 520 and stats["mips"] >= 1
            )
            tex[rel] = {kk: stats[kk] for kk in ("width", "height", "mips")}
            continue
        if p.suffix != ".b3dm":
            continue
        a, h, o, g, s = readtile(p)
        assert (
            a[o : o + 4] == b"glTF"
            and struct.unpack_from("<I", a, o + 8)[0] == len(a) - o
        )
        fm = json.loads(a[28 : 28 + h[3]])
        expected = fm["BATCH_LENGTH"]
        bt = json.loads(a[28 + h[3] + h[4] : 28 + h[3] + h[4] + h[5]])
        assert all(len(x) == expected for x in bt.values() if isinstance(x, list))
        jobs = []
        for im in g.get("images", []):
            if "uri" not in im:
                continue
            page = (p.parent / im["uri"]).resolve()
            assert page.is_relative_to(dest.resolve()) and page.exists()
            name = page.relative_to(dest.resolve()).as_posix()
            used.add(name)
            jobs.append(name)
        assert all("uri" not in b for b in g["buffers"])
        assert s + g["buffers"][0]["byteLength"] <= len(a)
        maxattr = max(
            [0]
            + [v["byteLength"] for v in g["bufferViews"] if v.get("target") == 34962]
        )
        facecount = sum(
            g["accessors"][p["indices"]]["count"] // 3
            for m in g["meshes"]
            for p in m["primitives"]
        )
        models[rel] = {
            "triangles": facecount,
            "features": expected,
            "maxGpuAttributeBytes": maxattr,
            "pages": jobs,
        }
    assert used == set(tex)
    if headcheck:

        def head(u):
            for i in range(3):
                try:
                    h = requests.head(u, timeout=(12, 28))
                    h.raise_for_status()
                    ln = h.headers.get("Content-Length", "0")
                    n = int(ln)
                    assert n in (0, remote[u]["bytes"]), (u, n)
                    return u, {
                        "status": h.status_code,
                        "bytes": n,
                        "etag": h.headers.get("ETag"),
                    }
                except Exception:
                    if i == 2:
                        raise

        prior = REFERENCE / "overview" / "official-remote-head.json"
        import time

        available = (
            json.loads(prior.read_text())
            if prior.exists() and time.time() - prior.stat().st_mtime < 3600
            else {}
        )
        heads = {
            u: v
            for u, v in available.items()
            if u in remote
            and v["status"] == 200
            and v["bytes"] in (0, remote[u]["bytes"])
        }
        with ThreadPoolExecutor(max_workers=6) as workers:
            heads.update(workers.map(head, sorted(set(remote) - set(heads))))
        atomic(proof / "official-remote-head.json", heads)
    atomic(proof / "sha256.json", inventory)
    atomic(
        proof / "dependencies.json",
        {
            "dataset": DATASET,
            "terms": TERMS,
            "credit": CREDIT,
            "sourceRoots": ROOTS,
            "rewrittenSourceLeaves": sources,
            "unmodifiedRemote": remote,
            "localB3dm": models,
            "localTexturePages": tex,
        },
    )
    totals = {
        suf: {"count": len(aa), "bytes": sum(a["bytes"] for a in aa)}
        for suf in (".json", ".txt", ".b3dm", ".ktx2")
        if (aa := [a for a in inventory if a["path"].endswith(suf)])
    }
    out = {
        "profile": profile,
        "temporaryPartial": partial,
        "files": len(inventory),
        "bytes": sum(a["bytes"] for a in inventory),
        "largest": max(inventory, key=lambda a: a["bytes"]),
        "byExtension": totals,
        "localTileReferences": ref_count,
        "referencedExternalNative": len(remote),
        "transformedNative": sum(len(r) for r in sources.values()),
        "maxPageDimension": max(max(x["width"], x["height"]) for x in tex.values()),
        "sourceHeadersChecked": len(remote) if headcheck else 0,
    }
    atomic(proof / "summary.json", out)
    print(out, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("profile", choices=PROFILES)
    parser.add_argument("--partial", action="store_true")
    parser.add_argument("--head", action="store_true")
    args = parser.parse_args()
    run(args.profile, args.partial, args.head)
