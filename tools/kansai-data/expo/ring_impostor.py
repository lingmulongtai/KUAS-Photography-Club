from spatial import *
from visual_check import render
import shutil

SRC = BASE / "candidates/spatial-ring"
DEST = BASE / "candidates/spatial-ring-native-lod"


def hardlinks():
    for p in SRC.rglob("*"):
        if (
            not p.is_file()
            or p.name in ("manifest.json", "tileset.json")
            or p.name.startswith(("ring-0", "ring-1", "ring-2"))
        ):
            continue
        dst = DEST / p.relative_to(SRC)
        dst.parent.mkdir(exist_ok=True, parents=True)
        if not dst.exists():
            os.link(p, dst)


def bake_ring(s):
    mi, attrs, faces = s.groups[0]
    raw, pix, sm = s.textureinfo(mi)
    pos = attrs["POSITION"]
    up = s.rtc / np.linalg.norm(s.rtc)
    east = np.cross([0.0, 0.0, 1.0], up)
    east /= np.linalg.norm(east)
    north = np.cross(up, east)
    mat = CY.T @ np.array([east, north, up]).T
    enu = pos @ mat
    mid = (enu[:, :2].min(0) + enu[:, :2].max(0)) * 0.5
    xy = enu[:, :2] - mid
    r = np.linalg.norm(xy, axis=1)
    theta = np.arctan2(xy[:, 1], xy[:, 0])
    z = enu[:, 2]
    lo = r.min()
    hi = r.max()
    zlo = z.min()
    zhi = z.max()
    centre = xy[faces].mean(1)
    angles = np.arctan2(centre[:, 1], centre[:, 0])
    samples = attrs["TEXCOORD_0"].astype(np.float64)
    norms = np.tile(np.array([[0.48, 0.64, 0.6]]), (len(pos), 1))
    colors = np.ones((len(pos), 3))
    ids = attrs["_BATCHID"].reshape(-1)
    segments = []
    atlas = np.zeros((512, 512, 4), np.uint8)
    for band in range(8):
        a0 = band * 2 * np.pi / 8
        span = 2 * np.pi / 8
        ac = a0 + span / 2
        local_theta = (theta - ac + np.pi) % (2 * np.pi) - np.pi + span / 2
        delta = (angles - ac + np.pi) % (2 * np.pi) - np.pi
        fs = faces[np.abs(delta) < span * 0.8]
        for plane, (offset, height) in enumerate(((0, 29), (30, 16), (47, 16))):
            yy = band * 64 + offset + 1
            ht = height - 2
            width = 508
            oversample = 3
            primary = r if plane == 0 else z
            low, high = (lo - 0.3, hi + 0.3) if plane == 0 else (zlo - 0.15, zhi + 0.15)
            depthcomp = z if plane == 0 else r if plane == 1 else -r
            coords = np.stack(
                (
                    local_theta / span * width * oversample,
                    (primary - low) / (high - low) * ht * oversample,
                    depthcomp,
                ),
                axis=1,
            )
            depth = np.full((ht * oversample, width * oversample), -np.inf)
            im = np.zeros((*depth.shape, 3), np.uint8)
            feature = np.full(depth.shape, -1, np.int64)
            render(
                coords,
                norms,
                samples,
                colors,
                fs,
                ids,
                pix,
                sm["wrapS"] == 10497,
                sm["wrapT"] == 10497,
                depth,
                im,
                feature,
            )
            rgba = np.dstack((im, np.where(feature >= 0, 255, 0).astype(np.uint8)))
            small = np.asarray(
                Image.fromarray(rgba, "RGBA").resize(
                    (width, ht), Image.Resampling.LANCZOS
                )
            )
            atlas[yy : yy + ht, 2 : 2 + width] = small
            atlas[yy : yy + ht, :2] = small[:, :1]
            atlas[yy : yy + ht, -2:] = small[:, -1:]
            atlas[yy - 1] = atlas[yy]
            atlas[yy + ht] = atlas[yy + ht - 1]

            def at(t, v):
                # Use depth samples from nearby measured surface; only unsupported transparent pixels use a geometric fallback.
                xp = min(depth.shape[1] - 1, int(t * depth.shape[1]))
                yp = min(depth.shape[0] - 1, int(v * depth.shape[0]))
                box = depth[
                    max(0, yp - 3) : min(depth.shape[0], yp + 4),
                    max(0, xp - 5) : min(depth.shape[1], xp + 6),
                ]
                hit = box[np.isfinite(box)]
                preferred = (
                    np.quantile(hit, 0.55)
                    if len(hit)
                    else (
                        float(np.quantile(z, 0.87))
                        if plane == 0
                        else hi
                        if plane == 1
                        else -lo
                    )
                )
                dist = low + v * (high - low)
                ang = a0 + span * t
                rad = dist if plane == 0 else preferred if plane == 1 else -preferred
                h = preferred if plane == 0 else dist
                en = np.array(
                    [mid[0] + rad * np.cos(ang), mid[1] + rad * np.sin(ang), h]
                )
                xyz = en @ mat.T
                return xyz, np.array([(2 + t * width) / 512, (yy + v * ht) / 512])

            tri = []
            ns = 16
            nr = 6 if plane == 0 else 3
            grid = {
                (x, j): at(x / ns, j / nr) for x in range(ns + 1) for j in range(nr + 1)
            }
            for x in range(ns):
                for j in range(nr):
                    ind = [(x, j), (x + 1, j), (x + 1, j + 1), (x, j + 1)]
                    for f in ((0, 1, 2), (0, 2, 3)):
                        row = [grid[ind[h]] for h in f]
                        n = np.cross(row[1][0] - row[0][0], row[2][0] - row[0][0])
                        n /= np.linalg.norm(n) or 1
                        for pt, uv in row:
                            tri.append([*pt, *n, *uv, 0])
            segments.append(np.asarray(tri, np.float32))
    qa = BASE / "qa-spatial"
    qa.mkdir(exist_ok=True)
    Image.fromarray(atlas).save(qa / "ring-impostor-atlas.png")
    tex = DEST / "textures/ring-impostor.ktx2"
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
            str(tex),
            str(qa / "ring-impostor-atlas.png"),
        ],
        check=True,
        capture_output=True,
    )
    out = stripprimitive(s.g)
    out["images"] = [
        {"mimeType": "image/ktx2", "uri": "../../textures/ring-impostor.ktx2"}
    ]
    out["textures"] = [
        {"sampler": 0, "extensions": {"KHR_texture_basisu": {"source": 0}}}
    ]
    out["samplers"] = [
        {"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}
    ]
    out["materials"] = [
        {
            "name": "大屋根リング — measured roof and elevations",
            "doubleSided": True,
            "alphaMode": "MASK",
            "alphaCutoff": 0.23,
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicFactor": 0,
                "roughnessFactor": 0.95,
            },
        }
    ]
    for k in ["extensionsUsed", "extensionsRequired"]:
        out[k].append("KHR_texture_basisu")
    with tempfile.TemporaryDirectory(dir=BASE) as tmp:
        tmp = Path(tmp)
        wr = Writer(out, tmp)
        wr.mesh(
            0,
            np.concatenate(segments),
            [("POSITION", 3), ("NORMAL", 3), ("TEXCOORD_0", 2), ("_BATCHID", 1)],
            TYPE,
        )
        wr.fp.close()
        (tmp / "raw.json").write_text(json.dumps(out))
        (tmp / "prefix.bin").write_bytes(s.prefix)
        subprocess.run(
            [
                "node",
                str(BASE / "packmesh.mjs"),
                str(tmp),
                str(BASE / "tools/meshoptimizer"),
            ],
            check=True,
        )
        dest = DEST / "frn/data/ring-0-0.b3dm"
        os.replace(tmp / "tile.b3dm", dest)
    return {
        "uri": "data/ring-0-0.b3dm",
        "bytes": dest.stat().st_size,
        "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
        "triangles": wr.tris,
        "primitives": len(out["meshes"][0]["primitives"]),
        "maxAttrUploadBytes": wr.maxview,
        "pages": ["../../textures/ring-impostor.ktx2"],
    }


def run():
    import spatial

    lower_priority()
    hardlinks()
    spatial.SP = DEST
    spatial.TEX = DEST / "textures"
    md = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    ring = Tile("frn", 54)
    rec = bake_ring(ring)
    md["nodes"]["ring-0-0"].update(rec)
    md["nodes"]["ring-0-0"]["lodMethod"] = (
        "native source panoramas projected onto measured top/inner/outer surfaces"
    )
    for grade, node, stepsize in [(1, 260, 16), (2, 57, 4)]:
        src = Tile("frn", node)
        src.prefix = ring.prefix
        idx = src.table["gml_id"].index(REF)
        assert np.linalg.norm(src.rtc - ring.rtc) < 0.01
        for mi, attrs, f in src.groups:
            faces = f[attrs["_BATCHID"][f[:, 0], 0] == idx]
            if not len(faces):
                continue
            norm = src.rtc / np.linalg.norm(src.rtc)
            east = np.cross([0.0, 0.0, 1.0], norm)
            east /= np.linalg.norm(east)
            north = np.cross(norm, east)
            local = attrs["POSITION"] @ CY.T @ np.array([east, north]).T
            rpos = ring.groups[0][1]["POSITION"] @ CY.T @ np.array([east, north]).T
            mid = (rpos.min(0) + rpos.max(0)) * 0.5
            cc = local[faces].mean(1) - mid
            sec = (
                np.mod(np.arctan2(cc[:, 1], cc[:, 0]) / (2 * np.pi), 1) * 128
            ).astype(int)
            attrs["_BATCHID"] = np.zeros_like(attrs["_BATCHID"])
            for first in range(0, 128, stepsize):
                ff = faces[(sec >= first) & (sec < first + stepsize)]
                segments, er = native(src, mi, attrs, ff)
                key = "ring-" + str(grade) + "-" + str(first)
                rec = write_model(src, key, segments)
                md["nodes"][key].update(rec)
                md["nodes"][key]["lodMethod"] = (
                    "official " + str(node) + " surface clipped by geographic sector"
                )
                md["nodes"][key]["nativeSourceTriangles"] = len(ff)
                bound = wgs(attrs["POSITION"][ff.ravel()], src.rtc)
                md["nodes"][key]["region"] = union([md["nodes"][key]["region"], bound])
    doc = json.loads((SRC / "frn/tileset.json").read_text())

    def adjust(t):
        k = Path(t.get("content", {}).get("uri", "")).stem
        if k.startswith("ring-"):
            m = md["nodes"][k]
            t["boundingVolume"]["region"] = m["region"]
            t["geometricError"] = [6.0, 1.75, 0.45, 0][m["level"]]
            m["geometricError"] = t["geometricError"]
        for ch in t.get("children", []):
            adjust(ch)

    adjust(doc["root"])
    atomic(DEST / "frn/tileset.json", doc)
    atomic(DEST / "bldg/tileset.json", untouched("bldg"))
    md["textures"] = {
        p.name: {
            "bytes": p.stat().st_size,
            "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
        }
        for p in (DEST / "textures").glob("*.ktx2")
    }
    atomic(DEST / "manifest.json", md)
    print(
        "complete",
        rec["bytes"],
        "root",
        md["nodes"]["ring-0-0"]["bytes"],
        "pages",
        len(md["textures"]),
        flush=True,
    )


if __name__ == "__main__":
    run()
