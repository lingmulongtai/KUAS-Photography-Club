"""Reproject the surveyed tree cover onto the homepage terrain grid (KTC1)."""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image

from region import to_geo, to_local

ROOT = Path(__file__).resolve().parents[2] / 'public'
SOURCE = ROOT / 'kansai' / 'landcover'
DEST = ROOT / 'kyoto' / 'kansai'
STEP = 40


def main():
    box = json.loads((DEST / 'ground.json').read_text())['grid']['box']
    west, north, east, south = box
    width = (east - west + STEP - 1) // STEP
    height = (south - north + STEP - 1) // STEP
    cover = np.zeros((height, width), dtype=np.uint8)
    for tx, ty in json.loads((SOURCE / 'index.json').read_text())['tiles']:
        x0, z0 = to_local(90 - ty / 8, tx / 8)
        x1, z1 = to_local(90 - (ty + 1) / 8, (tx + 1) / 8)
        left, right = np.clip(np.ceil((np.array([x0, x1]) - west) / STEP - .5).astype(int), 0, width)
        top, bottom = np.clip(np.ceil((np.array([z0, z1]) - north) / STEP - .5).astype(int), 0, height)
        if right <= left or bottom <= top:
            continue
        with Image.open(SOURCE / f'{tx}-{ty}.png') as image:
            raster = np.asarray(image.convert('RGB'))[:, :, 0]
        lat, lon = to_geo(west + (np.arange(left, right) + .5) * STEP,
                          north + (np.arange(top, bottom) + .5) * STEP)
        u = np.clip(((lon * 8 - tx) * raster.shape[1]).astype(int), 0, raster.shape[1] - 1)
        v = np.clip((((90 - lat) * 8 - ty) * raster.shape[0]).astype(int), 0, raster.shape[0] - 1)
        cover[top:bottom, left:right] = np.rint(raster[np.ix_(v, u)] / 17)
    data = struct.pack('<4siiIII', b'KTC1', west, north, STEP, width, height) + cover.tobytes()
    (DEST / 'canopy.bin').write_bytes(gzip.compress(data, compresslevel=9, mtime=0))


if __name__ == '__main__':
    main()
