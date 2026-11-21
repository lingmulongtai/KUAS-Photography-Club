"""Extend the standing Kyoto street network from the core to the Tennozan river viewpoint."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import region as R
from build_regions import export_lines
from common import CACHE, OUT
from fetch import get, GSI

BOX = (-9000, 2650, 4600, 13300)


def fetch_tile(tile):
    z, x, y = tile
    path = Path(CACHE, 'gsi', 'bvmap', str(z), str(x), f'{y}.pbf')
    if get(f'{GSI}/experimental_bvmap/{z}/{x}/{y}.pbf', str(path)) == '404':
        raise RuntimeError(f'Missing GSI transport tile {z}/{x}/{y}')


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch_tile, R.tiles_for(BOX, 14)))
    path = Path(OUT, 'terrain.json')
    meta = json.loads(path.read_text(encoding='utf-8'))
    meta['basinTransport'] = export_lines('basin-transport', BOX)
    path.write_text(json.dumps(meta, indent=1) + '\n', encoding='utf-8')
    print(meta['basinTransport'])
