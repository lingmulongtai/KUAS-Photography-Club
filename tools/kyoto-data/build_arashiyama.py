"""Bounded GSI detail for Arashiyama; existing city roads/buildings remain byte-for-byte intact.

Run with the same NumPy/Pillow/Shapely/mapbox-vector-tile dependencies as the other builders.
Source tiles are cached locally. Missing imagery/elevation fails instead of painting empty areas.
"""
import gzip
import hashlib
import json
import os
import struct
from concurrent.futures import ThreadPoolExecutor

import mapbox_vector_tile as mvt
import numpy as np
from shapely import make_valid
from shapely.geometry import Polygon, box, shape
from shapely.ops import transform, unary_union

import region as R
from build_lines import to_local_fn
from build_terrain import aerial
from common import CACHE, OUT, bilinear, decode_dem_png, encode_heights, global_pixels, grid, mosaic, write_gz
from fetch import GSI, get

B = (-10500, -3200, -6500, 800)


def polygons(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    return [p for child in getattr(g, 'geoms', []) for p in polygons(child)]


def sources():
    jobs = []
    for name, zoom, ext, remote in [('seamlessphoto', 16, 'jpg', 'seamlessphoto'),
            ('dem5a_png', 15, 'png', 'dem5a_png'), ('dem_png', 14, 'png', 'dem_png'),
            ('bvmap', 16, 'pbf', 'experimental_bvmap')]:
        for z, x, y in R.tiles_for(B, zoom):
            path = os.path.join(CACHE, 'gsi', name, str(z), str(x), f'{y}.{ext}')
            jobs.append((f'{GSI}/{remote}/{z}/{x}/{y}.{ext}', path))
    # Three bounded workers, no map service calls from the deployed page.
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda job: get(*job), jobs))
    print('source tiles', len(jobs), {s: results.count(s) for s in set(results)}, flush=True)


def elevation():
    X, Z = grid(B, 10)
    h = np.full(X.shape, np.nan, dtype=np.float32)
    for name, zoom in [('dem5a_png', 15), ('dem_png', 14)]:
        px, py = global_pixels(X, Z, zoom)
        arr, ox, oy = mosaic(name, zoom, px, py, 'png', decode_dem_png)
        valid = bilinear(np.isfinite(arr).astype(np.float32), px-ox, py-oy) > .999
        sample = bilinear(np.nan_to_num(arr), px-ox, py-oy)
        take = np.isnan(h) & valid
        h[take] = sample[take]
    if not np.isfinite(h).all():
        raise RuntimeError('Missing Arashiyama elevation; refusing to flatten missing samples')
    size = write_gz('terrain-arashiyama.bin', encode_heights(h))
    if size > 350_000:
        raise RuntimeError('Arashiyama elevation exceeds budget')
    return {'box': B, 'step': 10, 'nx': h.shape[1], 'nz': h.shape[0],
            'file': 'terrain-arashiyama.bin', 'bytes': size}


def old_water():
    path = os.path.join(OUT, 'lines.bin')
    raw = open(path, 'rb').read()
    data = gzip.decompress(raw)
    n, = struct.unpack_from('<I', data)
    kinds = data[4:4+n]
    counts = np.frombuffer(data, '<u2', n, 4+2*n)
    total = int(counts.sum())
    start = 4+4*n
    streams = []
    for offset in [start, start+total*2]:
        lo = np.frombuffer(data, np.uint8, total, offset).astype(np.uint16)
        hi = np.frombuffer(data, np.uint8, total, offset+total).astype(np.uint16)
        streams.append((lo | hi << 8).view(np.int16).astype(np.int64).cumsum()*.5)
    pts = np.column_stack((streams[0]+R.LINES[0], streams[1]+R.LINES[1]))
    rings = []
    offset = 0
    for count in counts:
        count = int(count)
        rings.append(pts[offset:offset+count]); offset += count
    selected, outside = [], []
    region = box(*B)
    i = 0
    while i < n:
        if kinds[i] != 2:
            i += 1; continue
        indices = [i]; outer = rings[i]; holes = []
        while i+1 < n and kinds[i+1] == 3:
            i += 1; indices.append(i); holes.append(rings[i])
        if len(outer) < 3:
            i += 1
            continue
        geom = make_valid(Polygon(outer, [h for h in holes if len(h) >= 3]))
        if geom.intersects(region):
            selected.extend(indices)
            outside.extend(polygons(geom.difference(region)))
        i += 1
    checksum = 2166136261
    for value in data:
        checksum = ((checksum ^ value)*16777619) & 0xffffffff
    return selected, outside, hashlib.sha256(raw).hexdigest(), checksum


def water():
    selected, outside, source_hash, checksum = old_water()
    detailed = []
    tile_box = box(0, 0, 4096, 4096)
    for z, x, y in R.tiles_for(B, 16):
        path = os.path.join(CACHE, 'gsi', 'bvmap', str(z), str(x), f'{y}.pbf')
        data = mvt.decode(open(path, 'rb').read(), default_options={'y_coord_down': True})
        project = to_local_fn(z, x, y)
        for ft in data.get('waterarea', {}).get('features', []):
            geom = make_valid(shape(ft['geometry'])).intersection(tile_box)
            detailed.extend(polygons(transform(project, geom)))
    local = unary_union(detailed).intersection(box(*B))
    combined = unary_union([local, *outside])
    def ring(coords):
        return [round(float(v), 2) for p in list(coords)[:-1] for v in p]
    packed = [{'outer': ring(p.exterior.coords), 'holes': [ring(h.coords) for h in p.interiors]}
              for p in polygons(combined) if p.area > 1]
    payload = {'box': B, 'source': 'GSI experimental_bvmap z16 waterarea',
               'baseSha256': source_hash, 'baseChecksum': checksum, 'replace': selected, 'polygons': packed}
    size = write_gz('water-arashiyama.json.gz', json.dumps(payload, separators=(',', ':')).encode())
    if size > 256*1024:
        raise RuntimeError('Arashiyama water exceeds budget')
    print('water', len(selected), 'replaced rings', len(packed), 'polygons', size, 'bytes', flush=True)
    return {'file': 'water-arashiyama.json.gz', 'bytes': size, 'baseSha256': source_hash}


def main():
    sources()
    meta_path = os.path.join(OUT, 'terrain.json')
    meta = json.load(open(meta_path, encoding='utf-8'))
    dimensions, size = aerial(B, 4000/2047, 16, 'aerial-arashiyama.webp', 80, 1024*1024)
    low_dimensions, low_size = aerial(B, 4000/1023, 16, 'aerial-arashiyama-mobile.webp', 75, 320*1024)
    meta['arashiyama'] = {'box': B, 'file': 'aerial-arashiyama.webp', 'size': dimensions,
        'bytes': size, 'zoom': 16, 'mobile': {'file': 'aerial-arashiyama-mobile.webp',
        'size': low_dimensions, 'bytes': low_size}, 'elevation': elevation(), 'water': water()}
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1); f.write('\n')
    print('photo', size, 'mobile', low_size, flush=True)


if __name__ == '__main__':
    main()
