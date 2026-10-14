"""Helpers shared by the build steps: tile mosaics, resampling and the compact binary format."""
import gzip
import math
import os

import numpy as np
from PIL import Image

import region as R

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'public', 'kyoto'))


def grid(box, step):
    """Sample positions (x, z) of a regular grid over a box, including both edges."""
    minx, minz, maxx, maxz = box
    nx = int(round((maxx - minx) / step)) + 1
    nz = int(round((maxz - minz) / step)) + 1
    xs = minx + np.arange(nx) * step
    zs = minz + np.arange(nz) * step
    return np.meshgrid(xs, zs)


def global_pixels(x, z, zoom, tile=256):
    """Local metres -> fractional global pixel coordinates in a Web Mercator zoom level."""
    lat = R.ORIGIN[0] - z / R.M_PER_DEG_LAT
    lon = R.ORIGIN[1] + x / R.M_PER_DEG_LON
    n = 2 ** zoom * tile
    px = (lon + 180) / 360 * n
    py = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n
    return px, py


def mosaic(name, zoom, px, py, ext, decode, tile=256, channels=1, fill=np.nan, required=False):
    """Load the tiles covering pixel coords into one array; returns (array, x0, y0) in global pixels."""
    tx0 = int(np.floor(np.nanmin(px) / tile)) - 0
    ty0 = int(np.floor(np.nanmin(py) / tile)) - 0
    tx1 = int(np.floor(np.nanmax(px) / tile))
    ty1 = int(np.floor(np.nanmax(py) / tile))
    w = (tx1 - tx0 + 1) * tile
    h = (ty1 - ty0 + 1) * tile
    shape = (h, w) if channels == 1 else (h, w, channels)
    arr = np.full(shape, fill, dtype=np.float32)
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            path = os.path.join(CACHE, 'gsi', name, str(zoom), str(tx), f'{ty}.{ext}')
            if not os.path.exists(path):
                if required:
                    raise FileNotFoundError(f'Missing source tile: {path}. Run fetch.py photos first.')
                continue
            a = decode(path)
            arr[(ty - ty0) * tile:(ty - ty0 + 1) * tile, (tx - tx0) * tile:(tx - tx0 + 1) * tile] = a
    return arr, tx0 * tile, ty0 * tile


def bilinear(arr, fx, fy):
    """Sample arr at fractional pixel coords (pixel centres at +0.5)."""
    fx = fx - 0.5
    fy = fy - 0.5
    x0 = np.clip(np.floor(fx).astype(int), 0, arr.shape[1] - 2)
    y0 = np.clip(np.floor(fy).astype(int), 0, arr.shape[0] - 2)
    tx = np.clip(fx - x0, 0, 1)
    ty = np.clip(fy - y0, 0, 1)
    if arr.ndim == 3:
        tx = tx[..., None]
        ty = ty[..., None]
    a = arr[y0, x0]
    b = arr[y0, x0 + 1]
    c = arr[y0 + 1, x0]
    d = arr[y0 + 1, x0 + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def decode_dem_png(path):
    """GSI elevation PNG: h = (R*65536 + G*256 + B) * 0.01 m, with 2^23 meaning no data."""
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.int64)
    v = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    h = np.where(v < 2 ** 23, v, v - 2 ** 24).astype(np.float32) * 0.01
    h[v == 2 ** 23] = np.nan
    return h


def decode_rgb(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float32)


def write_gz(name, data: bytes):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'wb') as f:
        f.write(gzip.compress(data, compresslevel=9, mtime=0))
    return os.path.getsize(path)


def encode_heights(h, scale=10):
    """
    Heights (metres) -> bytes: decimetres as int16, delta-coded along rows (first column against
    the row above), then split into low and high byte planes so gzip finds long runs.
    """
    q = np.round(h * scale).astype(np.int32)
    d = np.empty_like(q)
    d[:, 1:] = q[:, 1:] - q[:, :-1]
    d[0, 0] = q[0, 0]
    d[1:, 0] = q[1:, 0] - q[:-1, 0]
    d = d.astype(np.int16).reshape(-1)
    u = d.view(np.uint16)
    return (u & 0xFF).astype(np.uint8).tobytes() + (u >> 8).astype(np.uint8).tobytes()
