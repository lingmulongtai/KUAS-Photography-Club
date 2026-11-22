"""Georeferenced, colour-matched GSI surveys for the districts seen from the homepage."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

import region as R
from build_basin_atlas import balance, neutral_ground, photo
from build_kansai_ground import source_tiles
from common import OUT, bilinear, decode_dem_png, encode_heights, global_pixels, grid, mosaic, write_gz

DEST = Path(OUT, 'kansai', 'districts')
# Centre (lat, lon), width and depth in local metres, source zoom and output pixels.
DISTRICTS = [
    ('nara', 34.683, 135.832, 10000, 8000, 15, 2304),
    ('nara-park', 34.682, 135.843, 2400, 2200, 17, 2048),
    ('kobe', 34.712, 135.205, 12000, 8400, 15, 2560),
    ('kobe-port', 34.684, 135.191, 2800, 2000, 18, 4096),
    ('otsu', 35.018, 135.908, 15600, 12800, 15, 2560),
    ('yodo', 34.855, 135.674, 14800, 8000, 15, 2560),
]


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    terrain = json.loads(Path(OUT, 'terrain.json').read_text())
    with Image.open(Path(OUT, terrain['aerialCity']['file'])) as city:
        reference = neutral_ground(city)
    sheets = []
    for name, lat, lon, width, depth, zoom, pixels in DISTRICTS:
        x, z = [round(v / 40) * 40 for v in R.to_local(lat, lon)]
        box = [x-width//2, z-depth//2, x+width//2, z+depth//2]
        file = 'kansai/districts/' + name
        size = (pixels, round(pixels * depth / width))
        image = balance(photo(box, zoom, size), reference)
        image.save(Path(OUT, file + '.webp'), quality=84, method=5)
        sheet = dict(id=name, box=box, file=file+'.webp', zoom=zoom)
        if name in ('kobe', 'nara'):
            step = 40
            source_tiles('dem_png', 14, 'png', box)
            X, Z = grid(box, step)
            px, py = global_pixels(X, Z, 14)
            values, ox, oy = mosaic('dem_png', 14, px, py, 'png', decode_dem_png)
            heights = bilinear(np.nan_to_num(values), px-ox, py-oy)
            assert np.max(heights)>150
            write_gz(file+'.bin', encode_heights(heights))
            sheet['grid'] = dict(box=box, step=step, nx=X.shape[1], nz=X.shape[0], file=file+'.bin')
        sheets.append(sheet)
        print(name, size, flush=True)
    # The northern half of Nara straddles Kyoto's outer terrain and its worker sampler.
    terrain['naraElevation'] = next(s['grid'] for s in sheets if s['id'] == 'nara')
    Path(OUT, 'terrain.json').write_text(json.dumps(terrain, indent=1)+'\n')
    (DEST/'index.json').write_text(json.dumps(sheets, separators=(',', ':'))+'\n')


if __name__ == '__main__':
    main()
