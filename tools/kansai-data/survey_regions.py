"""Build the spatial runtime index from pinned, municipally bounded PLATEAU trees."""
import json
from math import degrees
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'public/kansai/surveys'
# These pinned pairs have identical GML ID multisets throughout their tile trees.
# Keep the higher-detail tree for those versions only. New releases need a fresh comparison.
SUPERSEDED = {
    'f0/2ed501-5480-4ccb-8293-9469a3856f9a': 'd3/4c620c-1c8b-44fa-9168-b50ed86f27f1',
    '01/9e98f9-121f-4a18-80c8-32b2c3fc071c': '32/d6ef51-5aac-4519-a690-aea78e8bd039',
    'a1/99c1f4-c998-410d-89d9-b45652f1f2a8': 'fc/86811d-685b-4773-9f69-6f2e01f9d597',
    '92/1459fa-4102-4cfe-a56f-6fe5c7764178': 'cf/c419c0-bee1-4810-b9ae-529bafd07124',
    '6b/bea10b-2d85-46e6-8786-4ef504aeeb28': '8b/99ba46-8479-4392-aecb-bf5e98e23987',
}


def write_regions():
    catalogue = json.loads((ROOT/'index.json').read_text(encoding='utf-8'))
    regions = {}
    for layer in catalogue['layers']:
        for child in json.loads((ROOT/layer['file']).read_text())['root']['children']:
            url = child['content']['uri']
            bounds = child['boundingVolume']['region'][:4]
            region = {key: layer[key] for key in ('kind', 'lod', 'pref')}
            region.update(url=url, bounds=[round(degrees(v), 8) for v in bounds])
            prefix, asset, _ = url.split('/assets/')[-1].split('/', 2)
            regions[prefix+'/'+asset] = region
    for lower, upper in SUPERSEDED.items():
        if lower in regions and upper in regions:
            del regions[lower]
    (ROOT/'regions.json').write_text(json.dumps(list(regions.values()), separators=(',', ':'))+'\n')
    print(len(regions), 'bounded survey sources')


if __name__ == '__main__':
    write_regions()
