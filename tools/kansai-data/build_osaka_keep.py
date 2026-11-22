"""Extract Osaka Castle's surveyed, textured keep from PLATEAU Osaka 2025 (DracoPy, NumPy, pyproj)."""
import io
import json
import struct
from pathlib import Path
from urllib.request import urlopen

import DracoPy
import numpy as np
from PIL import Image
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "public/kansai/landmarks"
TILE = ("https://assets.cms.plateau.reearth.io/assets/8b/99ba46-8479-4392-aecb-bf5e98e23987/"
        "27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27128_chuo-ku_lod3/data/data6.b3dm")
KEEP = "bldg_41117eae-5c12-40c2-8d1a-9461b8db7784"
LON, LAT, HEIGHT = 135.525856, 34.687373, 68.477


def build():
    with urlopen(TILE, timeout=60) as response:
        tile = response.read()
    feature_json, feature_bin, batch_json, batch_bin = struct.unpack_from("<4I", tile, 12)
    start = 28 + feature_json + feature_bin
    batch = json.loads(tile[start:start + batch_json])
    keep_id = batch["gml_id"].index(KEEP)
    start += batch_json + batch_bin
    length = struct.unpack_from("<I", tile, start + 12)[0]
    src = json.loads(tile[start + 20:start + 20 + length])
    data = tile[start + 28 + length:]

    def source_view(index):
        view = src["bufferViews"][index]
        offset = view.get("byteOffset", 0)
        return data[offset:offset + view["byteLength"]]

    lon, lat = np.radians([LON, LAT])
    east = [-np.sin(lon), np.cos(lon), 0]
    north = [-np.sin(lat)*np.cos(lon), -np.sin(lat)*np.sin(lon), np.cos(lat)]
    up = [np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)]
    # glTF axes in the viewer are east, up and south.
    axes = np.array([east, up, -np.array(north)]).T
    anchor = Transformer.from_crs(4979, 4978, always_xy=True).transform(LON, LAT, HEIGHT)
    rtc = np.array(src["extensions"]["CESIUM_RTC"]["center"]) - anchor

    binary = bytearray()
    views, accessors, primitives = [], [], []

    def view(payload):
        binary.extend(bytes(-len(binary) % 4))
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(payload)})
        binary.extend(payload)
        return len(views) - 1

    def accessor(array, kind, position=False):
        floating = np.issubdtype(array.dtype, np.floating)
        raw = array.astype("<f4" if floating else "<u4")
        acc = {"bufferView": view(raw.tobytes()), "componentType": 5126 if floating else 5125,
               "count": len(raw), "type": kind}
        if position:
            acc.update(min=raw.min(axis=0).tolist(), max=raw.max(axis=0).tolist())
        accessors.append(acc)
        return len(accessors) - 1

    for primitive in src["meshes"][0]["primitives"]:
        draco = primitive["extensions"]["KHR_draco_mesh_compression"]
        mesh = DracoPy.decode(source_view(draco["bufferView"]))

        def attribute(name):
            return mesh.get_attribute_by_unique_id(draco["attributes"][name])["data"]

        batch_ids = attribute("_BATCHID").reshape(-1)
        faces = mesh.faces[np.all(batch_ids[mesh.faces] == keep_id, axis=1)]
        if not faces.size:
            continue
        vertices, indices = np.unique(faces, return_inverse=True)

        def ecef(name):
            return attribute(name)[vertices][:, [0, 2, 1]] * [1, -1, 1]

        attributes = {"POSITION": accessor((ecef("POSITION") + rtc) @ axes, "VEC3", True),
                      "NORMAL": accessor(ecef("NORMAL") @ axes, "VEC3")}
        textured = "TEXCOORD_0" in draco["attributes"]
        if textured:
            attributes["TEXCOORD_0"] = accessor(attribute("TEXCOORD_0")[vertices], "VEC2")
        primitives.append({"attributes": attributes, "indices": accessor(indices.flatten(), "SCALAR"),
                           "material": 1 if textured else 0})

    assert any(p["material"] == 1 for p in primitives)
    # Preserve the survey atlas and its UVs. The photograph already includes shadows.
    image = Image.open(io.BytesIO(source_view(src["images"][0]["bufferView"])))
    jpeg = io.BytesIO()
    image.convert("RGB").save(jpeg, "JPEG", quality=94)
    atlas = view(jpeg.getvalue())
    surface = {"metallicFactor": 0, "roughnessFactor": .94}
    texture = {"index": 0}
    doc = {"asset": {"version": "2.0", "copyright": "PLATEAU / Osaka City 2025, CC BY 4.0"},
           "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}], "meshes": [{"primitives": primitives}],
           "materials": [{"pbrMetallicRoughness": surface},
                         {"pbrMetallicRoughness": {**surface, "baseColorTexture": texture},
                          "emissiveTexture": texture, "emissiveFactor": [.15, .15, .15]}],
           "textures": [{"source": 0}], "images": [{"bufferView": atlas, "mimeType": "image/jpeg"}],
           "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(binary)}]}
    text = json.dumps(doc, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    binary.extend(bytes(-len(binary) % 4))
    header = struct.pack("<4sIIII", b"glTF", 2, 28 + len(text) + len(binary), len(text), 0x4E4F534A)
    (OUT / "osaka-keep.glb").write_bytes(header + text + struct.pack("<I4s", len(binary), b"BIN\0") + binary)


if __name__ == "__main__":
    build()
