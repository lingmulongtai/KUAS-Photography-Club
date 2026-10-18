"""Bounded 10 m DEM and aerial detail for the sloping KUAS Kameoka campus.

The outer regional data and existing Kyoto assets remain unchanged. Source tiles
are fetched at build time only; the published page loads bounded local assets.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

import region as R
from build_higashiyama import render, save
from common import CACHE, OUT, bilinear, decode_dem_png, encode_heights, global_pixels, grid, mosaic, write_gz
from fetch import GSI, get

B = (-19500, 300, -18100, 1900)


def main():
    jobs = []
    for name, zoom, ext in [('seamlessphoto', 16, 'jpg'), ('dem5a_png', 15, 'png'), ('dem_png', 14, 'png')]:
        for z, x, y in R.tiles_for(B, zoom, pad=1):
            path = os.path.join(CACHE, 'gsi', name, str(z), str(x), f'{y}.{ext}')
            jobs.append((f'{GSI}/{name}/{z}/{x}/{y}.{ext}', path))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda job: get(*job), jobs))
    print('campus sources', len(jobs), {s: results.count(s) for s in set(results)}, flush=True)
    X, Z = grid(B, 10)
    h = np.full(X.shape, np.nan, dtype=np.float32)
    for name, zoom in [('dem5a_png', 15), ('dem_png', 14)]:
        px, py = global_pixels(X, Z, zoom)
        arr, ox, oy = mosaic(name, zoom, px, py, 'png', decode_dem_png)
        valid = bilinear(np.isfinite(arr).astype(np.float32), px-ox, py-oy) > .999
        samples = bilinear(np.nan_to_num(arr), px-ox, py-oy)
        take = np.isnan(h) & valid
        h[take] = samples[take]
    if not np.isfinite(h).all():
        raise RuntimeError('Missing Kameoka campus DEM samples')
    size = write_gz('terrain-kameoka-campus.bin', encode_heights(h))
    if size > 40000:
        raise RuntimeError('Campus DEM exceeds download budget')
    photo = render(B, (1792, 2048), 16)
    _, photo_size = save(photo, 'aerial-kameoka-campus.webp', 700000)
    mobile = photo.resize((896, 1024), Image.Resampling.LANCZOS)
    _, mobile_size = save(mobile, 'aerial-kameoka-campus-mobile.webp', 250000)
    path = os.path.join(OUT, 'terrain.json')
    with open(path, encoding='utf-8') as f:
        meta = json.load(f)
    meta['kameokaCampus'] = {'box': B, 'file': 'aerial-kameoka-campus.webp', 'size': photo.size, 'bytes': photo_size,
        'zoom': 16, 'mobile': {'file': 'aerial-kameoka-campus-mobile.webp', 'size': mobile.size, 'bytes': mobile_size},
        'elevation': {'box': B, 'step': 10, 'nx': h.shape[1], 'nz': h.shape[0], 'file': 'terrain-kameoka-campus.bin', 'bytes': size}}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    print('campus elevation', h.shape, float(h.min()), float(h.max()), size, 'photos', photo_size, mobile_size, flush=True)


if __name__ == '__main__':
    main()
