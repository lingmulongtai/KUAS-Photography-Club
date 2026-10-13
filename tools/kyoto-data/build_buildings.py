"""
Step 2 for buildings: turn cache/buildings.pkl into public/kyoto/buildings.bin.

Rectangular footprints (most of Kyoto's houses) become oriented boxes; everything else keeps its
simplified outline. Far from the viewpoint and the campus only larger buildings are kept, since
houses there are a pixel or two across. Layout (all little-endian, int16 streams as byte planes):

  uint32 boxes, uint32 polys, uint32 polyPoints
  boxes, sorted along a Z-order curve:
    uint16 dx, dz          centre steps modulo 65536, 0.25 m (the first from the box corner)
    uint8  w, d            long and short side, 0.25 m
    uint8  angle           direction of the long side, 0..255 → 0..π
    uint8  h               measured height, 0.5 m
    int8   ground          PLATEAU ground minus the terrain grid, 0.25 m
    uint8  kind            class | usage << 2  (see CLASS and USAGE below)
  polys:
    uint8  n, h, kind; int8 ground
    uint16 dx, dz          outline steps modulo 65536, 0.25 m (each outline starts from the previous one's last point)
"""
import json
import math
import os
import pickle
import struct

import numpy as np
from shapely.geometry import Polygon

import region as R
from common import CACHE, OUT, write_gz

Q = 0.25
CLASS = {'普通建物': 0, '堅ろう建物': 1, '普通無壁舎': 3, '堅ろう無壁舎': 3}
USAGE = {
    '住宅': 1, '共同住宅': 2,
    '店舗等併用住宅': 3, '店舗等併用共同住宅': 3, '商業施設': 3, '商業系複合施設': 3,
    '業務施設': 4, '宿泊施設': 5,
    '文教厚生施設': 6, '官公庁施設': 6, '供給処理施設': 7,
    '工場': 7, '運輸倉庫施設': 7, '作業所併用住宅': 7, '農林漁業用施設': 7,
}


def heightfield():
    """The same blended terrain the browser uses (heightfield.ts), to store ground offsets."""
    meta = json.load(open(os.path.join(OUT, 'terrain.json')))
    import gzip

    def load(m):
        b = gzip.decompress(open(os.path.join(OUT, m['file']), 'rb').read())
        n = m['nx'] * m['nz']
        lo = np.frombuffer(b[:n], np.uint8).astype(np.uint16)
        hi = np.frombuffer(b[n:2 * n], np.uint8).astype(np.uint16)
        d = (lo | (hi << 8)).view(np.int16).astype(np.int64).reshape(m['nz'], m['nx'])
        first = np.cumsum(d[:, 0])
        d[:, 0] = first
        return np.cumsum(d, axis=1) / 10.0

    def sampler(m, h):
        x0, z0 = m['box'][0], m['box'][1]

        def f(x, z):
            fx = (x - x0) / m['step']
            fz = (z - z0) / m['step']
            if fx < 0 or fz < 0 or fx > m['nx'] - 1 or fz > m['nz'] - 1:
                return None
            i = min(int(fx), m['nx'] - 2)
            j = min(int(fz), m['nz'] - 2)
            tx, tz = fx - i, fz - j
            a, b, c, d = h[j, i], h[j, i + 1], h[j + 1, i], h[j + 1, i + 1]
            return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz
        return f

    far = sampler(meta['far'], load(meta['far']))
    near = sampler(meta['near'], load(meta['near']))
    nb = meta['near']['box']

    def height(x, z):
        f = far(x, z) or 0.0
        edge = min(x - nb[0], nb[2] - x, z - nb[1], nb[3] - z)
        if edge <= 0:
            return f
        n = near(x, z)
        if n is None:
            return f
        t = min(1, max(0, edge / 300))
        w = t * t * (3 - 2 * t)
        return f + (n - f) * w
    return height


def morton(x, z):
    def spread(v):
        v &= 0xFFFF
        v = (v | (v << 8)) & 0x00FF00FF
        v = (v | (v << 4)) & 0x0F0F0F0F
        v = (v | (v << 2)) & 0x33333333
        v = (v | (v << 1)) & 0x55555555
        return v
    return spread(x) | (spread(z) << 1)


def planes(v):
    """Steps wrap modulo 65536 (positions fit in 16 bits), so any jump fits; the reader adds with & 0xFFFF."""
    u = (np.asarray(v, np.int64) & 0xFFFF).astype(np.uint16)
    return (u & 0xFF).astype(np.uint8).tobytes() + (u >> 8).astype(np.uint8).tobytes()


# LOD1 prisms that misrepresent landmarks; the scene models these itself (landmarks.ts)
REPLACED = [
    (-27, 1784, 12),   # 京都タワー: the tower and its base building as one 130 m block
    (-984, 2632, 8),   # 東寺 五重塔
    (1802, 560, 8),    # 法観寺 八坂の塔
]


def keep(b, area, cx, cz):
    for x, z, r in REPLACED:
        if math.hypot(cx - x, cz - z) < r:
            return False
    cam = R.to_local(*R.PLACES['shogunzuka'])
    kuas = R.to_local(*R.PLACES['kuas'])
    d_cam = math.hypot(cx - cam[0], cz - cam[1])
    d_kuas = math.hypot(cx - kuas[0], cz - kuas[1])
    if b['class'] in ('普通無壁舎', '堅ろう無壁舎') and area < 60:
        return False
    if area < 14:
        return False
    if d_cam < 3500 or d_kuas < 1500:
        return True
    if d_cam < 6500:
        return area >= 30 or b['height'] >= 9
    if d_cam < 9000:
        return area >= 70 or b['height'] >= 10
    return area >= 150 or b['height'] >= 14


def main():
    buildings = pickle.load(open(os.path.join(CACHE, 'buildings.pkl'), 'rb'))
    ground_at = heightfield()
    minx, minz = R.BUILDINGS[0], R.BUILDINGS[1]
    boxes, polys = [], []
    names = []
    dropped = 0
    for b in buildings:
        try:
            poly = Polygon(b['ring']).buffer(0)
        except Exception:
            continue
        if poly.is_empty:
            continue
        if poly.geom_type == 'MultiPolygon':
            poly = max(poly.geoms, key=lambda g: g.area)
        area = poly.area
        c = poly.centroid
        if not keep(b, area, c.x, c.y):
            dropped += 1
            continue
        h = max(2.5, min(b['height'], 127.5))
        cls = CLASS.get(b['class'], 1)
        if cls == 3:
            h = min(h, 4)
        kind = cls | (USAGE.get(b['usage'], 0) << 2)
        storeys = int(b['storeys'] or 0)
        g = b['ground']
        dem = ground_at(c.x, c.y)
        goff = 0 if g is None else max(-127, min(127, round((g - dem) / Q)))
        if b['name']:
            names.append({'name': b['name'], 'x': round(c.x, 1), 'z': round(c.y, 1), 'h': round(h, 1)})
        cam = R.to_local(*R.PLACES['shogunzuka'])
        kuas = R.to_local(*R.PLACES['kuas'])
        close = math.hypot(c.x - cam[0], c.y - cam[1]) < 3000 or math.hypot(c.x - kuas[0], c.y - kuas[1]) < 900
        rect = poly.minimum_rotated_rectangle
        rc = np.array(rect.exterior.coords)[:4]
        e1 = rc[1] - rc[0]
        e2 = rc[2] - rc[1]
        l1, l2 = np.hypot(*e1), np.hypot(*e2)
        if l2 > l1:
            e1, l1, l2 = e2, l2, l1
        if area / max(rect.area, 1e-6) >= (0.86 if close else 0.72) and l1 <= 63.75:
            ang = math.atan2(e1[1], e1[0]) % math.pi
            rcx, rcz = rect.centroid.x, rect.centroid.y
            boxes.append((rcx, rcz, l1, l2, ang, h, goff, kind, storeys))
        else:
            s = poly.simplify(0.6 if close else 1.4)
            if s.is_empty or s.geom_type != 'Polygon':
                s = poly
            ring = np.array(s.exterior.coords)[:-1]
            if len(ring) > 255:
                ring = np.array(poly.simplify(2.0).exterior.coords)[:-1][:255]
            # counter-clockwise when seen from above (+y): in x/z with z south that is clockwise in x,z
            area2 = np.dot(ring[:, 0], np.roll(ring[:, 1], -1)) - np.dot(ring[:, 1], np.roll(ring[:, 0], -1))
            if area2 < 0:
                ring = ring[::-1]
            polys.append((ring, h, goff, kind, storeys, c.x, c.y))

    # boxes along a Z-order curve so neighbours are close together in the file
    bq = [(round((b[0] - minx) / Q), round((b[1] - minz) / Q), b) for b in boxes]
    bq = [t for t in bq if 0 <= t[0] < 65536 and 0 <= t[1] < 65536]
    bq.sort(key=lambda t: morton(t[0] >> 4, t[1] >> 4))
    xs = np.array([t[0] for t in bq], np.int64)
    zs = np.array([t[1] for t in bq], np.int64)
    dx = np.diff(xs, prepend=0)
    dz = np.diff(zs, prepend=0)
    assert xs.max() < 65536 and zs.max() < 65536 and xs.min() >= 0 and zs.min() >= 0
    w = np.array([min(255, round(t[2][2] / Q)) for t in bq], np.uint8)
    d = np.array([max(1, min(255, round(t[2][3] / Q))) for t in bq], np.uint8)
    ang = np.array([(round(t[2][4] / math.pi * 128) % 128) * 2 for t in bq], np.uint8)
    hh = np.array([round(t[2][5] / 0.5) for t in bq], np.uint8)
    go = np.array([t[2][6] for t in bq], np.int8)
    kd = np.array([t[2][7] for t in bq], np.uint8)

    polys = [p for p in polys if np.all((p[0] - [minx, minz]) / Q >= 0) and np.all((p[0] - [minx, minz]) / Q < 65535)]
    polys.sort(key=lambda p: morton(int((p[5] - minx) / Q) >> 4, int((p[6] - minz) / Q) >> 4))
    pn, ph, pk, pg, pdx, pdz = [], [], [], [], [], []
    last = np.array([0, 0], np.int64)
    for ring, h, goff, kind, storeys, _, _ in polys:
        q = np.round((ring - [minx, minz]) / Q).astype(np.int64)
        dq = np.diff(q, axis=0, prepend=[last])
        last = q[-1]
        pn.append(len(q))
        ph.append(round(h / 0.5))
        pk.append(kind)
        pg.append(goff)
        pdx.append(dq[:, 0])
        pdz.append(dq[:, 1])
    pdx = np.concatenate(pdx) if pdx else np.zeros(0, np.int64)
    pdz = np.concatenate(pdz) if pdz else np.zeros(0, np.int64)

    out = struct.pack('<III', len(bq), len(polys), len(pdx))
    out += planes(dx) + planes(dz) + w.tobytes() + d.tobytes() + ang.tobytes() + hh.tobytes() + go.tobytes() + kd.tobytes()
    out += bytes(np.array(pn, np.uint8)) + bytes(np.array(ph, np.uint8)) + bytes(np.array(pk, np.uint8)) + np.array(pg, np.int8).tobytes()
    out += planes(pdx) + planes(pdz)
    size = write_gz('buildings.bin', out)
    json.dump({'box': R.BUILDINGS, 'q': Q, 'boxes': len(bq), 'polys': len(polys), 'points': int(len(pdx))},
              open(os.path.join(OUT, 'buildings.json'), 'w'))
    json.dump(names, open(os.path.join(CACHE, 'building-names.json'), 'w'), ensure_ascii=False, indent=0)
    print(f'{len(bq)} boxes, {len(polys)} polygons ({len(pdx)} points), {dropped} left out; raw {len(out)} gz {size}')


if __name__ == '__main__':
    main()
