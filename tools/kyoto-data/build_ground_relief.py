"""Pack MAFF field outlines and the landward edges of the scene's GSI water.

Run with the five 2026 prefectural FlatGeobuf files (see README.md).
Coordinates are signed half-metres from each 4,096 m sheet. The 512 m
subdivision lets the browser build only the geometry near the camera.
"""
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
import struct
import sys

import fiona
import numpy as np
import shapely
from shapely.geometry import Polygon, box, shape
from shapely.geometry.polygon import orient

import region

PUBLIC = Path(__file__).resolve().parents[2] / "public" / "kyoto"
PACK, CELL = 4096, 512
PADDY, FIELD, BANK = 1, 2, 3


def polygons(geometry):
    if geometry.geom_type == "Polygon" and not geometry.is_empty:
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygons(part)


def field_polygons(paths, extent):
    west, south = region.to_geo(extent[0], extent[3])[::-1]
    east, north = region.to_geo(extent[2], extent[1])[::-1]
    clip = box(*extent)

    def local(points):
        return (points - [region.ORIGIN[1], region.ORIGIN[0]]) * [region.M_PER_DEG_LON, -region.M_PER_DEG_LAT]

    for path in paths:
        with fiona.open(path) as dataset:
            for feature in dataset.filter(bbox=(west, south, east, north)):
                attrs = feature.properties
                if attrs["issue_year"] != 2026:
                    raise ValueError("Expected the 2026 MAFF release")
                kind = {100: PADDY, 200: FIELD}.get(attrs["land_type"])
                if kind is None:
                    continue
                local_shape = shapely.transform(shape(feature.geometry), local)
                if not local_shape.is_valid:
                    local_shape = shapely.make_valid(local_shape)
                if not clip.covers(local_shape):
                    local_shape = local_shape.intersection(clip)
                for part in polygons(local_shape):
                    if part.area < 30:
                        continue
                    # Snap after simplifying, preserving holes and valid topology.
                    snapped = shapely.set_precision(part.simplify(.85), .5)
                    for parcel in polygons(snapped):
                        center = parcel.centroid
                        rings = [np.asarray(r.coords)[:-1] for r in [parcel.exterior, *parcel.interiors]]
                        yield kind, center.x, center.y, rings


def water_polygons(file, origin, patches=()):
    compressed = (PUBLIC / file).read_bytes()
    raw = gzip.decompress(compressed)
    count, = struct.unpack_from("<I", raw)
    kinds = raw[4:4+count]
    lengths = np.frombuffer(raw, "<u2", count, 4+count*2)
    starts = np.r_[0, lengths.astype(np.int64).cumsum()]
    n = int(starts[-1])
    planes = np.frombuffer(raw, np.uint8, n*4, 4+4*count).reshape(4, n).astype(np.uint16)
    coords = np.column_stack([(planes[i] | planes[i+1] << 8).view(np.int16).cumsum() for i in (0, 2)]) * .5 + origin
    skip = set()
    for patch in patches:
        data = json.loads(gzip.decompress((PUBLIC / patch).read_bytes()))
        if data["baseSha256"] != hashlib.sha256(compressed).hexdigest():
            raise ValueError(f"{patch} does not match {file}")
        skip.update(data["replace"])
        for polygon in data["polygons"]:
            yield Polygon(np.reshape(polygon["outer"], (-1, 2)),
                          [np.reshape(h, (-1, 2)) for h in polygon["holes"]])
    for i, kind in enumerate(kinds):
        if kind != 2 or i in skip or lengths[i] < 3:
            continue
        holes = []
        j = i + 1
        while j < count and kinds[j] == 3:
            if lengths[j] >= 3:
                holes.append(coords[starts[j]:starts[j+1]])
            j += 1
        yield Polygon(coords[starts[i]:starts[i+1]], holes)


def bank_lines():
    manifest = json.loads((PUBLIC / "regions.json").read_text())["regions"]
    core_patches = ["water-kamo.json.gz", "water-arashiyama.json.gz"]
    arashi_box = json.loads(gzip.decompress((PUBLIC / core_patches[1]).read_bytes()))["box"]
    # Honour the visible sheet priority and join the water before taking its
    # boundary. Otherwise tile cuts and sheet joins would become banks across rivers.
    covered = shapely.union_all([box(*region.LINES), box(*arashi_box)])
    water = list(water_polygons("lines.bin", region.LINES[:2], core_patches))
    for area in manifest:
        lines = area["lines"]
        sheet = box(*lines["box"])
        available = sheet.difference(covered)
        for polygon in water_polygons(lines["file"], lines["box"][:2]):
            water.extend(polygons(shapely.make_valid(polygon).intersection(available)))
        covered = covered.union(sheet)
    clean = [p for item in water for p in polygons(shapely.make_valid(item))]
    joined = shapely.union_all(clean, grid_size=1)
    # Sub-metre differences in the source rings can leave hairline cracks.
    joined = joined.buffer(1.2, join_style="mitre").buffer(-1.2, join_style="mitre")
    edge_zone = covered.boundary.buffer(1.5)
    shapely.prepare(edge_zone)
    for item in polygons(joined):
        if item.area < 160:
            continue
        poly = orient(item.simplify(1.2), sign=1)
        # With this winding, water lies on the left of both shores and islands.
        for ring in [poly.exterior, *poly.interiors]:
            if ring.length < 25:
                continue
            # Preserve direction and split long rivers into independently culled runs.
            coords = list(ring.coords)
            run, length = [], 0
            for a, b in zip(coords, coords[1:]):
                distance = math.dist(a, b)
                boundary = shapely.contains_xy(edge_zone, (a[0]+b[0])/2, (a[1]+b[1])/2)
                if boundary:
                    if run:
                        yield BANK, *run[len(run)//2], [run]
                    run, length = [], 0
                    continue
                steps = max(1, math.ceil(distance/48))
                for i in range(1, steps+1):
                    if not run:
                        run.append((a[0]+(b[0]-a[0])*(i-1)/steps, a[1]+(b[1]-a[1])*(i-1)/steps))
                    run.append((a[0]+(b[0]-a[0])*i/steps, a[1]+(b[1]-a[1])*i/steps))
                    length += distance/steps
                    if length >= 72:
                        yield BANK, *run[len(run)//2], [run]
                        run, length = [], 0
            if run:
                yield BANK, *run[len(run)//2], [run]


def pack(features, directory):
    sheets = defaultdict(lambda: defaultdict(list))
    totals = defaultdict(int)
    for kind, x, z, rings in features:
        sx, sz = math.floor(x/PACK), math.floor(z/PACK)
        cell = math.floor(x/CELL) % 8 + 8*(math.floor(z/CELL) % 8)
        encoded = bytearray(struct.pack("<BB", kind, len(rings)))
        for ring in rings:
            points = np.rint((np.asarray(ring) - [sx*PACK, sz*PACK])*2).astype(np.int32)
            if np.abs(points).max() >= 32768:
                raise ValueError("Feature exceeds packed coordinate range")
            encoded.extend(struct.pack("<H", len(points)))
            encoded.extend(points.astype("<i2").tobytes())
        sheets[(sx, sz)][cell].append(bytes(encoded))
        totals[kind] += 1
    directory.mkdir(parents=True, exist_ok=True)
    index = {}
    for (sx, sz), cells in sorted(sheets.items()):
        payload = bytearray(b"KGR1" + struct.pack("<B", len(cells)))
        for cell, records in sorted(cells.items()):
            payload.extend(struct.pack("<BH", cell, len(records)))
            payload.extend(b"".join(sorted(records)))
        key = f"{sx}_{sz}"
        (directory / f"{key}.bin").write_bytes(gzip.compress(bytes(payload), mtime=0))
        index[key] = sorted(cells)
    (directory / "index.json").write_text(json.dumps(index, separators=(",", ":")) + "\n", encoding="utf8")
    print(f"{len(index)} sheets; paddy / field / bank runs: {dict(totals)}")


if __name__ == "__main__":
    from itertools import chain
    paths = sys.argv[1:]
    if len(paths) != 5:
        sys.exit("Pass the five FlatGeobuf files for Shiga, Kyoto, Osaka, Hyogo and Nara, in that order")
    extent = json.loads((PUBLIC / "terrain.json").read_text())["outer"]["box"]
    pack(chain(field_polygons(paths, extent), bank_lines()), PUBLIC / "ground-relief")
