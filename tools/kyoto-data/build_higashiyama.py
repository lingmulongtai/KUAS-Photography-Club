"""Sharp GSI imagery for the slopes below Shogunzuka and Kiyomizu-dera.

The city sheet (aerial-city.webp, about 4.9 m/pixel) leaves the ground in front of the default view
pale and flat. This writes a bounded photo at about 1.27 m/pixel from seamlessphoto z17, plus a
half-size one for phones, and records both in terrain.json. Elevation (terrain-near.bin is already
10 m here), roads, water and buildings are left byte-for-byte intact.

Run with the same NumPy/Pillow dependencies as the other builders. Source tiles are cached locally;
a missing tile fails the build instead of painting an empty patch.
"""
import io
import json
import os
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

import region as R
from common import CACHE, OUT, bilinear, decode_rgb, global_pixels, mosaic
from fetch import GSI, get

# Gion and the Kamo to just behind Shogunzuka; the edge of Okazaki to the slopes below Kiyomizu-dera
B = (1000, -1000, 3000, 1600)
ZOOM = 17
SIZE = (1576, 2048)  # 1.27 m per pixel
BUDGET = 760_000
MOBILE_BUDGET = 260_000


def sources():
    jobs = []
    for z, x, y in R.tiles_for(B, ZOOM):
        path = os.path.join(CACHE, 'gsi', 'seamlessphoto', str(z), str(x), f'{y}.jpg')
        jobs.append((f'{GSI}/seamlessphoto/{z}/{x}/{y}.jpg', path))
    # Three bounded workers, no map service calls from the deployed page.
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda job: get(*job), jobs))
    print('source tiles', len(jobs), {s: results.count(s) for s in set(results)}, flush=True)
    if '404' in results:
        raise RuntimeError('Missing Higashiyama imagery; refusing to paint empty ground')


def render(box, size, zoom, oversample=2):
    """Sample pixel centres at twice the resolution, then reduce with Lanczos so roofs don't alias."""
    minx, minz, maxx, maxz = box
    w, h = size[0] * oversample, size[1] * oversample
    xs = minx + (np.arange(w) + .5) * (maxx - minx) / w
    zs = minz + (np.arange(h) + .5) * (maxz - minz) / h
    X, Z = np.meshgrid(xs, zs)
    px, py = global_pixels(X, Z, zoom)
    arr, ox, oy = mosaic('seamlessphoto', zoom, px, py, 'jpg', decode_rgb, channels=3, fill=0, required=True)
    img = bilinear(arr, px - ox, py - oy)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize(size, Image.LANCZOS)


def save(im, name, budget, quality=80):
    path = os.path.join(OUT, name)
    for q in range(quality, 49, -2):
        encoded = io.BytesIO()
        im.save(encoded, 'WEBP', quality=q, method=6)
        if encoded.tell() <= budget:
            with open(path + '.part', 'wb') as f:
                f.write(encoded.getvalue())
            os.replace(path + '.part', path)
            return q, os.path.getsize(path)
    raise RuntimeError(f'{name} exceeds its download budget')


def main():
    sources()
    meta_path = os.path.join(OUT, 'terrain.json')
    meta = json.load(open(meta_path, encoding='utf-8'))
    photo = render(B, SIZE, ZOOM)
    q, size = save(photo, 'aerial-higashiyama.webp', BUDGET)
    mobile = photo.resize((SIZE[0] // 2, SIZE[1] // 2), Image.LANCZOS)
    mq, mobile_size = save(mobile, 'aerial-higashiyama-mobile.webp', MOBILE_BUDGET)
    meta['higashiyama'] = {'box': B, 'file': 'aerial-higashiyama.webp', 'size': photo.size,
        'bytes': size, 'zoom': ZOOM, 'mobile': {'file': 'aerial-higashiyama-mobile.webp',
        'size': mobile.size, 'bytes': mobile_size}}
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1); f.write('\n')
    print('photo', photo.size, size, f'q{q}', 'mobile', mobile.size, mobile_size, f'q{mq}', flush=True)


if __name__ == '__main__':
    main()
