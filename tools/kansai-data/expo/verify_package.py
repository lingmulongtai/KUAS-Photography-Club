"""Validate a delivered package using only the Python standard library."""

import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path
from urllib.parse import urlsplit


def entry_points(root):
    for layer in ("bldg", "frn"):
        path = root / layer / "tileset.json"
        yield path, json.loads(path.read_text(encoding="utf-8"))["root"]


def local_resource(root, base, uri):
    path = (base / uri).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f"Invalid local dependency {base} -> {uri}")
    return path


def verify(package, manifest):
    root = package.resolve()
    inventory = json.loads(manifest.read_text(encoding="utf-8"))
    paths = {
        path.relative_to(root).as_posix(): path
        for path in root.rglob("*")
        if path.is_file()
    }
    if set(paths) != {item["path"] for item in inventory}:
        raise ValueError("Package contents differ from the file manifest")
    for item in inventory:
        data = paths[item["path"]].read_bytes()
        if (
            len(data) != item["bytes"]
            or hashlib.sha256(data).hexdigest() != item["sha256"]
        ):
            raise ValueError(f"File digest mismatch in {item['path']}")
    referenced = {root / "CREDITS.txt"}
    remote = set()
    tiles = set()
    for path, tree in entry_points(root):
        referenced.add(path)
        queue = [tree]
        while queue:
            node = queue.pop()
            queue.extend(node.get("children", []))
            uri = node.get("content", {}).get("uri")
            if not uri:
                continue
            parsed = urlsplit(uri)
            if parsed.scheme:
                if (
                    parsed.scheme != "https"
                    or parsed.netloc != "assets.cms.plateau.reearth.io"
                ):
                    raise ValueError(f"Unexpected survey host {uri}")
                remote.add(uri)
            else:
                tiles.add(local_resource(root, path.parent, uri))
    for tile in tiles:
        data = tile.read_bytes()
        if tile.suffix == ".gz":
            data = gzip.decompress(data)
        magic, version, length, fj, fb, bj, bb = struct.unpack_from("<4s6I", data)
        if (magic, version, length) != (b"b3dm", 1, len(data)):
            raise ValueError(f"Invalid b3dm {tile}")
        start = 28 + fj + fb + bj + bb
        magic, version, length, json_length = struct.unpack_from("<4s3I", data, start)
        if (magic, version, length) != (b"glTF", 2, len(data) - start):
            raise ValueError(f"Invalid GLB {tile}")
        model = json.loads(data[start + 20 : start + 20 + json_length])
        if any(model.get(field) == [] for field in ("images", "textures", "samplers")):
            raise ValueError(f"Empty optional glTF array in {tile}")
        for image in model.get("images", []):
            uri = image.get("uri")
            if uri:
                referenced.add(local_resource(root, tile.parent, uri))
        if any("uri" in buffer for buffer in model["buffers"]):
            raise ValueError(f"Unexpected external geometry buffer in {tile}")
    referenced.update(tiles)
    if set(paths.values()) != referenced:
        raise ValueError("Unreferenced file in the package")
    return {
        "files": len(paths),
        "bytes": sum(item["bytes"] for item in inventory),
        "checkedGeometry": len(tiles),
        "officialRemoteLeaves": len(remote),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.package, args.manifest)))
