"""Index the overlapping GSJ surface and ground coverage before requesting detailed height tiles."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import math
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

import numpy as np
from PIL import Image
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[2] / 'public/kansai'
URL = 'https://tiles.gsj.jp/tiles/elev/{}/12/{}/{}.png'


def lat(y):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 4096))))


def coverage(tile):
    x, y = tile
    layers = []
    for name in ('hyogodem', 'hyogodsm'):
        try:
            with urlopen(URL.format(name, y, x), timeout=60) as response:
                img = Image.open(BytesIO(response.read())).convert('RGBA')
                layers.append(np.asarray(img)[:, :, 3] > 0)
        except HTTPError as error:
            if error.code == 404:
                return None
            raise
    overlap = layers[0] & layers[1]
    mask = overlap.reshape(32, 8, 32, 8).any(axis=(1, 3))
    if mask.any():
        return str(x) + '/' + str(y), np.packbits(mask, bitorder='little').tobytes().hex()


def main():
    features = json.loads((ROOT / 'prefectures.json').read_text(encoding='utf-8'))['features']
    hyogo = shape(next(f['geometry'] for f in features if f['properties']['code'] == '28'))
    w, s, e, n = hyogo.bounds
    col = lambda p: int((p + 180) / 360 * 4096)
    row = lambda p: int((1 - math.asinh(math.tan(math.radians(p))) / math.pi) * 2048)
    cells = [(x, y) for y in range(row(n), row(s) + 1) for x in range(col(w), col(e) + 1)
             if hyogo.intersects(box(x / 4096 * 360 - 180, lat(y + 1), (x + 1) / 4096 * 360 - 180, lat(y)))]
    with ThreadPoolExecutor(max_workers=5) as pool:
        rows = dict(item for item in pool.map(coverage, cells) if item)
    output = ROOT / 'lidar-coverage.json'
    output.write_text(json.dumps(rows, sort_keys=True, separators=(',', ':')) + '\n')
    print(len(rows), 'survey coverage masks')


if __name__ == '__main__':
    main()
