from datautil import *
from convert import Writer, stripprimitive, atomic
from textures import TOKTX, lower_priority
from clipping import split
from bootstrap import ROOTS
import DracoPy, copy, tempfile, subprocess, os, math, time, traceback
from urllib.parse import urljoin
from collections import defaultdict

SP = BASE / "candidates/spatial-ring"
TEX = SP / "textures"
PG = 512
G = 4
REF = "frn_600e2980-7014-40b6-86eb-396abd0a14b8"
CY = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])
TYPE = {
    k: {"type": t, "componentType": c}
    for k, t, c in [
        ("POSITION", "VEC3", 5126),
        ("NORMAL", "VEC3", 5126),
        ("COLOR_0", "VEC3", 5126),
        ("_BATCHID", "SCALAR", 5121),
        ("TEXCOORD_0", "VEC2", 5126),
    ]
}


class Tile:
    def __init__(self, k, n):
        self.k = k
        self.name = n
        self.path = BASE / "source" / k / "data" / ("data" + str(n) + ".b3dm")
        a, h, o, self.g, s = readtile(self.path)
        self.prefix = a[:o]
        self.rtc = np.array(self.g["extensions"]["CESIUM_RTC"]["center"])
        self.table = json.loads(a[28 + h[3] + h[4] : 28 + h[3] + h[4] + h[5]])
        self.groups = []
        self.images = {}
        for pr in self.g["meshes"][0]["primitives"]:
            e = pr["extensions"]["KHR_draco_mesh_compression"]
            m = DracoPy.decode(bytes(getview(a, self.g, s, e["bufferView"])))
            attrs = {
                k: m.get_attribute_by_unique_id(v)["data"]
                for k, v in e["attributes"].items()
            }
            self.groups.append((pr["material"], attrs, m.faces))
        for i, im in enumerate(self.g.get("images", [])):
            raw = getview(a, self.g, s, im["bufferView"])
            self.images[i] = (
                hashlib.sha256(raw).hexdigest(),
                np.asarray(Image.open(io.BytesIO(raw)).convert("RGB")).copy(),
            )

    def textureinfo(self, mi):
        tx = self.g["materials"][mi]["pbrMetallicRoughness"].get("baseColorTexture")
        if not tx:
            return
        tex = self.g["textures"][tx["index"]]
        ii = tex["extensions"]["EXT_texture_webp"]["source"]
        return *self.images[ii], self.g["samplers"][tex["sampler"]]


def wgs(points, rtc):
    w = points @ CY.T + rtc
    R = 6378137
    e2 = 0.00669437999014
    q = np.hypot(w[:, 0], w[:, 1])
    lat = np.arctan2(w[:, 2], q * (1 - e2))
    for _ in range(4):
        v = R / (1 - e2 * np.sin(lat) ** 2) ** 0.5
        lat = np.arctan2(w[:, 2] + e2 * v * np.sin(lat), q)
    v = R / (1 - e2 * np.sin(lat) ** 2) ** 0.5
    alt = q / np.cos(lat) - v
    lon = np.arctan2(w[:, 1], w[:, 0])
    return [
        lon.min() - 1e-9,
        lat.min() - 1e-9,
        lon.max() + 1e-9,
        lat.max() + 1e-9,
        alt.min() - 0.05,
        alt.max() + 0.05,
    ]


def union(regs):
    return [(min if i in (0, 1, 4) else max)(r[i] for r in regs) for i in range(6)]


def page(raw, pix, sampler, xy):
    h, w, _ = pix.shape
    cw, ch = min(PG, w), min(PG, h)
    g = G if max(w, h) > PG else 0
    x, y = xy
    digest = hashlib.sha256(
        (
            "spatial-v2-etc1s-q240:"
            + raw
            + ":"
            + str((x, y, sampler["wrapS"], sampler["wrapT"]))
        ).encode()
    ).hexdigest()
    dest = TEX / (digest + ".ktx2")
    if not dest.exists():
        ix = np.arange(x * cw - g, (x + 1) * cw + g)
        iy = np.arange(y * ch - g, (y + 1) * ch + g)
        ix = ix % w if sampler["wrapS"] == 10497 else np.clip(ix, 0, w - 1)
        iy = iy % h if sampler["wrapT"] == 10497 else np.clip(iy, 0, h - 1)
        with tempfile.TemporaryDirectory(dir=BASE) as t:
            p = Path(t)
            Image.fromarray(pix[iy[:, None], ix]).save(p / "t.png", compress_level=1)
            subprocess.run(
                [
                    str(TOKTX),
                    "--t2",
                    "--genmipmap",
                    "--encode",
                    "etc1s",
                    "--qlevel",
                    "240",
                    "--clevel",
                    "1",
                    "--threads",
                    "1",
                    str(p / "t.ktx2"),
                    str(p / "t.png"),
                ],
                capture_output=True,
                check=True,
            )
            os.replace(p / "t.ktx2", dest)
    return "../../textures/" + dest.name


def add_material(out, src, mi, info=None, cell=None, proxy=False):
    mat = copy.deepcopy(src.g["materials"][mi])
    p = mat["pbrMetallicRoughness"]
    if proxy:
        p.pop("baseColorTexture", None)
    elif info:
        raw, pix, sampler = info
        u = page(raw, pix, sampler, cell)
        sam = copy.deepcopy(sampler)
        if max(pix.shape[:2]) > PG:
            sam["wrapS"] = sam["wrapT"] = 33071
        im = len(out["images"])
        out["images"].append({"uri": u, "mimeType": "image/ktx2"})
        si = len(out["samplers"])
        out["samplers"].append(sam)
        tx = len(out["textures"])
        out["textures"].append(
            {"sampler": si, "extensions": {"KHR_texture_basisu": {"source": im}}}
        )
        p["baseColorTexture"]["index"] = tx
    ix = len(out["materials"])
    out["materials"].append(mat)
    return ix


def write_model(src, name, segments):
    dest = SP / src.k / "data" / (name + ".b3dm")
    dest.parent.mkdir(exist_ok=True, parents=True)
    with tempfile.TemporaryDirectory(dir=BASE) as td:
        tmp = Path(td)
        out = stripprimitive(src.g)
        writer = Writer(out, tmp)
        md = {}
        for mi, mode, cell, keys, rows in segments:
            if not len(rows):
                continue
            key = (mi, mode, cell)
            if key not in md:
                md[key] = add_material(
                    out,
                    src,
                    mi,
                    src.textureinfo(mi) if mode == "native" else None,
                    cell,
                    mode == "proxy",
                )
            writer.mesh(md[key], rows, keys, TYPE)
        writer.fp.close()
        if not writer.tris:
            return None
        if out["images"]:
            out["extensionsUsed"].append("KHR_texture_basisu")
            out["extensionsRequired"].append("KHR_texture_basisu")
        (tmp / "raw.json").write_text(json.dumps(out, separators=(",", ":")))
        (tmp / "prefix.bin").write_bytes(src.prefix)
        subprocess.run(
            [
                "node",
                str(BASE / "packmesh.mjs"),
                str(tmp),
                str(BASE / "tools/meshoptimizer"),
            ],
            check=True,
        )
        os.replace(tmp / "tile.b3dm", dest)
        return {
            "uri": "data/" + dest.name,
            "bytes": dest.stat().st_size,
            "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
            "triangles": writer.tris,
            "primitives": len(out["meshes"][0]["primitives"]),
            "maxAttrUploadBytes": writer.maxview,
            "pages": [im["uri"] for im in out["images"]],
        }


def native(src, mi, attrs, faces):
    names = list(attrs)
    keys = [(k, attrs[k].shape[1]) for k in names]
    data = np.concatenate([attrs[k] for k in names], axis=1).astype(np.float32)
    tex = src.textureinfo(mi)
    if not tex or max(tex[1].shape[:2]) <= PG:
        return [(mi, "native", (0, 0), keys, data[faces].reshape(-1, data.shape[1]))], 0
    raw, pix, sam = tex
    h, w = pix.shape[:2]
    cw, ch = min(PG, w), min(PG, h)
    nx = w // cw
    ny = h // ch
    i, p, weights, err = split(
        attrs["TEXCOORD_0"].astype(np.float64),
        faces,
        nx,
        ny,
        sam["wrapS"] == 10497,
        sam["wrapT"] == 10497,
    )
    a = data[faces[i, 0]].astype(float)
    b = data[faces[i, 1]].astype(float)
    c = data[faces[i, 2]].astype(float)
    v = (
        a[:, None, :]
        + (b - a)[:, None, :] * weights[:, :, 0, None]
        + (c - a)[:, None, :] * weights[:, :, 1, None]
    )
    slic = {
        k: slice(sum(nn for _, nn in keys[:j]), sum(nn for _, nn in keys[: j + 1]))
        for j, (k, n) in enumerate(keys)
    }
    uv = slic["TEXCOORD_0"]
    v[:, :, uv] = (v[:, :, uv] * [w, h] - p[:, None, :] * [cw, ch] + G) / [
        cw + 2 * G,
        ch + 2 * G,
    ]
    p = p % [nx, ny]
    codes = p[:, 1] * nx + p[:, 0]
    ret = []
    for code in np.unique(codes):
        ret.append(
            (
                mi,
                "native",
                (int(code % nx), int(code // nx)),
                keys,
                np.ascontiguousarray(
                    v[codes == code].reshape(-1, data.shape[1]), np.float32
                ),
            )
        )
    return ret, err


def strip_original(src, ref):
    idx = src.table["gml_id"].index(ref)
    seg = []
    pos = []
    removed = 0
    for mi, attrs, faces in src.groups:
        bid = attrs["_BATCHID"][faces].reshape(-1, 3)
        assert np.all(bid == bid[:, :1])
        rm = bid[:, 0] == idx
        removed += int(rm.sum())
        keep = faces[~rm]
        if len(keep):
            seg += native(src, mi, attrs, keep)[0]
            pos.append(attrs["POSITION"][keep].reshape(-1, 3))
    return (
        write_model(src, "remainder-" + str(src.name), seg) if seg else None,
        wgs(np.concatenate(pos), src.rtc) if pos else None,
        removed,
    )


def proxy(src, group, faces, goal, daemon, tmp):
    mi, attrs, allfaces = group
    f = allfaces[faces]
    points = np.ascontiguousarray(attrs["POSITION"][f].reshape(-1, 3))
    p = tmp / "simp.in"
    q = tmp / "simp.out"
    points.tofile(p)
    daemon.stdin.write(json.dumps([str(p), str(q), goal]) + "\n")
    daemon.stdin.flush()
    profile = json.loads(daemon.stdout.readline())
    if "error" in profile:
        raise ValueError(profile)
    fit = np.fromfile(q, np.uint32)
    fidx = f.reshape(-1)[fit]
    positions = attrs["POSITION"][fidx]
    norm = attrs["NORMAL"][fidx]
    raw, pix, samp = src.textureinfo(mi)
    h, w = pix.shape[:2]
    uv = attrs["TEXCOORD_0"][fidx]
    x = np.clip((uv[:, 0] * w).astype(int), 0, w - 1)
    y = np.clip((uv[:, 1] * h).astype(int), 0, h - 1)
    srgb = pix[y, x] / 255.0
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    rows = np.ascontiguousarray(
        np.column_stack((positions, norm, linear, attrs["_BATCHID"][fidx])),
        dtype=np.float32,
    )
    return (
        mi,
        "proxy",
        None,
        [("POSITION", 3), ("NORMAL", 3), ("COLOR_0", 3), ("_BATCHID", 1)],
        rows,
    ), profile


def untouched(k):
    doc = json.loads((BASE / "source" / k / "tileset.json").read_text())

    def walk(t):
        if "content" in t:
            t["content"]["uri"] = urljoin(ROOTS[k], t["content"]["uri"])
        for c in t.get("children", []):
            walk(c)

    walk(doc["root"])
    return doc


def run():
    lower_priority()
    TEX.mkdir(parents=True, exist_ok=True)
    kind = "frn"
    doc = json.loads((BASE / "source/frn/tileset.json").read_text())
    meta = {}
    pruned = {}
    for n in [260, 57, 56, 55]:
        src = Tile(kind, n)
        r, box, removed = strip_original(src, REF)
        pruned[n] = (r, box)
        meta["remainder-" + str(n)] = {"removedRingTriangles": removed, **r}
    src = Tile(kind, 54)
    assert src.table["gml_id"] == [REF] and len(src.groups) == 1
    group = src.groups[0]
    mi, attrs, faces = group

    def old(t):
        n = int(Path(t["content"]["uri"]).stem[4:])
        children = [
            old(c)
            for c in t.get("children", [])
            if c["content"]["uri"] != "data/data54.b3dm"
        ]
        if children:
            t["children"] = children
        else:
            t.pop("children", None)
        if n in pruned:
            rec, box = pruned[n]
            t["content"] = {"uri": rec["uri"], "boundingVolume": {"region": box}}
            t["boundingVolume"] = {
                "region": union(
                    [box] + [c["boundingVolume"]["region"] for c in children]
                )
            }
        else:
            t["content"]["uri"] = urljoin(ROOTS[kind], t["content"]["uri"])
        return t

    oldtree = old(doc["root"])
    vertices = attrs["POSITION"]
    centre = src.rtc / np.linalg.norm(src.rtc)
    east = np.cross([0.0, 0.0, 1.0], centre)
    east /= np.linalg.norm(east)
    north = np.cross(centre, east)
    local = vertices @ CY.T @ np.array([east, north]).T
    mid = (local.min(0) + local.max(0)) * 0.5
    centroid = local[faces].mean(1) - mid
    # 128 geographic sectors. Assign each whole source triangle to one sector, then include its full extent in that node's bounds.
    sectors = (
        np.mod(np.arctan2(centroid[:, 1], centroid[:, 0]) / (2 * np.pi), 1) * 128
    ).astype(int)
    memberships = np.bincount(sectors, minlength=128)
    assert memberships.sum() == len(faces) and memberships.min() > 0
    child_tree = {}
    with tempfile.TemporaryDirectory(dir=BASE) as td:
        tmp = Path(td)
        daemon = subprocess.Popen(
            ["node", str(BASE / "simp_stream.mjs")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        try:

            def node(first, n, level):
                flag = (sectors >= first) & (sectors < first + n)
                indices = np.flatnonzero(flag)
                fs = faces[indices]
                bbox = wgs(vertices[fs.ravel()], src.rtc)
                name = "ring-" + str(level) + "-" + str(first)
                info = {}
                if n > 1:
                    # Parent geometry uses actual selected vertices. Texture sampling is baked into vertex colours only for distance LOD.
                    goal = [1700, 480, 320][level]
                    segment, info = proxy(src, group, indices, goal, daemon, tmp)
                    rec = write_model(src, name, [segment])
                    splitby = 8 if level == 0 else 4
                    ge = [4.0, 1.25, 0.42][level]
                    t = {
                        "boundingVolume": {"region": bbox},
                        "refine": "REPLACE",
                        "geometricError": ge,
                        "content": {"uri": rec["uri"]},
                    }
                    t["children"] = [
                        node(a, n // splitby, level + 1)
                        for a in range(first, first + n, n // splitby)
                    ]
                else:
                    seg, er = native(src, mi, attrs, fs)
                    rec = write_model(src, name, seg)
                    info = {"perSourceTriangleAreaFractionError": er}
                    t = {
                        "boundingVolume": {"region": bbox},
                        "refine": "REPLACE",
                        "geometricError": 0,
                        "content": {"uri": rec["uri"]},
                    }
                meta[name] = {
                    "firstSector": first,
                    "sectors": n,
                    "sourceTriangles": len(fs),
                    "region": bbox,
                    "level": level,
                    "geometricError": t["geometricError"],
                    "simplifierOrCoverage": info,
                    **rec,
                }
                return t

            ring = node(0, 128, 0)
        finally:
            daemon.stdin.close()
            daemon.wait()
    rootbox = union(
        [oldtree["boundingVolume"]["region"], ring["boundingVolume"]["region"]]
    )
    doc["root"] = {
        "boundingVolume": {"region": rootbox},
        "refine": "ADD",
        "geometricError": 50000,
        "children": [oldtree, ring],
    }
    doc["geometricError"] = 50000
    atomic(SP / "frn/tileset.json", doc)
    atomic(SP / "bldg/tileset.json", untouched("bldg"))
    atomic(
        SP / "manifest.json",
        {
            "source": ROOTS,
            "credit": "2025年大阪・関西万博会場 3D都市モデル（国土交通省都市局・Project PLATEAU）を加工",
            "terms": "https://gic-plateau.s3.ap-northeast-1.amazonaws.com/2025/expo-doc/3d-license/license.pdf",
            "ringId": REF,
            "originalSha256": hashlib.sha256(src.path.read_bytes()).hexdigest(),
            "ringSourceTriangles": len(faces),
            "fineSectorTrianglesBeforeUvSplit": int(memberships.sum()),
            "nodes": meta,
            "textures": {
                p.name: {
                    "bytes": p.stat().st_size,
                    "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                }
                for p in TEX.glob("*.ktx2")
            },
        },
    )
    print(
        "complete",
        len(meta),
        len(list(TEX.glob("*.ktx2"))),
        sum(p.stat().st_size for p in SP.rglob("*.b3dm")),
        flush=True,
    )


if __name__ == "__main__":
    run()
