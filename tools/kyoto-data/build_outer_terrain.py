"""Extend the distant landscape through Sonobe, Yamashina and southern Kyoto.

Keep the original basin/near/regional grids and imagery intact. This coarser
outer layer supplies real elevation beyond them, never a clamped flat edge.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

import region as R
from common import CACHE, OUT, bilinear, decode_dem_png, encode_heights, global_pixels, grid, mosaic, write_gz
from build_higashiyama import render, save
from fetch import GSI, get

B = (-35000, -20000, 14000, 36000)
STEP = 100


def main():
    jobs = []
    for name, remote, zoom, ext in [('dem_png', 'dem_png', 12, 'png'),
                                   ('seamlessphoto', 'seamlessphoto', 12, 'jpg')]:
        for z, x, y in R.tiles_for(B, zoom, pad=1):
            path = os.path.join(CACHE, 'gsi', name, str(z), str(x), f'{y}.{ext}')
            jobs.append((f'{GSI}/{remote}/{z}/{x}/{y}.{ext}', path))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda job: get(*job), jobs))
    print('outer sources', len(jobs), {s: results.count(s) for s in set(results)}, flush=True)
    X, Z = grid(B, STEP)
    px, py = global_pixels(X, Z, 12)
    arr, ox, oy = mosaic('dem_png', 12, px, py, 'png', decode_dem_png)
    valid = bilinear(np.isfinite(arr).astype(np.float32), px-ox, py-oy) > .999
    h = bilinear(np.nan_to_num(arr), px-ox, py-oy)
    # The south-western edge reaches a GSI no-data tile offshore. Keep every
    # other missing sample fatal; taper this unmodelled corner from the previous
    # data boundary to the mesh skirt, rather than inventing elevation data.
    missing=~valid
    margin=(X<=-30500)&(Z>=33000)
    if np.any(missing & ~margin):
        raise RuntimeError('Missing outer DEM samples outside the unmodelled coastal margin')
    if missing.any():
        boundary=(29000-B[1])//STEP
        fade=np.clip((B[3]-Z)/(B[3]-29000),0,1)
        h=np.where(missing,h[boundary][None,:]*fade,h)
    size = write_gz('terrain-outer.bin', encode_heights(h))
    if size > 350_000:
        raise RuntimeError('Outer terrain exceeds budget')
    photo = render(B, (1792, 2048), 12, oversample=1)
    _, photo_bytes = save(photo, 'aerial-outer.webp', 600_000)
    mobile = photo.resize((896, 1024), Image.Resampling.LANCZOS)
    _, mobile_bytes = save(mobile, 'aerial-outer-mobile.webp', 220_000)
    path = os.path.join(OUT, 'terrain.json')
    with open(path, encoding='utf-8') as f:
        meta = json.load(f)
    meta['outer'] = {'box': B, 'step': STEP, 'nx': h.shape[1], 'nz': h.shape[0],
                     'file': 'terrain-outer.bin', 'bytes': size,
                     'unmodelledMargin': {'box': [-35000,33000,-30500,36000],
                                          'fallback': 'taper from prior data boundary'}}
    meta['aerialOuter'] = {'box': B, 'file': 'aerial-outer.webp', 'size': photo.size,
                           'bytes': photo_bytes, 'zoom': 12,
                           'mobile': {'file': 'aerial-outer-mobile.webp', 'size': mobile.size, 'bytes': mobile_bytes}}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    print('outer terrain', h.shape, float(h.min()), float(h.max()), size, 'photo', photo_bytes, mobile_bytes, flush=True)


if __name__ == '__main__':
    main()
