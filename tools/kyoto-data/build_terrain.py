"""Elevation grids and aerial photo textures for the terrain.

Writes public/kyoto/terrain-far.bin, terrain-near.bin, aerial-wide.webp and aerial-city.webp.
"""
import json
import os
import io
import sys

import numpy as np
from PIL import Image

import region as R
from common import OUT, bilinear, decode_dem_png, decode_rgb, encode_heights, global_pixels, grid, mosaic, write_gz


def heights(box, step, sources):
    """Sample elevation over a grid, taking each point from the first source that has data."""
    X, Z = grid(box, step)
    h = np.full(X.shape, np.nan, dtype=np.float32)
    for name, zoom in sources:
        px, py = global_pixels(X, Z, zoom)
        arr, ox, oy = mosaic(name, zoom, px, py, 'png', decode_dem_png)
        # fill no-data pixels from neighbours so bilinear sampling near gaps stays sane
        s = bilinear(np.nan_to_num(arr, nan=-9999), px - ox, py - oy)
        valid = bilinear(np.isfinite(arr).astype(np.float32), px - ox, py - oy) > 0.999
        take = np.isnan(h) & valid
        h[take] = s[take]
    missing = np.isnan(h)
    if missing.any():
        print('  filling', int(missing.sum()), 'samples with no data')
        h[missing] = np.nanmin(h)
    return h


def aerial(box, step, zoom, out, quality, max_bytes=None):
    X, Z = grid(box, step)
    px, py = global_pixels(X, Z, zoom)
    arr, ox, oy = mosaic('seamlessphoto', zoom, px, py, 'jpg', decode_rgb, channels=3, fill=0, required=True)
    img = bilinear(arr, px - ox, py - oy)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    path = os.path.join(OUT, out)
    for q in range(quality, 39, -5):
        encoded = io.BytesIO()
        im.save(encoded, 'WEBP', quality=q, method=6)
        if max_bytes is None or encoded.tell() <= max_bytes:
            with open(path + '.part', 'wb') as f:
                f.write(encoded.getvalue())
            os.replace(path + '.part', path)
            break
    else:
        raise RuntimeError('Aerial photo exceeds the download budget')
    return im.size, os.path.getsize(path)


def mountain_photo():
    """Upgrade wide imagery without rebuilding terrain, roads or buildings."""
    path = os.path.join(OUT, 'terrain.json')
    with open(path, encoding='utf-8') as f:
        meta = json.load(f)
    dims, size = aerial(R.TERRAIN, (R.TERRAIN[2] - R.TERRAIN[0]) / 4095, 14,
                        'aerial-mountains.webp', 80, max_bytes=3 * 1024 * 1024)
    meta['aerialWide']['high'] = {'file': 'aerial-mountains.webp', 'size': dims, 'bytes': size, 'zoom': 14}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    print('mountain photo', dims, size, 'bytes')


def main():
    meta = {}
    far = heights(R.TERRAIN, R.TERRAIN_STEP, [('dem_png', 12)])
    size = write_gz('terrain-far.bin', encode_heights(far))
    meta['far'] = {'box': R.TERRAIN, 'step': R.TERRAIN_STEP, 'nx': far.shape[1], 'nz': far.shape[0], 'file': 'terrain-far.bin'}
    print('far', far.shape, f'{far.min():.1f}..{far.max():.1f} m', size, 'bytes')

    near = heights(R.NEAR, R.NEAR_STEP, [('dem5a_png', 15), ('dem_png', 14)])
    size = write_gz('terrain-near.bin', encode_heights(near))
    meta['near'] = {'box': R.NEAR, 'step': R.NEAR_STEP, 'nx': near.shape[1], 'nz': near.shape[0], 'file': 'terrain-near.bin'}
    print('near', near.shape, f'{near.min():.1f}..{near.max():.1f} m', size, 'bytes')

    w = R.TERRAIN[2] - R.TERRAIN[0]
    step = w / 2047
    dims, size = aerial(R.TERRAIN, step, 13, 'aerial-wide.webp', 80)
    meta['aerialWide'] = {'box': R.TERRAIN, 'file': 'aerial-wide.webp', 'size': dims}
    print('aerial wide', dims, size, 'bytes')

    w = R.AERIAL_DETAIL[2] - R.AERIAL_DETAIL[0]
    step = w / 2047
    dims, size = aerial(R.AERIAL_DETAIL, step, 15, 'aerial-city.webp', 78)
    meta['aerialCity'] = {'box': R.AERIAL_DETAIL, 'file': 'aerial-city.webp', 'size': dims}
    print('aerial city', dims, size, 'bytes')

    json.dump(meta, open(os.path.join(OUT, 'terrain.json'), 'w'), indent=1)


if __name__ == '__main__':
    mountain_photo() if '--photos-only' in sys.argv else main()
