from datautil import *
from textures import lower_priority
from numba import njit
import subprocess, tempfile, DracoPy, math, argparse, os
from PIL import Image


@njit(cache=True)
def render(prj, norm, uv, col, faces, batch, tex, rx, ry, depth, image, feature):
    height, width = depth.shape
    th, tw = tex.shape[:2]
    for face in faces:
        ia, ib, ic = face
        a = prj[ia]
        b = prj[ib]
        c = prj[ic]
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-10:
            continue
        xl = max(0, int(np.floor(min(a[0], b[0], c[0]))))
        xr = min(width - 1, int(np.ceil(max(a[0], b[0], c[0]))))
        yt = max(0, int(np.floor(min(a[1], b[1], c[1]))))
        yb = min(height - 1, int(np.ceil(max(a[1], b[1], c[1]))))
        for y in range(yt, yb + 1):
            for x in range(xl, xr + 1):
                px = x + 0.5
                py = y + 0.5
                u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den
                v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den
                w = 1 - u - v
                if u < 0 or v < 0 or w < 0:
                    continue
                z = u * a[2] + v * b[2] + w * c[2]
                if z <= depth[y, x] + 1e-8:
                    continue
                uu = (u * uv[ia, 0] + v * uv[ib, 0] + w * uv[ic, 0]) * tw - 0.5
                vv = (u * uv[ia, 1] + v * uv[ib, 1] + w * uv[ic, 1]) * th - 0.5
                ix = int(np.floor(uu))
                iy = int(np.floor(vv))
                fx = uu - ix
                fy = vv - iy
                ix0 = (ix % tw) if rx else max(0, min(tw - 1, ix))
                ix1 = ((ix + 1) % tw) if rx else max(0, min(tw - 1, ix + 1))
                iy0 = (iy % th) if ry else max(0, min(th - 1, iy))
                iy1 = ((iy + 1) % th) if ry else max(0, min(th - 1, iy + 1))
                if tex.shape[2] > 3:
                    alpha = (tex[iy0, ix0, 3] * (1 - fx) + tex[iy0, ix1, 3] * fx) * (
                        1 - fy
                    ) + (tex[iy1, ix0, 3] * (1 - fx) + tex[iy1, ix1, 3] * fx) * fy
                    if alpha < 58.65:
                        continue
                depth[y, x] = z
                feature[y, x] = batch[ia]
                normal = u * norm[ia] + v * norm[ib] + w * norm[ic]
                light = 0.58 + 0.42 * abs(
                    (normal[0] * 0.48 + normal[1] * 0.64 + normal[2] * 0.6)
                    / (
                        np.sqrt(
                            normal[0] * normal[0]
                            + normal[1] * normal[1]
                            + normal[2] * normal[2]
                        )
                        + 1e-15
                    )
                )
                for k in range(3):
                    color = u * col[ia, k] + v * col[ib, k] + w * col[ic, k]
                    p = (tex[iy0, ix0, k] * (1 - fx) + tex[iy0, ix1, k] * fx) * (
                        1 - fy
                    ) + (tex[iy1, ix0, k] * (1 - fx) + tex[iy1, ix1, k] * fx) * fy
                    image[y, x, k] = max(0, min(255, round(p * color * light)))


def decoded(tile, optimized, mod, work, mip=0):
    data, h, o, g, s = readtile(tile)
    geo = []
    if optimized:
        rawp = work / "unpacked.bin"
        subprocess.run(
            ["node", str(BASE / "unpack.mjs"), str(tile), str(rawp), str(mod)],
            check=True,
        )
        raw = rawp.read_bytes()

        def accessor(ai):
            a = g["accessors"][ai]
            v = g["bufferViews"][a["bufferView"]]
            n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
            d = np.dtype({5121: "u1", 5123: "<u2", 5126: "<f4"}[a["componentType"]])
            stride = v.get("byteStride", n * d.itemsize)
            return np.ndarray(
                (a["count"], n),
                d,
                raw,
                offset=v.get("byteOffset", 0) + a.get("byteOffset", 0),
                strides=(stride, d.itemsize),
            ).copy()

    for pr in g["meshes"][0]["primitives"]:
        if optimized:
            faces = accessor(pr["indices"]).reshape(-1, 3)
            a = {k: accessor(ai) for k, ai in pr["attributes"].items()}
        else:
            d = pr["extensions"]["KHR_draco_mesh_compression"]
            m = DracoPy.decode(bytes(getview(data, g, s, d["bufferView"])))
            faces = m.faces
            a = {
                k: m.get_attribute_by_unique_id(i)["data"]
                for k, i in d["attributes"].items()
            }
        n = len(a["POSITION"])
        sm = g["materials"][pr["material"]]["pbrMetallicRoughness"]
        attr = sm.get("baseColorTexture")
        tex = None
        wrap = (False, False)
        if attr:
            t = g["textures"][attr["index"]]
            sam = g["samplers"][t["sampler"]]
            wrap = tuple(sam[key] == 10497 for key in ("wrapS", "wrapT"))
            which = "KHR_texture_basisu" if optimized else "EXT_texture_webp"
            im = g["images"][t["extensions"][which]["source"]]
            if optimized:
                page = (tile.parent / im["uri"]).resolve()
                tmp = work / (page.stem + ".png")
                if not tmp.exists():
                    subprocess.run(
                        [
                            str(next((BASE / "tools").rglob("ktx.exe"))),
                            "extract",
                            "--transcode",
                            "rgba8",
                            "--level",
                            str(mip),
                            str(page),
                            str(tmp),
                        ],
                        check=True,
                        stdout=subprocess.DEVNULL,
                    )
                tex = tmp
            else:
                tex = bytes(getview(data, g, s, im["bufferView"]))
        color = np.broadcast_to(
            np.array(sm.get("baseColorFactor", [1, 1, 1, 1])[:3]), (n, 3)
        )
        if "COLOR_0" in a:
            color = color * a["COLOR_0"][:, :3]
        geo.append(
            (
                a["POSITION"],
                a["NORMAL"],
                a.get("TEXCOORD_0", np.zeros((n, 2), np.float32)),
                color,
                faces,
                a["_BATCHID"].reshape(-1),
                tex,
                wrap,
            )
        )
    return geo, np.array(g["extensions"]["CESIUM_RTC"]["center"]), data[12:o]


def camera(vertices, rtc, angle, zoom):
    # glTF y-up axes become the local ECEF-offset axes used by Cesium ModelUtility.
    z = rtc / np.linalg.norm(rtc)
    east = np.cross([0.0, 0.0, 1.0], z)
    east /= np.linalg.norm(east)
    north = np.cross(z, east)
    cy = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])
    towards = np.cos(angle) * east + 0.82 * z + np.sin(angle) * north
    towards /= np.linalg.norm(towards)
    right = np.cross(z, towards)
    right /= np.linalg.norm(right)
    up = np.cross(towards, right)
    basis = np.array([right, -up, towards]) @ cy
    v = vertices @ basis.T
    a = v.min(axis=0)
    b = v.max(axis=0)
    shift = 0.5 * (a + b)
    scale = min(780 / (b[0] - a[0]), 540 / (b[1] - a[1])) * zoom
    return basis, shift, scale


def frame(geo, cam, mip=0):
    basis, shift, scale = cam
    depth = np.full((576, 832), -np.inf)
    ids = np.full(depth.shape, -1, np.int64)
    img = np.full((*depth.shape, 3), 34, np.uint8)
    cache = {}
    for xyz, n, uv, col, faces, fi, texture, wrap in geo:
        p = xyz.astype(np.float64) @ basis.T - shift
        p[:, :2] *= scale
        p[:, :2] += [416, 288]
        if texture is None:
            tx = np.full((1, 1, 3), 255, np.uint8)
        else:
            key = (
                texture
                if isinstance(texture, Path)
                else hashlib.sha256(texture).digest()
            )
            if key not in cache:
                pix = Image.open(
                    texture if isinstance(texture, Path) else io.BytesIO(texture)
                ).convert("RGBA")
                if mip and not isinstance(texture, Path):
                    pix = pix.resize(
                        (max(1, pix.width >> mip), max(1, pix.height >> mip)),
                        Image.Resampling.BOX,
                    )
                cache[key] = np.asarray(pix).copy()
            tx = cache[key]
        render(
            p,
            np.asarray(n, np.float64),
            np.asarray(uv, np.float64),
            np.asarray(col, np.float64),
            faces,
            fi,
            tx,
            *wrap,
            depth,
            img,
            ids,
        )
    return img, depth, ids
