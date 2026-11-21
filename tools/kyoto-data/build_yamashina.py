"""Fill the Yamashina basin across the Kyoto core, Yamashina and Fushimi survey edges."""
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import shapely
from shapely.geometry import Polygon

import region as R
from build_buildings import export_buildings
from build_otokuni import fetch_outline, overlaps
from build_regions import clipped_buildings

# Include Misasagi west of the Yamashina package and the Daigo neighbourhoods to its south.
BOX = (2250, -2200, 10600, 10000)


def main():
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch_outline, R.tiles_for(BOX, 15)))
    buildings = clipped_buildings('yamashina-basin-outlines', {'box': BOX})
    helper = Path(__file__).with_name('survey-footprints.mjs')
    surveys = json.loads(subprocess.check_output(
        ['node', '--experimental-strip-types', str(helper), *map(str, BOX), 'core', 'south', 'yamashina']))
    shapes = shapely.make_valid([Polygon(b['ring']) for b in buildings])
    mapped = overlaps(shapes, surveys['core'] + surveys['south'] + surveys['yamashina'])
    extra = [b for b, present in zip(buildings, mapped) if not present]
    export_buildings(extra, box=BOX, stem='buildings-yamashina-basin',
                     ground_at=lambda x, z: 0, keep_fn=lambda b, area, x, z: area >= 20,
                     close_fn=lambda x, z: False)


if __name__ == '__main__':
    main()
