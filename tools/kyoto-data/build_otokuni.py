"""Fill the western Kyoto basin from GSI z15 building outlines.

The Kyoto ward survey ends inside the displayed map. A second group holds roofs
which the detailed Tennozan package can replace when it is actually on screen.
Run after building the core, south and Tennozan packages (Python GIS env + Node).
"""
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import Polygon

import region as R
from build_buildings import export_buildings
from build_regions import clipped_buildings
from common import CACHE
from fetch import GSI, get

# From the Katsura station sheet down the Otokuni settlements to Oyamazaki.
BOX = (-11400, 2700, -1100, 14700)


def fetch_outline(tile):
    z, x, y = tile
    path = Path(CACHE, 'gsi', 'bvmap', str(z), str(x), f'{y}.pbf')
    if get(f'{GSI}/experimental_bvmap/{z}/{x}/{y}.pbf', str(path)) == '404':
        raise RuntimeError(f'Missing GSI building tile {z}/{x}/{y}')


def overlaps(shapes, rings):
    # Compare the actual pitched-house rectangles and polygon roofs, including
    # buildings on a ward boundary. Coverage rectangles also enclose empty land.
    existing = shapely.make_valid([Polygon(ring) for ring in rings])
    tree = shapely.STRtree(existing)
    left, right = tree.query(shapes, predicate='intersects')
    intersection = shapely.area(shapely.intersection(shapes[left], existing[right]))
    smaller = np.minimum(shapely.area(shapes)[left], shapely.area(existing)[right])
    matched = np.zeros(len(shapes), dtype=bool)
    matched[left[(smaller > 0) & (intersection >= .30 * smaller)]] = True
    return matched


def main():
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch_outline, R.tiles_for(BOX, 15)))
    buildings = clipped_buildings('otokuni-outlines', {'box': BOX})
    helper = Path(__file__).with_name('survey-footprints.mjs')
    surveys = json.loads(subprocess.check_output(
        ['node', '--experimental-strip-types', str(helper), *map(str, BOX)]))
    shapes = shapely.make_valid([Polygon(b['ring']) for b in buildings])
    missing = ~overlaps(shapes, surveys['core'] + surveys['south'])
    added = [b for b, keep in zip(buildings, missing) if keep]
    detailed = overlaps(shapes[missing], surveys['tennozan'])
    for name, selection in [('otokuni', ~detailed), ('otokuni-tennozan', detailed)]:
        group = [b for b, keep in zip(added, selection) if keep]
        export_buildings(group, box=BOX, stem=f'buildings-{name}',
                         ground_at=lambda x, z: 0, keep_fn=lambda b, area, x, z: area >= 20,
                         close_fn=lambda x, z: False)


if __name__ == '__main__':
    main()
