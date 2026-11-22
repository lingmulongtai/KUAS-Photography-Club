from datautil import *
import os, copy

TRIS = 12000


def atomic(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    t = path.with_suffix(".tmp")
    t.write_text(
        json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    os.replace(t, path)


def stripprimitive(g):
    out = copy.deepcopy(g)
    for name in [
        "accessors",
        "bufferViews",
        "buffers",
        "materials",
        "textures",
        "images",
        "samplers",
    ]:
        out[name] = []
    assert len(out["meshes"]) == 1
    out["meshes"][0]["primitives"] = []
    for n in ("extensionsRequired", "extensionsUsed"):
        out[n] = [
            e
            for e in out.get(n, [])
            if e not in ("KHR_draco_mesh_compression", "EXT_texture_webp")
        ]
        out[n] += ["EXT_meshopt_compression"]
    return out


class Writer:
    def __init__(self, g, tmp):
        self.g = g
        self.tmp = tmp
        self.fp = (tmp / "raw.bin").open("wb")
        self.maxview = 0
        self.maxvertices = 0
        self.tris = 0

    def attribute(self, arr, kind, name, ctype, norm):
        count = len(arr)
        a = np.ascontiguousarray(arr)
        n = 1 if arr.ndim == 1 else arr.shape[1]
        stride = n * a.dtype.itemsize
        idx = name == "indices"
        if not idx and stride % 4:
            pad = np.zeros((count, ((stride + 3) // 4 * 4)), np.uint8)
            pad[:, :stride] = a.view(np.uint8).reshape(count, -1)
            a = pad
            stride = a.shape[1]
        off = self.fp.tell()
        self.fp.write(a.tobytes())
        gap = (-self.fp.tell()) % 4
        self.fp.write(bytes(gap))
        index = len(self.g["bufferViews"])
        view = {
            "buffer": 0,
            "byteOffset": off,
            "byteLength": a.nbytes,
            "target": 34963 if idx else 34962,
            "extras": {
                "count": count,
                "mode": "INDICES" if idx else "ATTRIBUTES",
                "stride": stride,
            },
        }
        if not idx and stride != n * arr.dtype.itemsize:
            view["byteStride"] = stride
        self.g["bufferViews"].append(view)
        acc = {
            "bufferView": index,
            "componentType": ctype,
            "count": count,
            "type": kind,
        }
        if norm:
            acc["normalized"] = True
        if name == "POSITION":
            acc.update(min=arr.min(axis=0).tolist(), max=arr.max(axis=0).tolist())
        self.maxview = max(self.maxview, a.nbytes)
        self.g["accessors"].append(acc)
        return len(self.g["accessors"]) - 1

    def mesh(self, material, vertices, keys, origattrs):
        for off in range(0, len(vertices), TRIS * 3):
            points = np.ascontiguousarray(vertices[off : off + TRIS * 3])
            types = points.view(
                np.dtype((np.void, points.dtype.itemsize * points.shape[1]))
            ).reshape(-1)
            _, first, inv = np.unique(types, return_index=True, return_inverse=True)
            order = np.argsort(first)
            remap = np.empty(len(order), np.uint16)
            remap[order] = np.arange(len(order), dtype=np.uint16)
            indices = remap[inv].reshape(-1)
            unique = points[first[order]]
            self.maxvertices = max(self.maxvertices, len(unique))
            pr = {
                "material": material,
                "mode": 4,
                "attributes": {},
                "indices": self.attribute(indices, "SCALAR", "indices", 5123, False),
            }
            i = 0
            for k, n in keys:
                arr = unique[:, i : i + n]
                i += n
                orig = origattrs[k]
                ctype = orig["componentType"]
                if ctype == 5121:
                    arr = arr.astype(np.uint8)
                else:
                    assert ctype == 5126
                    arr = arr.astype(np.float32)
                pr["attributes"][k] = self.attribute(
                    arr, orig["type"], k, ctype, orig.get("normalized", False)
                )
            self.g["meshes"][0]["primitives"].append(pr)
            self.tris += len(indices) // 3
