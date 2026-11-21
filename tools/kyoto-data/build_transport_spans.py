"""Bake GSI bridge/viaduct centrelines once for the Kyoto panorama and its city regions.

Use the same dependencies as build_lines.py. --tile-cache may be repeated for existing
cache/gsi/bvmap/14 directories. Only missing z14 tiles are downloaded to the normal cache.
GSI layer and feature definitions: https://maps.gsi.go.jp/help/pdf/vector/dataspec.pdf
RailState/relative drawing order: https://maps.gsi.go.jp/help/pdf/vector/attribute.pdf
"""
import argparse
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

from mapbox_vector_tile.decoder import TileData
from shapely import STRtree, union_all
from shapely.geometry import LineString, MultiLineString, box, shape
from shapely.ops import linemerge

import region as R
from build_lines import to_local_fn
from common import CACHE, OUT
from fetch import GSI, get


# Z14 centreline features. 2704 etc. are tunnels and 2702 etc. are snow sheds.
ROAD_CODES = {2703, 2713, 2723, 2733}
ROAD_WIDTH = (3, 4.5, 9, 16, 24)  # shared GSI width ranks, as in roads.ts


def lines(geom):
    if geom.is_empty:
        return
    if geom.geom_type == 'LineString':
        yield geom
    elif geom.geom_type in ('MultiLineString', 'GeometryCollection'):
        for piece in geom.geoms:
            yield from lines(piece)


def named_rail_structures(source):
    """Small buffers absorb the half-metre quantization of the existing railway models."""
    buffers = []
    for route in json.loads(gzip.decompress(source.read_bytes()))['routes']:
        pts = route['points']
        start = None
        for i, state in enumerate([*route['states'], None]):
            if state == 1 and start is None:
                start = i
            elif state != 1 and start is not None:
                buffers.append(LineString(pts[start:i + 1]).buffer(1.1, cap_style='flat'))
                start = None
    return STRtree(buffers)


def tile_features(path, x, y):
    data = TileData(path.read_bytes())
    project = to_local_fn(14, x, y)
    for layer in data.tile.layers:
        if layer.name not in ('road', 'railway'):
            continue
        if layer.extent != 4096:
            raise ValueError(f'Unsupported tile extent {layer.extent}')
        # Decode geometry only for attributed structures. Ordinary roads and buildings
        # dominate these tiles and need not be materialized for this pack.
        values = [data.parse_value(v) for v in layer.values]
        for feature in layer.features:
            tags = feature.tags
            props = {layer.keys[k]: values[v] for k, v in zip(tags[::2], tags[1::2])}
            if layer.name == 'road':
                if props.get('ftCode') not in ROAD_CODES:
                    continue
                kind = 'road'
                width = ROAD_WIDTH[int(props.get('rnkWidth', 0))]
            else:
                if props.get('railState') != 1:
                    continue
                kind = 'rail'
                width = 5.6 if props.get('snglDbl') == 2 else 3.1
            geometry = data.parse_geometry(feature.geometry, feature.type, layer.extent,
                                           y_coord_down=True, transformer=None)
            # Buffers extend beyond tile boundaries. Clip each feature to its owned tile.
            for part in lines(shape(geometry).intersection(box(0, 0, 4096, 4096))):
                yield (kind, width, int(props.get('lvOrder', 0))), LineString([project(*p) for p in part.coords])


def canonical(points):
    pts = tuple((round(x * 2) / 2, round(z * 2) / 2) for x, z in points)
    pts = tuple(p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1])
    return min(pts, pts[::-1])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tile-cache', action='append', type=Path, default=[])
    p.add_argument('--download-cache', type=Path, default=Path(CACHE) / 'gsi/bvmap/14')
    p.add_argument('--output', type=Path, default=Path(OUT) / 'transport-spans.json.gz')
    args = p.parse_args()
    regions = json.loads((Path(OUT) / 'regions.json').read_text(encoding='utf-8'))['regions']
    boxes = [R.LINES, *(region['box'] for region in regions)]
    area = union_all([box(*bounds) for bounds in boxes])
    tiles = sorted({(x, y) for bounds in boxes for _, x, y in R.tiles_for(bounds, 14)})
    modeled = named_rail_structures(Path(OUT) / 'railways.json.gz')
    grouped = defaultdict(set)
    cache_dirs = [*args.tile_cache, args.download_cache]
    for x, y in tiles:
        suffix = Path(str(x)) / f'{y}.pbf'
        path = next((c / suffix for c in cache_dirs if (c / suffix).is_file()), None)
        if path is None:
            path = args.download_cache / suffix
            get(f'{GSI}/experimental_bvmap/14/{x}/{y}.pbf', str(path))
        for key, line in tile_features(path, x, y):
            geom = line.intersection(area)
            if key[0] == 'rail':
                overlaps = modeled.query(geom, predicate='intersects')
                if len(overlaps):
                    geom = geom.difference(union_all(modeled.geometries.take(overlaps)))
            for part in lines(geom):
                points = canonical(part.coords)
                if len(points) > 1:
                    grouped[key].add(points)
    paths = []
    for (kind, width, level), parts in sorted(grouped.items()):
        # Join only matching class, relative level, width and coincident ends.
        # linemerge stops at branches and never fabricates a connection across a gap.
        merged = linemerge(MultiLineString(sorted(parts)))
        for geom in lines(merged):
            if geom.length < 4:
                continue
            points = canonical(geom.simplify(.8).coords)
            if len(points) > 1:
                paths.append(dict(kind=kind, width=width, level=level, points=points))
    paths.sort(key=lambda path: (path['kind'], path['width'], path['level'], path['points']))
    pack = {'source': 'Geospatial Information Authority of Japan, experimental vector map z14',
            'paths': paths}
    raw = json.dumps(pack, separators=(',', ':')).encode('utf-8')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(gzip.compress(raw, mtime=0))
    print(len(tiles), 'tiles;', Counter(path['kind'] for path in paths), 'paths;',
          sum(len(path['points']) for path in paths), 'points;', args.output.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
