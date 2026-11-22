"""Sample the Kansai GSI aerial survey for the original basin terrain's outer photo slot."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from common import OUT, bilinear, global_pixels, mosaic


def main():
    root = Path(OUT)
    outer = json.loads((root / 'terrain.json').read_text())['aerialOuter']
    west, north, east, south = outer['box']
    width, height = outer['size']
    xs = west + (np.arange(width) + .5) * (east - west) / width
    zs = north + (np.arange(height) + .5) * (south - north) / height
    def thumbnail(path):
        with Image.open(path) as image:
            return np.asarray(image.convert('RGB').resize((128, 128), Image.Resampling.LANCZOS))
    px, py = global_pixels(xs[[0, -1]], zs[[0, -1]], 14, tile=128)
    aerial, ox, oy = mosaic('seamlessphoto', 14, px, py, 'jpg', thumbnail, tile=128, channels=3)
    result = np.asarray(Image.open(root / outer['file']).convert('RGB')).copy()
    sampled = 0
    for start in range(0, height, 64):
        rows = slice(start, min(start + 64, height))
        u, v = global_pixels(*np.meshgrid(xs, zs[rows]), 14, tile=128)
        rgb = bilinear(aerial, u - ox, v - oy)
        valid = np.isfinite(rgb[:, :, 0])
        result[rows][valid] = rgb[valid].astype(np.uint8)
        sampled += int(valid.sum())
    if sampled < width * height * .95:
        raise ValueError('Generate the Kansai ground survey first to populate the GSI aerial cache')
    photo = Image.fromarray(result)
    photo.save(root / 'kansai/basin.webp', quality=84, method=6)
    photo.resize(tuple(outer['mobile']['size']), Image.Resampling.LANCZOS).save(
        root / 'kansai/basin-mobile.webp', quality=82, method=6)


if __name__ == '__main__':
    main()
