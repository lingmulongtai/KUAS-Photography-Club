from spatial import *
from visual_check import render
from PIL import Image
import pickle, shutil
from itertools import chain
from collections import defaultdict

OUTSITE = BASE / "candidates/expo-managed"
CACHE = BASE / "proxy-cache"
CACHE.mkdir(exist_ok=True)
RTC = np.array([-3739003.11041409, 3689283.9925919, 3605935.74421618])
UP = RTC / np.linalg.norm(RTC)
EAST = np.cross([0.0, 0.0, 1.0], UP)
EAST /= np.linalg.norm(EAST)
NORTH = np.cross(UP, EAST)
ENU = CY.T @ np.array([EAST, NORTH, UP]).T


def leaflist(k):
    doc = json.loads((BASE / "source" / k / "tileset.json").read_text())
    out = []

    def walk(t):
        if not t.get("children"):
            out.append(t)
        for ch in t.get("children", []):
            walk(ch)

    walk(doc["root"])
    return out


def faces_feature(src, feature):
    groups = []
    for mi, arr, fs in src.groups:
        match = fs[arr["_BATCHID"][fs[:, 0], 0] == feature]
        n = len(match)
        if not n:
            continue
        if n == len(fs):
            ids = slice(None)
        else:
            ids, inv = np.unique(match, return_inverse=True)
            match = inv.reshape(-1, 3)
        points = arr["POSITION"][ids]
        uv = arr.get("TEXCOORD_0")
        col = arr.get("COLOR_0")
        groups.append(
            (
                mi,
                points,
                uv[ids] if uv is not None else np.zeros((len(points), 2), np.float32),
                col[ids] if col is not None else np.ones((len(points), 3), np.float32),
                match,
            )
        )
    return groups


def one(src, index, pid):
    groups = faces_feature(src, index)
    if not groups:
        return
    corners = np.concatenate([g[1] for g in groups])
    shift = (src.rtc - RTC) @ CY
    centre = (corners.min(0) + corners.max(0)) * 0.5
    # PCA orientation for the booth/structure footprint. Complete native vertices remain in the close model.
    xy = (corners[:: max(1, len(corners) // 2500)] - centre) @ ENU
    cov = xy[:, :2].T @ xy[:, :2]
    _, mat = np.linalg.eigh(cov)
    along = mat[:, -1]
    rot = np.array(
        [[along[0], -along[1], 0.0], [along[1], along[0], 0.0], [0.0, 0.0, 1.0]]
    )
    basis = ENU @ rot
    points = (corners - centre) @ basis
    low = points.min(0)
    high = points.max(0)
    d = high - low
    if np.max(d) < 0.08:
        return
    world = wgs(corners, src.rtc)
    ms = []
    for mi, p, uv, col, fs in groups:
        info = src.textureinfo(mi)
        pix = info[1] if info else np.full((1, 1, 3), 255, np.uint8)
        sam = info[2] if info else {"wrapS": 33071, "wrapT": 33071}
        # Photography is baked as albedo. Materials with vertex colours transfer glTF linear colour to sRGB.
        c = np.clip(col, 0, 1).astype(float)
        c = np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
        m = (
            src.g["materials"][mi]
            .get("pbrMetallicRoughness", {})
            .get("baseColorFactor", [1, 1, 1, 1])
        )
        c *= np.array(m[:3])
        ms.append(
            (
                (p - centre) @ basis,
                uv.astype(np.float64),
                np.ascontiguousarray(c),
                fs,
                pix,
                sam,
                np.broadcast_to(np.array([0.48, 0.64, 0.6]), p.shape),
                np.zeros(len(p), np.uint8),
            )
        )
    props = {
        "gml_id": pid,
        "gml:name": str(src.table["attributes"][index].get("gml:name", "") or ""),
        "_xmin": math.degrees(world[0]),
        "_ymin": math.degrees(world[1]),
        "_xmax": math.degrees(world[2]),
        "_ymax": math.degrees(world[3]),
        "sourceTile": "data/data" + str(src.name) + ".b3dm",
        "sourceBatchId": index,
        "representation": "derived survey proxy",
    }
    panels = []
    for ax, ay, ad, sign in (
        (0, 1, 2, 1),
        (0, 2, 1, 1),
        (0, 2, 1, -1),
        (1, 2, 0, 1),
        (1, 2, 0, -1),
    ):
        if d[ax] < 0.04 or d[ay] < 0.04:
            continue
        # One texel is about 1.25m in the overview; preserve a minimum 6 samples across each face.
        w, h = [min(120, max(6, int(math.ceil(d[i] / 1.25)))) for i in (ax, ay)]
        samp = 2
        depth = np.full((h * samp, w * samp), -np.inf)
        image = np.zeros((h * samp, w * samp, 3), np.uint8)
        feat = np.full(depth.shape, -1, np.int64)
        for pos, uv, col, fs, pix, sm, nrm, ids in ms:
            proj = pos[:, [ax, ay, ad]].copy()
            proj[:, 0] = (proj[:, 0] - low[ax]) * (w * samp) / d[ax]
            proj[:, 1] = (proj[:, 1] - low[ay]) * (h * samp) / d[ay]
            proj[:, 2] *= sign
            render(
                proj,
                nrm,
                uv,
                col,
                fs,
                ids,
                pix,
                sm["wrapS"] == 10497,
                sm["wrapT"] == 10497,
                depth,
                image,
                feat,
            )
        mask = feat >= 0
        if not mask.any():
            continue
        rgba = np.dstack((image, np.where(mask, 255, 0).astype(np.uint8)))
        bmp = np.asarray(Image.fromarray(rgba).resize((w, h), Image.Resampling.LANCZOS))
        nx = min(7, max(1, int(np.ceil(d[ax] / 14))))
        ny = min(6, max(1, int(np.ceil(d[ay] / 14))))
        grid = {}
        fallback = np.median(depth[mask])
        normal = np.zeros(3)
        normal[ad] = sign
        glN = normal @ basis.T
        for i in range(nx + 1):
            for j in range(ny + 1):
                x = int(i / nx * (depth.shape[1] - 1))
                y = int(j / ny * (depth.shape[0] - 1))
                win = depth[max(0, y - 3) : y + 4, max(0, x - 3) : x + 4]
                finite = win[np.isfinite(win)]
                pos = np.zeros(3)
                pos[ax] = low[ax] + i / nx * d[ax]
                pos[ay] = low[ay] + j / ny * d[ay]
                pos[ad] = sign * (np.median(finite) if len(finite) else fallback)
                grid[i, j] = np.array(
                    [*(pos @ basis.T + centre + shift), *glN, i / nx, j / ny],
                    np.float32,
                )
        tri = []
        for i in range(nx):
            for j in range(ny):
                for a in [
                    (i, j),
                    (i + 1, j),
                    (i + 1, j + 1),
                    (i, j),
                    (i + 1, j + 1),
                    (i, j + 1),
                ]:
                    tri.append(grid[a])
        panels.append((bmp, np.asarray(tri, np.float32)))
    return {"id": pid, "metadata": props, "panels": panels, "region": world}


def make_proxy(k, t):
    n = int(Path(t["content"]["uri"]).stem[4:])
    p = CACHE / (k + "-" + str(n) + ".pkl")
    if p.exists():
        return p
    src = Tile(k, n)
    items = []
    for i, pid in enumerate(src.table["gml_id"]):
        if k == "frn" and pid == REF:
            continue
        item = one(src, i, pid)
        if item:
            items.append(item)
    with p.open("wb") as f:
        pickle.dump(
            {
                "kind": k,
                "source": n,
                "items": items,
                "region": t["boundingVolume"]["region"],
            },
            f,
            protocol=5,
        )
    return p


def atlas(leaves, k, dest):
    panels = []
    for l in leaves:
        for it in l["items"]:
            for i, (bmp, tri) in enumerate(it["panels"]):
                panels.append((it, i, bmp, tri))
    panels.sort(key=lambda p: max(p[2].shape[:2]), reverse=True)
    pages = []
    margin = 2
    for it, i, bmp, tri in panels:
        h, w = bmp.shape[:2]
        tw = w + 2 * margin
        th = h + 2 * margin
        for pg in pages:
            if pg["x"] + tw > 512 and pg["y"] + pg["row"] + th <= 512:
                pg["y"] += pg["row"]
                pg["row"] = 0
                pg["x"] = 0
            if pg["x"] + tw <= 512 and pg["y"] + th <= 512:
                break
        else:
            pg = {
                "pixels": np.zeros((512, 512, 4), np.uint8),
                "x": 0,
                "y": 0,
                "row": 0,
                "index": len(pages),
            }
            pages.append(pg)
        x, y = pg["x"] + margin, pg["y"] + margin
        pg["pixels"][y - margin : y + h + margin, x - margin : x + w + margin] = np.pad(
            bmp, ((margin, margin), (margin, margin), (0, 0)), mode="edge"
        )
        tri[:, 6:8] = (tri[:, 6:8] * [w, h] + [x, y]) / 512
        it["panels"][i] = (pg["index"], tri)
        pg["x"] += tw
        pg["row"] = max(pg["row"], th)
    for pg in pages:
        out = dest / "textures" / (k + "-overview-" + str(pg["index"]) + ".ktx2")
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=BASE) as d:
            fn = Path(d) / "atlas.png"
            Image.fromarray(pg["pixels"]).save(fn)
            subprocess.run(
                [
                    str(TOKTX),
                    "--t2",
                    "--genmipmap",
                    "--encode",
                    "uastc",
                    "--uastc_quality",
                    "1",
                    "--zcmp",
                    "9",
                    "--threads",
                    "1",
                    str(out),
                    str(fn),
                ],
                check=True,
                capture_output=True,
            )
    return len(pages)


def prefix(items):
    def padded(raw, start):
        return raw + b" " * (-(start + len(raw)) % 8)

    ft = padded(json.dumps({"BATCH_LENGTH": len(items)}).encode(), 28)
    props = {
        key: [v["metadata"].get(key) for v in items]
        for key in sorted({key for o in items for key in o["metadata"]})
    }
    bt = padded(
        json.dumps(props, separators=(",", ":"), ensure_ascii=False).encode(),
        28 + len(ft),
    )
    return struct.pack("<4s6I", b"b3dm", 1, 0, len(ft), 0, len(bt), 0) + ft + bt


def write_proxy(k, name, items, dest):
    assert len(items) <= 255 and items
    groups = defaultdict(list)
    for j, it in enumerate(items):
        for pi, rows in it["panels"]:
            groups[pi].append(
                np.column_stack((rows, np.full(len(rows), j, np.float32)))
            )
    if not groups:
        return None
    out = {
        "asset": {"version": "2.0", "generator": "KUAS photo club Expo study"},
        "images": [],
        "samplers": [
            {"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}
        ],
        "textures": [],
        "materials": [],
        "accessors": [],
        "bufferViews": [],
        "buffers": [],
        "meshes": [{"primitives": []}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
        "extensionsUsed": [
            "CESIUM_RTC",
            "KHR_texture_basisu",
            "EXT_meshopt_compression",
        ],
        "extensionsRequired": [
            "CESIUM_RTC",
            "KHR_texture_basisu",
            "EXT_meshopt_compression",
        ],
        "extensions": {"CESIUM_RTC": {"center": RTC.tolist()}},
    }
    with tempfile.TemporaryDirectory(dir=BASE) as td:
        tmp = Path(td)
        w = Writer(out, tmp)
        for orig, parts in groups.items():
            m = len(out["materials"])
            out["images"].append(
                {
                    "uri": "../../textures/" + k + "-overview-" + str(orig) + ".ktx2",
                    "mimeType": "image/ktx2",
                }
            )
            out["textures"].append(
                {"sampler": 0, "extensions": {"KHR_texture_basisu": {"source": m}}}
            )
            out["materials"].append(
                {
                    "doubleSided": True,
                    "alphaMode": "MASK",
                    "alphaCutoff": 0.3,
                    "pbrMetallicRoughness": {
                        "baseColorTexture": {"index": m},
                        "metallicFactor": 0,
                        "roughnessFactor": 0.94,
                    },
                }
            )
            w.mesh(
                m,
                np.concatenate(parts),
                [("POSITION", 3), ("NORMAL", 3), ("TEXCOORD_0", 2), ("_BATCHID", 1)],
                TYPE,
            )
        w.fp.close()
        (tmp / "prefix.bin").write_bytes(prefix(items))
        (tmp / "raw.json").write_text(json.dumps(out, separators=(",", ":")))
        subprocess.run(
            [
                "node",
                str(BASE / "packmesh.mjs"),
                str(tmp),
                str(BASE / "tools/meshoptimizer"),
            ],
            check=True,
        )
        file = dest / k / "proxy" / (name + ".b3dm")
        file.parent.mkdir(parents=True, exist_ok=True)
        os.replace(tmp / "tile.b3dm", file)
    return {
        "uri": "proxy/" + file.name,
        "bytes": file.stat().st_size,
        "triangles": w.tris,
        "draws": len(out["meshes"][0]["primitives"]),
        "attrMax": w.maxview,
    }


def regions(leaves, n, cap=185):
    if len(leaves) <= n and sum(len(l["items"]) for l in leaves) <= cap:
        return [leaves]
    cen = np.array(
        [
            [
                (l["region"][0] + l["region"][2]) / 2,
                (l["region"][1] + l["region"][3]) / 2,
            ]
            for l in leaves
        ]
    )
    ax = np.argmax(np.ptp(cen, axis=0))
    order = np.argsort(cen[:, ax])
    mid = len(order) // 2
    return regions([leaves[i] for i in order[:mid]], n, cap) + regions(
        [leaves[i] for i in order[mid:]], n, cap
    )


def copyfile(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        os.link(src, dst)


def build(k):
    leaves = [pickle.load(make_proxy(k, t).open("rb")) for t in leaflist(k)]
    leaves = [l for l in leaves if l["items"]]
    npages = atlas(leaves, k, OUTSITE)
    tree = []
    stats = []
    ids = []
    for j, block in enumerate(regions(leaves, 12 if k == "bldg" else 24)):
        items = [i for l in block for i in l["items"]]
        outer = write_proxy(k, "region-" + str(j), items, OUTSITE)
        assert outer
        big = {
            "boundingVolume": {"region": union([l["region"] for l in block])},
            "refine": "REPLACE",
            "geometricError": 1.35 if k == "bldg" else 0.82,
            "content": {"uri": outer["uri"]},
            "children": [],
        }
        stats.append(outer)
        for l in block:
            k0 = "data" + str(l["source"])
            m = write_proxy(k, "leaf-" + str(l["source"]), l["items"], OUTSITE)
            stats.append(m)
            reg = {"region": l["region"]}
            coarse = {
                "boundingVolume": reg,
                "refine": "REPLACE",
                "geometricError": 0.26 if k == "bldg" else 0.16,
                "content": {"uri": m["uri"]},
                "children": [],
            }
            ids.extend(i["id"] for i in l["items"])
            nativepath = "native/" + k0 + ".b3dm"
            copyfile(
                BASE / "source" / k / "data" / (k0 + ".b3dm"), OUTSITE / k / nativepath
            )
            coarse["children"].append(
                {
                    "boundingVolume": reg,
                    "geometricError": 0,
                    "refine": "REPLACE",
                    "content": {"uri": nativepath},
                }
            )
            big["children"].append(coarse)
        tree.append(big)
    if k == "frn":
        ring = BASE / "candidates/spatial-ring-native-lod"
        rt = json.loads((ring / "frn/tileset.json").read_text())
        branch = rt["root"]["children"][1]
        tree.append(branch)
        ids.append(REF)
        for p in (ring / "frn/data").glob("ring-*.b3dm"):
            copyfile(p, OUTSITE / "frn/data" / p.name)
        for p in (ring / "textures").glob("*.ktx2"):
            copyfile(p, OUTSITE / "textures" / p.name)
    doc = {
        "asset": {"version": "1.0"},
        "geometricError": 50000,
        "root": {
            "boundingVolume": {
                "region": union([t["boundingVolume"]["region"] for t in tree])
            },
            "refine": "ADD",
            "geometricError": 50000,
            "children": tree,
        },
    }
    atomic(OUTSITE / k / "tileset.json", doc)
    assert len(set(ids)) == len(ids)
    record = {
        "features": len(ids),
        "featureIds": sorted(ids),
        "districts": len(tree),
        "sourceLeaves": len(leaves),
        "atlasPages512": npages,
        "localProxyNodes": stats,
        "officialInternalContentsReferenced": 0,
    }
    atomic(OUTSITE / (k + "-audit.json"), record)
    print(k, len(ids), len(tree), npages, sum(a["bytes"] for a in stats), flush=True)


if __name__ == "__main__":
    lower_priority()
    for k in ("bldg", "frn"):
        for ii, t in enumerate(leaflist(k)):
            make_proxy(k, t)
            if ii % 10 == 0:
                print("processed", k, ii, flush=True)
        build(k)
