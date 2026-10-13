"""
Roads, above-ground railways and water from the GSI vector map (z14), clipped to each tile so
nothing is counted twice. Writes public/kyoto/lines.bin, laid out as streams so it compresses well:

  uint32 count
  uint8  kind[count]     0 road, 1 railway, 2 water polygon ring, 3 water polygon hole
  uint8  attr[count]     road: width rank (0 <3 m … 4 ≥19.5 m) | category << 4 (0 national, 1 prefectural, 2 city, 3 expressway)
                         railway: 1 elevated | 2 multi-track; water: 0
  uint16 n[count]        points per feature
  int16  dx[total]       x steps, 0.5 m units; each feature starts from the previous feature's last point
                         (the first from the box corner)
  int16  dz[total]       the same for z
  (each int16 stream is stored as a low-byte plane followed by a high-byte plane)
"""
import glob
import math
import os
import struct

import mapbox_vector_tile as mvt
from shapely.geometry import shape, box as sbox
from shapely.ops import linemerge

import region as R
from common import CACHE, write_gz

Q = 0.5
EXTENT = 4096


def to_local_fn(z, x, y):
    n = 2 ** z

    def f(px, py):
        gx = (x + px / EXTENT) / n
        gy = (y + py / EXTENT) / n
        lon = gx * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy))))
        return R.to_local(lat, lon)
    return f


def parts(geom):
    t = geom.geom_type
    if t in ('LineString', 'Polygon'):
        return [geom]
    if hasattr(geom, 'geoms'):
        return [g for g in geom.geoms if g.geom_type in ('LineString', 'Polygon')]
    return []


def main():
    minx, minz, maxx, maxz = R.LINES
    feats = []
    clip = sbox(0, 0, EXTENT, EXTENT)
    for path in sorted(glob.glob(os.path.join(CACHE, 'gsi', 'bvmap', '14', '*', '*.pbf'))):
        x = int(path.split(os.sep)[-2])
        y = int(os.path.basename(path).split('.')[0])
        loc = to_local_fn(14, x, y)
        d = mvt.decode(open(path, 'rb').read(), default_options={'y_coord_down': True})

        def add(kind, attr, coords):
            if len(coords) < 2:
                return
            pts = [loc(px, py) for px, py in coords]
            q = [(round((px - minx) / Q), round((pz - minz) / Q)) for px, pz in pts]
            q = [(min(max(a, 0), 65535), min(max(b, 0), 65535)) for a, b in q]
            dedup = [q[0]]
            for p in q[1:]:
                if p != dedup[-1]:
                    dedup.append(p)
            if len(dedup) >= 2:
                for i in range(0, len(dedup) - 1, 65000):
                    feats.append((kind, attr, dedup[i:i + 65001]))

        # roads: join the per-block segments of each class into long lines; skip alleys under 3 m
        by_attr = {}
        for ft in d.get('road', {}).get('features', []):
            p = ft['properties']
            if not p.get('rnkWidth'):
                continue
            attr = int(p['rnkWidth']) | (int(p.get('rdCtg') or 2) << 4)
            by_attr.setdefault(attr, []).extend(parts(shape(ft['geometry']).intersection(clip)))
        for attr, lines in by_attr.items():
            merged = linemerge([g for g in lines if g.geom_type == 'LineString' and not g.is_empty])
            for g in parts(merged):
                add(0, attr, list(g.simplify(1.2).coords))
        for ft in d.get('railway', {}).get('features', []):
            p = ft['properties']
            state = p.get('railState')
            if state not in (0, 1):  # skip tunnels and underground lines
                continue
            attr = (1 if state == 1 else 0) | (2 if (p.get('snglDbl') or 0) >= 3 else 0)
            for g in parts(shape(ft['geometry']).intersection(clip)):
                add(1, attr, list(g.simplify(1.2).coords))
        for ft in d.get('waterarea', {}).get('features', []):
            for g in parts(shape(ft['geometry']).intersection(clip)):
                if g.geom_type != 'Polygon' or g.area < 40:
                    continue
                g = g.simplify(1.5)
                if g.is_empty or g.geom_type != 'Polygon':
                    continue
                add(2, 0, list(g.exterior.coords)[:-1])
                for hole in g.interiors:
                    add(3, 0, list(hole.coords)[:-1])

    # keep only what touches the box
    W = (maxx - minx) / Q
    H = (maxz - minz) / Q
    feats = [f for f in feats if any(0 < a < W and 0 < b < H for a, b in f[2])]
    import numpy as np
    kinds = np.array([f[0] for f in feats], np.uint8)
    attrs = np.array([f[1] for f in feats], np.uint8)
    ns = np.array([len(f[2]) for f in feats], np.uint16)
    dx, dz = [], []
    last = np.zeros(2, np.int32)
    for _, _, pts in feats:
        a = np.array(pts, np.int32)
        d = np.diff(a, axis=0, prepend=[last])
        last = a[-1]
        dx.append(d[:, 0])
        dz.append(d[:, 1])
    dx = np.concatenate(dx)
    dz = np.concatenate(dz)
    assert max(np.abs(dx).max(), np.abs(dz).max()) < 32768

    def planes(v):
        u = v.astype(np.int16).view(np.uint16)
        return (u & 0xFF).astype(np.uint8).tobytes() + (u >> 8).astype(np.uint8).tobytes()

    out = struct.pack('<I', len(feats)) + kinds.tobytes() + attrs.tobytes() + ns.tobytes() + planes(dx) + planes(dz)
    size = write_gz('lines.bin', out)
    counts = {}
    for kind, _, pts in feats:
        counts[kind] = counts.get(kind, 0) + 1
    print('features by kind', counts, 'points', len(dx), 'raw', len(out), 'gz', size)


if __name__ == '__main__':
    main()
