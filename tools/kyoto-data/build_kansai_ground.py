"""Build the continuous homepage terrain in the same metre grid as Kyoto.

Input tiles are only transport units. The alpha mask follows the union of the
five N03 prefectures, including islands and holes, in the homepage projection.
"""
import gzip
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import region as R
from common import CACHE, OUT, bilinear, decode_dem_png, decode_rgb, encode_heights, global_pixels, grid, mosaic
from fetch import GSI, get

STEP = 200
PHOTO_STEP = 50
DEST = Path(OUT) / 'kansai'
FEATURES = Path(OUT).parent / 'kansai' / 'prefectures.json'


def source_tiles(layer, zoom, extension, box):
    def fetch_tile(tile):
        z, x, y = tile
        relative = f'{layer}/{z}/{x}/{y}.{extension}'
        path = Path(CACHE) / 'gsi' / relative
        if not Path(str(path) + '.404').exists():
            get(f'{GSI}/{relative}', str(path))
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(fetch_tile, R.tiles_for(box, zoom, pad=0)))


def main():
    features = json.loads(FEATURES.read_text(encoding='utf-8'))['features']
    corners = [R.to_local(lat, lon) for f in features for lon in f['bbox'][::2] for lat in f['bbox'][1::2]]
    lo, hi = np.min(corners, axis=0), np.max(corners, axis=0)
    box = [int(c * STEP) for c in (*np.floor(lo / STEP), *np.ceil(hi / STEP))]
    DEST.mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        dem = pool.submit(source_tiles, 'dem_png', 11, 'png', box)
        source_tiles('seamlessphoto', 11, 'jpg', box)
        dem.result()
    X, Z = grid(box, STEP)
    px, py = global_pixels(X, Z, 11)
    heights, ox, oy = mosaic('dem_png', 11, px, py, 'png', decode_dem_png)
    elev = bilinear(np.nan_to_num(heights), px - ox, py - oy)
    (DEST / 'height.bin').write_bytes(gzip.compress(encode_heights(elev), mtime=0))
    size = ((box[2] - box[0]) // PHOTO_STEP, (box[3] - box[1]) // PHOTO_STEP)
    photo = Image.new('RGB', size)
    mask = Image.new('L', size)
    for feature in features:
        part = Image.new('1', size)
        draw = ImageDraw.Draw(part)
        for polygon in feature['geometry']['coordinates']:
            for i, ring in enumerate(polygon):
                points = [R.to_local(lat, lon) for lon, lat in ring]
                draw.polygon([((x - box[0]) / PHOTO_STEP, (z - box[1]) / PHOTO_STEP) for x, z in points], fill=int(i == 0))
        mask.paste(255, mask=part)
    pixels, ox, oy = mosaic('seamlessphoto', 11, px, py, 'jpg', decode_rgb, channels=3)
    # At zooms 9-13 GSI supplies a Landsat mosaic. Use the aerial series at
    # zoom 14 even for distant terrain, retaining Landsat only over survey gaps.
    # Downsample each source tile first to limit peak memory for the five prefectures.
    z = 14
    tiles = []
    for _, tx, ty in R.tiles_for(box, z):
        north, west = R.tile_lat_lon(tx, ty, z)
        south, east = R.tile_lat_lon(tx + 1, ty + 1, z)
        x0, z0 = R.to_local(north, west)
        x1, z1 = R.to_local(south, east)
        area = tuple(int((v - box[i % 2]) / PHOTO_STEP) + (-2 if i < 2 else 2)
                     for i, v in enumerate((x0, z0, x1, z1)))
        if mask.crop(area).getbbox():
            tiles.append((tx, ty))
    def photograph(tile):
        tx, ty = tile
        relative = f'seamlessphoto/{z}/{tx}/{ty}.jpg'
        path = Path(CACHE) / 'gsi' / relative
        if not Path(str(path) + '.404').exists():
            get(f'{GSI}/{relative}', str(path))
    print('GSI aerial tiles:', len(tiles), flush=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(photograph, tiles))
    def thumbnail(path):
        return np.asarray(Image.open(path).convert('RGB').resize((64, 64), Image.Resampling.LANCZOS))
    apx, apy = global_pixels(X, Z, z, tile=64)
    aerial, aox, aoy = mosaic('seamlessphoto', z, apx, apy, 'jpg', thumbnail, tile=64, channels=3)
    xs = box[0] + (np.arange(size[0]) + .5) * PHOTO_STEP
    coastline = np.isfinite(heights).astype(np.float32)
    for y in range(0, size[1], 64):
        zs = box[1] + (np.arange(y, min(size[1], y + 64)) + .5) * PHOTO_STEP
        ax, az = global_pixels(*np.meshgrid(xs, zs), 11)
        rgb = bilinear(pixels, ax - ox, az - oy)
        if np.any(~np.isfinite(rgb[:, :, 0]) & (np.asarray(mask.crop((0, y, size[0], y + len(zs)))) != 0)):
            raise RuntimeError('Missing GSI regional imagery inside the prefectures')
        sx, sy = global_pixels(*np.meshgrid(xs, zs), z, tile=64)
        detail = bilinear(aerial, sx - aox, sy - aoy)
        rgb = np.where(np.isfinite(detail), detail, rgb)
        photo.paste(Image.fromarray(np.nan_to_num(rgb).astype(np.uint8)), (0, y))
        # GSI DEM has no elevation at sea. Keep the port water around mapped
        # shorelines; land beyond the five prefectures stays outside the model.
        land = np.array(mask.crop((0, y, size[0], y + len(zs))))
        sea = bilinear(coastline, ax - ox, az - oy) < .5
        land[(land == 0) & sea] = 96
        mask.paste(Image.fromarray(land), (0, y))
    photo.putalpha(mask)
    # Independent patches avoid oversized GPU textures on mobile and allow frustum culling.
    patches = []
    for y in range(0, size[1], 512):
        for x in range(0, size[0], 512):
            area = (x, y, min(x + 512, size[0]), min(y + 512, size[1]))
            if not mask.crop(area).getbbox():
                continue
            name = f'ground-{x // 512}-{y // 512}.webp'
            photo.crop(area).save(DEST / name, quality=84, method=6)
            patches.append({'box': [box[i % 2] + n * PHOTO_STEP for i, n in enumerate(area)], 'file': 'kansai/' + name})
    meta = {'grid': {'box': box, 'step': STEP, 'nx': X.shape[1], 'nz': X.shape[0], 'file': 'kansai/height.bin'},
            'patches': patches}
    (DEST / 'ground.json').write_text(json.dumps(meta, separators=(',', ':')) + '\n', encoding='utf-8')
    print(box, X.shape, len(patches), flush=True)


if __name__ == '__main__':
    main()
