"""Rebuild measured elevations for mountain ridges. Uses existing DEM encoders and fallbacks.

Run from tools/kyoto-data with the same numpy and Pillow dependencies as build_terrain.py.
Fetches GSI DEM tiles into cache and writes only the two height grids. Their world coordinates
and heights in metres are shared by the terrain, buildings, transport and visibility tests.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import common
import region as R
from build_terrain import heights
from fetch import GSI, get


# Northwest of the basin grid, covering the Sonobe/Yagi hills with an overlap for feathering.
SONOBE = (-30600, -16000, -20400, -4800)
SONOBE_STEP = 40


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path(common.CACHE))
    parser.add_argument('--output-dir', type=Path, default=Path(common.OUT))
    args = parser.parse_args()
    common.CACHE = str(args.cache)
    common.OUT = str(args.output_dir)
    sources = [('dem_png', 14), ('dem_png', 12)]
    tiles = sorted({tile for bounds in (R.TERRAIN, SONOBE) for _, zoom in sources
                    for tile in R.tiles_for(bounds, zoom)})

    def fetch(tile):
        z, x, y = tile
        path = args.cache / 'gsi' / 'dem_png' / str(z) / str(x) / f'{y}.png'
        if Path(str(path) + '.404').is_file():
            return '404'
        return get(f'{GSI}/dem_png/{z}/{x}/{y}.png', str(path))

    with ThreadPoolExecutor(max_workers=4) as pool:
        print('source tiles', dict(Counter(pool.map(fetch, tiles))), flush=True)

    for name, bounds, step in [('terrain-far.bin', R.TERRAIN, R.TERRAIN_STEP),
                               ('terrain-sonobe.bin', SONOBE, SONOBE_STEP)]:
        values = heights(bounds, step, sources)
        size = common.write_gz(name, common.encode_heights(values))
        print(name, bounds, step, values.shape, float(values.min()), float(values.max()), size)


if __name__ == '__main__':
    main()
