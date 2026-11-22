"""Extract GSI surface roads and water from Kansai's five prefectures.

Run after build_boundaries.py. Requires the same Python dependencies as build_network.py.
The z15 surface dataset and z16 edge dataset use native GSI MVT coordinates and attributes.
Their z12 packs start with 65 (z15) or 257 (z16) little-endian uint32 absolute offsets.
The remaining bytes are gzip MVTs in row-major subtile order; empty ranges have no features.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
import gzip
import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile

from mapbox_vector_tile.Mapbox import vector_tile_pb2
from pmtiles.tile import deserialize_directory, deserialize_header, find_tile, zxy_to_tileid

from build_network import (
    DATA, PREFECTURES, SOURCE, SOURCE_DOC, cached_range, covered_tiles, fetch_range,
    group_ranges, layer_name, locations, varint,
)

# Feature classifications are defined in GSI's optimal vector tile feature code table.
CODES_DOC = "https://maps.gsi.go.jp/help/pdf/vector/optbv_featurecodes.pdf"
SURFACE_LAYERS = {15: {"RdCL", "WA", "RvrCL", "Cstline"}, 16: {"RdEdg", "WL"}}
SKIP_CODES = {
    "RdCL": {2703, 2704, 2713, 2714, 2723, 2724, 2733, 2734},  # Bridges and tunnels
    "RdEdg": {2203, 2204, 2223, 2224, 2243, 2244},  # Bridge edges and tunnel entrances
    "RvrCL": {5322},  # Underground artificial waterway
    "WA": {5121, 5221, 5251},  # Exposed rocks
}


def parent_memberships(full, zoom):
    if zoom == 16:
        return full
    result = defaultdict(set)
    for (x, y), codes in full.items():
        result[x // 2, y // 2].update(codes)
    return result


def tile_locations(memberships, cache, header, etag, zoom):
    if zoom == 16:
        return locations(memberships, cache, header, etag)
    directory = cached_range(cache, 0, header["tile_data_offset"], etag).read_bytes()
    def read_dir(offset, size):
        return deserialize_directory(directory[offset:offset + size])
    root = read_dir(header["root_offset"], header["root_length"])
    leaves = {}
    refs = defaultdict(list)
    absent = 0
    for (x, y), owners in memberships.items():
        tile_id = zxy_to_tileid(zoom, x, y)
        entry = find_tile(root, tile_id)
        while entry and not entry.run_length:
            if entry.offset not in leaves:
                leaves[entry.offset] = read_dir(header["leaf_directory_offset"] + entry.offset, entry.length)
            entry = find_tile(leaves[entry.offset], tile_id)
        if entry:
            refs[header["tile_data_offset"] + entry.offset, entry.length].append((x, y, owners))
        else:
            absent += 1
    return refs, absent


def selected_layer(raw, encoded, name):
    layer = vector_tile_pb2.tile.layer.FromString(raw)
    skipped = SKIP_CODES.get(name, ())
    unwanted = {i for i, v in enumerate(layer.values)
                if skipped and v.ListFields() and v.ListFields()[0][1] in skipped}
    if name != "WA" and not unwanted:
        return encoded, len(layer.features)
    index = list(layer.keys).index("vt_code")
    keep = []
    for feature in layer.features:
        if name == "WA" and feature.type != 3:
            continue
        tags = feature.tags
        if unwanted and any(tags[i] == index and tags[i + 1] in unwanted for i in range(0, len(tags), 2)):
            continue
        keep.append(feature)
    if not keep:
        return b"", 0
    if len(keep) == len(layer.features):
        return encoded, len(keep)
    result = vector_tile_pb2.tile()
    dest = result.layers.add()
    dest.name, dest.extent, dest.version = layer.name, layer.extent, layer.version
    dest.keys.extend(layer.keys)
    dest.values.extend(layer.values)
    dest.features.extend(keep)
    return result.SerializeToString(), len(keep)


def filter_block(path, block_start, refs, zoom):
    source = path.read_bytes()
    records = []
    for offset, size in refs:
        begin = offset - block_start
        raw = gzip.decompress(source[begin:begin + size])
        pos = 0
        parts = []
        counts = {}
        while pos < len(raw):
            tag, start = varint(raw, pos)
            if tag != 26:
                raise ValueError(f"Unexpected vector-tile field {tag}")
            length, content = varint(raw, start)
            end = content + length
            layer = raw[content:end]
            name = layer_name(layer)
            if name in SURFACE_LAYERS[zoom]:
                part, count = selected_layer(layer, raw[pos:end], name)
                if count:
                    parts.append(part)
                    counts[name] = count
            pos = end
        if parts:
            records.append(((offset, size), gzip.compress(b"".join(parts), compresslevel=6, mtime=0), counts))
    return records


def generate_level(output, cache, header, etag, zoom, memberships, workers):
    refs, absent = tile_locations(memberships, cache, header, etag, zoom)
    groups = group_ranges(refs)
    edge = 2 ** (zoom - 12)
    counts = Counter()
    filled = Counter()
    packs = defaultdict(dict)
    occupied = 0
    print(f"z{zoom}: {len(memberships):,} source subtiles, {len(groups)} clustered ranges", flush=True)
    with ThreadPoolExecutor(max_workers=6) as network, ProcessPoolExecutor(max_workers=workers) as processes:
        downloads = {network.submit(cached_range, cache, start, end - start, etag):(start, entries)
                     for start, end, entries in groups}
        results = []
        for future in as_completed(downloads):
            offset, entries = downloads[future]
            results.append(processes.submit(filter_block, future.result(), offset, entries, zoom))
        for future in as_completed(results):
            for reference, payload, feature_counts in future.result():
                for x, y, codes in refs[reference]:
                    occupied += 1
                    counts.update(feature_counts)
                    for code in codes:
                        packs[code, x // edge, y // edge][(y % edge) * edge + x % edge] = payload
                        filled[code] += 1
    keys = defaultdict(list)
    total = 0
    largest = 0
    index = struct.Struct(f"<{edge**2 + 1}I")
    for (code, x, y), tiles in sorted(packs.items()):
        folder = output / code
        folder.mkdir(parents=True, exist_ok=True)
        blobs = [tiles.get(i, b"") for i in range(edge**2)]
        offsets = [index.size]
        for blob in blobs:
            offsets.append(offsets[-1] + len(blob))
        target = folder / f"{x}-{y}.bin"
        partial = target.with_suffix(".part")
        with partial.open("wb") as f:
            f.write(index.pack(*offsets))
            f.writelines(blobs)
        partial.replace(target)
        total += offsets[-1]
        largest = max(largest, offsets[-1])
        keys[code].append(f"{x}/{y}")
    if set(keys) != PREFECTURES or set(counts) != SURFACE_LAYERS[zoom]:
        raise ValueError(f"Incomplete layers or prefectures at z{zoom}")
    manifest = {
        "version": 1, "zoom": zoom, "packZoom": 12, "source": SOURCE, "sourceInfo": SOURCE_DOC,
        "featureCodeReference": CODES_DOC, "etag": etag.strip('"'), "attribution": "国土地理院最適化ベクトルタイルを加工",
        "layers": sorted(counts), "prefectures": keys, "candidateSubtiles": len(memberships),
        "absentSourceSubtiles": absent, "occupiedSubtiles": occupied, "occupiedByPrefecture": dict(sorted(filled.items())),
        "featureRecords": dict(sorted(counts.items())), "bytes": total,
    }
    partial = output / "index.part"
    partial.write_bytes(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode() + b"\n")
    partial.replace(output / "index.json")
    print(f"z{zoom}: {len(packs)} packs, {occupied:,} occupied, {total:,} bytes, largest {largest:,}, {dict(counts)}",
          flush=True)


def verify_level(output, memberships):
    m = json.loads((output / "index.json").read_bytes())
    zoom = m["zoom"]
    edge = 2 ** (zoom - 12)
    header = struct.Struct(f"<{edge**2+1}I")
    seen = {}
    counts = Counter()
    filled = Counter()
    total = 0
    files = set(output.glob("*/*.bin"))
    for code, keys in m["prefectures"].items():
        for key in keys:
            x, y = map(int, key.split("/"))
            path = output / code / f"{x}-{y}.bin"
            files.remove(path)
            pack = path.read_bytes()
            total += len(pack)
            offsets = header.unpack_from(pack)
            if offsets[0] != header.size or offsets[-1] != len(pack) or sorted(offsets) != list(offsets):
                raise ValueError(f"Invalid offsets: {path}")
            for i, (a, b) in enumerate(zip(offsets, offsets[1:])):
                if a == b:
                    continue
                pos = (x * edge + i % edge, y * edge + i // edge)
                if code not in memberships.get(pos, ()):
                    raise ValueError(f"Tile outside prefecture: {pos}/{code}")
                filled[code] += 1
                payload = pack[a:b]
                digest = hashlib.sha256(payload).digest()
                if pos in seen:
                    if seen[pos] != digest:
                        raise ValueError(f"Inconsistent shared tile: {pos}")
                    continue
                seen[pos] = digest
                tile = vector_tile_pb2.tile.FromString(gzip.decompress(payload))
                if not tile.layers:
                    raise ValueError(f"Empty MVT: {pos}")
                for layer in tile.layers:
                    if layer.name not in SURFACE_LAYERS[zoom] or not layer.features:
                        raise ValueError(f"Unexpected layer: {pos}/{layer.name}")
                    counts[layer.name] += len(layer.features)
                    skipped = SKIP_CODES.get(layer.name, ())
                    values = {i for i, v in enumerate(layer.values)
                              if skipped and v.ListFields() and v.ListFields()[0][1] in skipped}
                    if values or layer.name == "WA":
                        code_index = list(layer.keys).index("vt_code")
                        for ft in layer.features:
                            if layer.name == "WA" and ft.type != 3:
                                raise ValueError(f"Water area is not polygonal: {pos}")
                            tags = ft.tags
                            if values and any(tags[j] == code_index and tags[j+1] in values for j in range(0,len(tags),2)):
                                raise ValueError(f"Excluded surface class: {pos}/{layer.name}")
    if (files or set(filled) != PREFECTURES or total != m["bytes"] or dict(counts) != m["featureRecords"]
            or dict(filled) != m["occupiedByPrefecture"] or len(seen) != m["occupiedSubtiles"]
            or len(memberships) != m["candidateSubtiles"]
            or sum(filled.values()) != sum(len(memberships[k]) for k in seen)):
        raise ValueError(f"Manifest or boundary coverage mismatch: z{zoom}")
    print(f"Verified z{zoom}: {len(seen):,} unique MVTs, {total:,} bytes and {dict(counts)}", flush=True)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "kansai-gsi-ranges")
    cli.add_argument("--output", type=Path, default=DATA / "surfaces")
    cli.add_argument("--workers", type=int, default=min(6, os.cpu_count() or 1))
    cli.add_argument("--verify", action="store_true")
    args = cli.parse_args()
    full = covered_tiles()
    if not args.verify:
        data, etag = fetch_range(0, 127)
        header = deserialize_header(data)
        if header["tile_compression"].name != "GZIP" or header["tile_type"].name != "MVT" or header["max_zoom"] != 16:
            raise ValueError("Unexpected GSI archive format")
        cache = args.cache / hashlib.sha256(etag.encode()).hexdigest()[:20]
        cache.mkdir(parents=True, exist_ok=True)
    for zoom, directory in [(15, args.output), (16, args.output / "edges")]:
        memberships = parent_memberships(full, zoom)
        if args.verify:
            verify_level(directory, memberships)
        else:
            generate_level(directory, cache, header, etag, zoom, memberships, args.workers)


if __name__ == "__main__":
    main()
