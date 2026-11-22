"""Extract z16 building footprints, railway and track centerlines, and road bridges from GSI PMTiles.

Run with Python 3.11+, numpy, shapely, pmtiles and mapbox-vector-tile after build_boundaries.py.
Only regional ranges of the national file are downloaded. An ETag-scoped source cache can be reused.
The output retains original MVT geometry and feature attributes, including holes and multipart rings.
A z12 pack has 257 little-endian uint32 absolute offsets followed by 256 independently gzipped
MVTs in row-major z16 subtile order. Empty subtiles have identical start and end offsets.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
from mapbox_vector_tile.Mapbox import vector_tile_pb2
from pmtiles.tile import deserialize_directory, deserialize_header, find_tile, zxy_to_tileid
import shapely
from shapely.geometry import shape

DATA = Path(__file__).resolve().parents[2] / "public" / "kansai"
SOURCE = "https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles"
SOURCE_DOC = "https://github.com/gsi-cyberjapan/optimal_bvmap"
# Road centerline classes styled as bridges in the GSI standard map, including pedestrian bridges.
BRIDGE_CODES = {2703, 2713, 2723, 2733}
KEPT = {"BldA", "RailCL", "RailTrCL"}
PREFECTURES = {"25", "26", "27", "28", "29"}
HEADER = struct.Struct("<257I")
ZOOM = 16


def fetch_range(offset, size, etag=None):
    headers = {"Range": f"bytes={offset}-{offset + size - 1}", "Accept-Encoding": "identity"}
    if etag:
        headers["If-Match"] = etag
    for attempt in range(5):
        try:
            with urlopen(Request(SOURCE, headers=headers), timeout=100) as response:
                content_range = response.headers.get("Content-Range", "").split("/")[0]
                if response.status != 206 or content_range != headers["Range"].replace("=", " "):
                    raise ValueError(f"Unexpected response range {content_range}")
                tag = response.headers["ETag"]
                if etag and tag != etag:
                    raise ValueError("The source archive changed during extraction")
                data = response.read()
                if len(data) != size:
                    raise OSError("Incomplete range download")
                return data, tag
        except (OSError, HTTPError) as error:
            if attempt == 4 or getattr(error, "code", None) == 412:
                raise
            time.sleep(2 ** attempt)


def cached_range(cache, offset, size, etag):
    path = cache / f"{offset}-{size}.range"
    if not path.exists() or path.stat().st_size != size:
        data, _ = fetch_range(offset, size, etag)
        partial = path.with_suffix(".part")
        partial.write_bytes(data)
        partial.replace(path)
    return path


def covered_tiles():
    features = json.loads((DATA / "prefectures.json").read_text(encoding="utf-8"))["features"]
    memberships = defaultdict(list)
    n = 2 ** ZOOM
    for feature in features:
        code = feature["properties"]["code"]
        boundary = shape(feature["geometry"])
        shapely.prepare(boundary)
        west, south, east, north = boundary.bounds
        def tile_y(lat):
            return math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * n / 2)
        xs = np.arange(math.floor((west + 180) * n / 360), math.floor((east + 180) * n / 360) + 1)
        ys = np.arange(tile_y(north), tile_y(south) + 1)
        xx, yy = np.meshgrid(xs, ys)
        x = xx.flatten()
        y = yy.flatten()
        def latitude(row):
            return np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * row / n))))
        boxes = shapely.box(x * 360 / n - 180, latitude(y + 1), (x + 1) * 360 / n - 180, latitude(y))
        inside = shapely.intersects(boundary, boxes)
        for col, row in zip(x[inside].tolist(), y[inside].tolist()):
            memberships[col, row].append(code)
    if {c for owners in memberships.values() for c in owners} != PREFECTURES:
        raise ValueError("Expected all five prefectures in the boundary data")
    return memberships


def locations(memberships, cache, header, etag):
    # All compressed root/leaf directories combined occupy under 6 MB in the source archive.
    directory = cached_range(cache, 0, header["tile_data_offset"], etag).read_bytes()
    def entries(offset, length):
        return deserialize_directory(directory[offset:offset + length])
    root = entries(header["root_offset"], header["root_length"])
    leaves = {}
    refs = defaultdict(list)
    missing = 0
    for (x, y), owners in memberships.items():
        tile_id = zxy_to_tileid(ZOOM, x, y)
        entry = find_tile(root, tile_id)
        while entry and not entry.run_length:
            if entry.offset not in leaves:
                leaves[entry.offset] = entries(header["leaf_directory_offset"] + entry.offset, entry.length)
            entry = find_tile(leaves[entry.offset], tile_id)
        if not entry:
            missing += 1
            continue
        offset = header["tile_data_offset"] + entry.offset
        refs[offset, entry.length].append((x, y, owners))
    return refs, missing


def group_ranges(refs):
    groups = []
    for offset, size in sorted(refs):
        if not groups or offset - groups[-1][1] > 8192 or offset + size - groups[-1][0] > 4 * 1024**2:
            groups.append([offset, offset + size, []])
        group = groups[-1]
        group[1] = offset + size
        group[2].append((offset, size))
    return groups


def varint(data, offset):
    value = shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
        shift += 7


def layer_name(layer):
    # Tippecanoe writes version and name before feature records. Accept arbitrary wire order.
    pos = 0
    while pos < len(layer):
        tag, pos = varint(layer, pos)
        wire = tag & 7
        if wire == 0:
            _, pos = varint(layer, pos)
        elif wire == 2:
            size, pos = varint(layer, pos)
            if tag == 10:
                return layer[pos:pos + size].decode()
            pos += size
        else:
            raise ValueError(f"Unsupported MVT layer header tag {tag}")
    raise ValueError("Unnamed MVT layer")


def road_bridges(layer):
    message = vector_tile_pb2.tile.layer()
    message.ParseFromString(layer)
    code_index = list(message.keys).index("vt_code") if "vt_code" in message.keys else -1
    valid = {index for index, value in enumerate(message.values)
             if value.ListFields() and value.ListFields()[0][1] in BRIDGE_CODES}
    if code_index < 0 or not valid:
        return b"", 0
    keep = []
    for feature in message.features:
        tags = feature.tags
        if any(tags[i] == code_index and tags[i + 1] in valid for i in range(0, len(tags), 2)):
            keep.append(feature)
    if not keep:
        return b"", 0
    tile = vector_tile_pb2.tile()
    output = tile.layers.add()
    output.name, output.version, output.extent = message.name, message.version, message.extent
    output.keys.extend(message.keys)
    output.values.extend(message.values)
    output.features.extend(keep)
    return tile.SerializeToString(), len(keep)


def filter_chunk(path, start, contents):
    data = path.read_bytes()
    tiles = []
    for offset, size in contents:
        raw = gzip.decompress(data[offset - start:offset - start + size])
        pos = 0
        parts = []
        counts = {}
        while pos < len(raw):
            tag, key_end = varint(raw, pos)
            if tag != 26:
                raise ValueError(f"Unexpected vector tile field {tag}")
            length, begin = varint(raw, key_end)
            end = begin + length
            layer = raw[begin:end]
            name = layer_name(layer)
            if name in KEPT:
                message = vector_tile_pb2.tile.layer()
                message.ParseFromString(layer)
                if len(message.features):
                    parts.append(raw[pos:end])
                    counts[name] = len(message.features)
            elif name == "RdCL":
                bridges, count = road_bridges(layer)
                if count:
                    parts.append(bridges)
                    counts[name] = count
            pos = end
        if parts:
            tiles.append(((offset, size), gzip.compress(b"".join(parts), compresslevel=6, mtime=0), counts))
    return tiles


def write_packs(output, packs):
    keys = defaultdict(list)
    sizes = []
    for (code, x, y), tiles in sorted(packs.items()):
        directory = output / code
        directory.mkdir(parents=True, exist_ok=True)
        contents = [tiles.get(i, b"") for i in range(256)]
        offsets = [HEADER.size]
        for blob in contents:
            offsets.append(offsets[-1] + len(blob))
        path = directory / f"{x}-{y}.bin"
        temp = path.with_suffix(".part")
        with temp.open("wb") as stream:
            stream.write(HEADER.pack(*offsets))
            stream.writelines(contents)
        temp.replace(path)
        keys[code].append(f"{x}/{y}")
        sizes.append(offsets[-1])
    return keys, sizes


def generate(cache, output, workers):
    header_raw, etag = fetch_range(0, 127)
    header = deserialize_header(header_raw)
    if header["tile_compression"].name != "GZIP" or header["tile_type"].name != "MVT" or header["max_zoom"] != ZOOM:
        raise ValueError("Unexpected source archive format")
    cache = cache / hashlib.sha256(etag.encode()).hexdigest()[:20]
    cache.mkdir(parents=True, exist_ok=True)
    memberships = covered_tiles()
    refs, missing = locations(memberships, cache, header, etag)
    groups = group_ranges(refs)
    source_bytes = sum(end - start for start, end, _ in groups)
    print(f"{len(memberships):,} candidate subtiles, {missing} absent, {len(groups)} ranges, "
          f"{source_bytes / 2**20:,.1f} MiB regional range reads", flush=True)
    counts = Counter()
    filled = Counter()
    packs = defaultdict(dict)
    occupied = 0
    with ThreadPoolExecutor(max_workers=6) as network, ProcessPoolExecutor(max_workers=workers) as processes:
        downloads = {network.submit(cached_range, cache, start, end - start, etag): (start, contents)
                     for start, end, contents in groups}
        results = []
        for future in as_completed(downloads):
            start, contents = downloads[future]
            results.append(processes.submit(filter_chunk, future.result(), start, contents))
        for i, future in enumerate(as_completed(results), 1):
            for reference, blob, features in future.result():
                for x, y, codes in refs[reference]:
                    counts.update(features)
                    occupied += 1
                    for code in codes:
                        packs[code, x // 16, y // 16][(y % 16) * 16 + x % 16] = blob
                        filled[code] += 1
            if i % 50 == 0:
                print(f"Filtered {i}/{len(groups)} source ranges", flush=True)
    keys, sizes = write_packs(output, packs)
    manifest = {
        "version": 1, "zoom": ZOOM, "packZoom": 12, "source": SOURCE, "sourceInfo": SOURCE_DOC,
        "attribution": "国土地理院最適化ベクトルタイルを加工", "etag": etag.strip('"'),
        "layers": ["BldA", "RailCL", "RailTrCL", "RdCL"], "prefectures": keys,
        "candidateSubtiles": len(memberships), "absentSourceSubtiles": missing, "occupiedSubtiles": occupied,
        "occupiedByPrefecture": dict(sorted(filled.items())), "featureRecords": dict(sorted(counts.items())),
        "bytes": sum(sizes),
    }
    if set(keys) != PREFECTURES or not counts["BldA"] or not counts["RailCL"] or not counts["RdCL"]:
        raise ValueError("Network data incomplete")
    temp = output / "index.part"
    temp.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(output / "index.json")
    print(f"{len(sizes)} packs, {sum(sizes):,} bytes, largest {max(sizes):,}, {occupied:,} occupied subtiles, "
          f"feature records {dict(counts)}", flush=True)


def verify(output):
    manifest = json.loads((output / "index.json").read_text(encoding="utf-8"))
    memberships = covered_tiles()
    if set(manifest["prefectures"]) != PREFECTURES or len(memberships) != manifest["candidateSubtiles"]:
        raise ValueError("Manifest does not match the five prefecture boundaries")
    available = set(output.glob("*/*.bin"))
    seen = {}
    counts = Counter()
    occupied = Counter()
    total_bytes = 0
    for code, keys in manifest["prefectures"].items():
        for key in keys:
            x, y = map(int, key.split("/"))
            path = output / code / f"{x}-{y}.bin"
            available.remove(path)
            pack = path.read_bytes()
            offsets = HEADER.unpack_from(pack)
            total_bytes += len(pack)
            if offsets[0] != HEADER.size or offsets[-1] != len(pack) or list(offsets) != sorted(offsets):
                raise ValueError(f"Invalid pack index: {path}")
            if offsets[0] == offsets[-1]:
                raise ValueError(f"Empty pack: {path}")
            for i, (start, end) in enumerate(zip(offsets, offsets[1:])):
                if start == end:
                    continue
                coords = x * 16 + i % 16, y * 16 + i // 16
                if code not in memberships.get(coords, ()):
                    raise ValueError(f"Subtile outside prefecture: {code}/{coords}")
                compressed = pack[start:end]
                digest = hashlib.sha256(compressed).digest()
                occupied[code] += 1
                if coords in seen:
                    if digest != seen[coords]:
                        raise ValueError(f"Different content at shared boundary: {coords}")
                    continue
                seen[coords] = digest
                tile = vector_tile_pb2.tile()
                tile.ParseFromString(gzip.decompress(compressed))
                if not tile.layers:
                    raise ValueError(f"Subtile contains no features: {coords}")
                for layer in tile.layers:
                    if layer.name not in manifest["layers"] or not layer.features:
                        raise ValueError(f"Unexpected layer: {coords}/{layer.name}")
                    counts[layer.name] += len(layer.features)
    expected_occupied = sum(len(memberships[coords]) for coords in seen)
    if (available or total_bytes != manifest["bytes"] or dict(occupied) != manifest["occupiedByPrefecture"]
            or len(seen) != manifest["occupiedSubtiles"] or sum(occupied.values()) != expected_occupied
            or dict(counts) != manifest["featureRecords"]):
        raise ValueError("Physical packs differ from the manifest, coverage or feature totals")
    print(f"Verified {len(seen):,} unique subtiles, {total_bytes:,} bytes and {dict(counts)}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "kansai-gsi-ranges")
    parser.add_argument("--output", type=Path, default=DATA / "network")
    parser.add_argument("--workers", type=int, default=min(6, os.cpu_count() or 1))
    parser.add_argument("--verify", action="store_true", help="Check all local packs without downloading data")
    args = parser.parse_args()
    if args.verify:
        verify(args.output)
    else:
        generate(args.cache, args.output, args.workers)
