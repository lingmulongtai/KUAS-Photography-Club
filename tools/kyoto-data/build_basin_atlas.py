"""A resident, georeferenced GSI photo atlas for the Kyoto and Tamba basins.

Run with NumPy and Pillow. Each frame is sampled before packing so a viewer
can use one existing colour sampler and blend between geographic sheets.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

import region as R
from common import CACHE, OUT
from fetch import GSI, get

# Local metres east/south of Shijo-Karasuma. Each sheet spans the surrounding
# streets or basin, including the approach from the neighbouring panorama.
REGIONS = {
    'katsura': ((-7900, 700, -3400, 4400), 16),
    'south': ((-9200, 4100, 5100, 19300), 15),
    'kameoka': ((-23300, -7900, -13500, 1500), 16),
    'sonobe': ((-28400, -14200, -19700, -5400), 16),
}

# (left, top, width, height), in image coordinates. The original central
# Kyoto 2048x1843 sheet fits at native resolution even on the compact tier.
DESKTOP = {
    'city': (0, 0, 2048, 1843),
    'south': (0, 1864, 2048, 2232),
    'katsura': (2064, 0, 2032, 1432),
    'kameoka': (2064, 1448, 2032, 1504),
    'sonobe': (2064, 2968, 2032, 1128),
}
COMPACT = {
    'city': (0, 0, 2048, 1843),
    'south': (0, 1864, 1016, 1208),
    'katsura': (0, 3088, 1016, 1008),
    'kameoka': (1032, 1864, 1016, 1184),
    'sonobe': (1032, 3064, 1016, 1032),
}


def tile_path(tile):
    z, x, y = tile
    return Path(CACHE, 'gsi', 'seamlessphoto', str(z), str(x), f'{y}.jpg')


def fetch_tile(tile):
    z, x, y = tile
    if get(f'{GSI}/seamlessphoto/{z}/{x}/{y}.jpg', str(tile_path(tile))) == '404':
        raise RuntimeError(f'Missing source GSI photograph {z}/{x}/{y}')


def photo(box, zoom, size):
    tiles = R.tiles_for(box, zoom)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch_tile, tiles))
    x0 = min(x for _, x, _ in tiles)
    y0 = min(y for _, _, y in tiles)
    width = max(x for _, x, _ in tiles) - x0 + 1
    height = max(y for _, _, y in tiles) - y0 + 1
    mosaic = Image.new('RGB', (width * 256, height * 256))
    for tile in tiles:
        _, x, y = tile
        with Image.open(tile_path(tile)) as source:
            mosaic.paste(source, ((x - x0) * 256, (y - y0) * 256))

    def pixel(x, z):
        tx, ty = R.tile_xy(*R.to_geo(x, z), zoom)
        return (tx - x0) * 256, (ty - y0) * 256

    # On this projection longitude is linear; latitude needs a Mercator
    # conversion. Short horizontal strips keep the roofs aligned at every zoom.
    west, north, east, south = box
    image = Image.new('RGB', size)
    for row in range(0, size[1], 32):
        end = min(row + 32, size[1])
        left, top = pixel(west, north + (south - north) * row / size[1])
        right, bottom = pixel(east, north + (south - north) * end / size[1])
        strip = mosaic.resize((size[0], end - row), Image.Resampling.LANCZOS,
                              (left, top, right, bottom))
        image.paste(strip, (0, row))
    return image


def neutral_ground(image):
    pixels = np.asarray(image.resize((320, 320), Image.Resampling.BOX), dtype=np.float32)
    luminance = pixels @ np.array([.2126, .7152, .0722])
    # Use only midtone, low-chroma materials. Forest canopy, white roofs,
    # water and bare fields should retain their own colour.
    mask = (luminance > 55) & (luminance < 205) & (np.ptp(pixels, axis=2) < 24)
    if mask.sum() < 512:
        raise ValueError('Insufficient neutral samples for photo colour calibration')
    return np.median(pixels[mask], axis=0)


def balance(image, reference):
    # Different GSI flights give the same road surface different casts.
    # Limit correction to a modest photographic exposure and white balance.
    gains = np.clip(reference / neutral_ground(image), .82, 1.12)
    channels = [band.point([round(min(255, value * gain)) for value in range(256)])
                for band, gain in zip(image.split(), gains)]
    return Image.merge('RGB', channels)


def atlas(photos, boxes, layout, size, file, quality):
    image = Image.new('RGB', size)
    sheets = []
    for key, source in photos.items():
        x, y, width, height = layout[key]
        tile = source.resize((width, height), Image.Resampling.LANCZOS)
        # Duplicate the border into the guard band so bilinear filtering and
        # the first mip levels cannot pick up a neighbouring city's colours.
        border = np.pad(np.asarray(tile), ((8, 8), (8, 8), (0, 0)), mode='edge')
        image.paste(Image.fromarray(border), (x - 8, y - 8))
        sheets.append({'id': key, 'box': boxes[key],
                       'uv': [x / size[0], 1 - (y + height) / size[1],
                              (x + width) / size[0], 1 - y / size[1]]})
    path = Path(OUT, file)
    image.save(path, format='WEBP', quality=quality, method=6)
    return {'file': file, 'size': size, 'bytes': path.stat().st_size, 'sheets': sheets}


def main():
    path = Path(OUT, 'terrain.json')
    meta = json.loads(path.read_text(encoding='utf-8'))
    city = meta['aerialCity']
    photos = {'city': Image.open(Path(OUT, city['file'])).convert('RGB')}
    reference = neutral_ground(photos['city'])
    boxes = {'city': city['box']}
    for key, (box, zoom) in REGIONS.items():
        print(key, 'GSI seamlessphoto z' + str(zoom), flush=True)
        boxes[key] = box
        photos[key] = balance(photo(box, zoom, DESKTOP[key][2:]), reference)
    data = atlas(photos, boxes, DESKTOP, (4096, 4096), 'aerial-basin.webp', 80)
    data['compact'] = atlas(photos, boxes, COMPACT, (2048, 4096), 'aerial-basin-compact.webp', 80)
    small = {key: tuple(v // 2 for v in rect) for key, rect in DESKTOP.items()}
    data['mobile'] = atlas(photos, boxes, small, (2048, 2048), 'aerial-basin-mobile.webp', 78)
    meta = json.loads(path.read_text(encoding='utf-8'))
    meta['aerialBasin'] = data
    path.write_text(json.dumps(meta, indent=1) + '\n', encoding='utf-8')
    print('Atlas bytes:', data['bytes'], data['compact']['bytes'], data['mobile']['bytes'])


if __name__ == '__main__':
    main()
