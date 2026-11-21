"""Extend the standing Kyoto street network from the core to the Tennozan river viewpoint."""
import gzip
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from collections import defaultdict

from shapely import union_all
from shapely.geometry import LineString, box, shape
from shapely.ops import transform

import region as R
from build_regions import export_lines, line_parts, tiles
from common import CACHE, OUT
from fetch import get, GSI

BOX = (-9000, 2650, 4600, 13300)
YARD = (-5480, 4850, -3630, 8450)


def fetch_tile(tile):
    z, x, y = tile
    path = Path(CACHE, 'gsi', 'bvmap', str(z), str(x), f'{y}.pbf')
    if get(f'{GSI}/experimental_bvmap/{z}/{x}/{y}.pbf', str(path)) == '404':
        raise RuntimeError(f'Missing GSI transport tile {z}/{x}/{y}')


def yard_tracks():
    # At z16 the same tile carries both the generalised route network (8201)
    # and individual 1:2500 track axes. Only the latter belong in this survey.
    tile_bounds, extent = box(0, 0, 4096, 4096), box(*YARD)
    by_code = defaultdict(list)
    for data, project in tiles(YARD, 16):
        for feature in data.get('railway', {}).get('features', []):
            code = feature['properties'].get('ftCode')
            if code in (2801, 2841):
                local = transform(project, shape(feature['geometry']).intersection(tile_bounds))
                by_code[code].extend(line_parts(local.intersection(extent)))
    if not all(by_code[code] for code in (2801, 2841)):
        raise RuntimeError('The individual running tracks or sidings are missing')
    routes = json.loads(gzip.decompress(Path(OUT, 'railways.json.gz').read_bytes()))['routes']
    standard = union_all([LineString(r['points']) for r in routes if r['id'] in ('hankyu-kyoto', 'jr-shinkansen')])
    result = []
    for code, parts in sorted(by_code.items()):
        for part in line_parts(union_all(parts)):
            attr = 8 if code == 2801 else 4
            if code == 2801 and standard.distance(part.interpolate(.5, normalized=True)) < 6:
                attr |= 16
            result.append((attr, part))
    return result


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch_tile, R.tiles_for(BOX, 14) + R.tiles_for(YARD, 16)))
    path = Path(OUT, 'terrain.json')
    meta = json.loads(path.read_text(encoding='utf-8'))
    meta['basinTransport'] = export_lines('basin-transport', BOX, track_box=YARD, tracks=yard_tracks())
    meta['basinTransport']['trackBox'] = YARD
    path.write_text(json.dumps(meta, indent=1) + '\n', encoding='utf-8')
    print(meta['basinTransport'])
