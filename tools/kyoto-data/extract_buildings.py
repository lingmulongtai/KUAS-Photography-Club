"""
Step 1 for buildings: decode every cached PLATEAU LOD1 tile into footprints in local metres.

Each LOD1 building is a prism, so its footprint is the outline of its flat top. Writes
cache/buildings.pkl: a list of dicts with ring (N x 2 metres), height, ground, class, usage, storeys, name.
"""
import glob
import os
import pickle
import sys
from collections import defaultdict

import numpy as np

import b3dm
import region as R
from common import CACHE


def rings_from_top(tri, xz):
    """Outer boundary of a set of top-face triangles (vertex index triples) as an ordered ring."""
    # tiles repeat vertices per face: weld by position first, so shared edges count twice
    key = {}
    pos = []

    def wid(i):
        k = (round(float(xz[i, 0]), 2), round(float(xz[i, 1]), 2))
        if k not in key:
            key[k] = len(pos)
            pos.append(xz[i])
        return key[k]

    count = defaultdict(int)
    for t in tri:
        a, b, c = (wid(i) for i in t)
        if a == b or b == c or a == c:
            continue
        for u, v in ((a, b), (b, c), (c, a)):
            count[(u, v) if u < v else (v, u)] += 1
    adj = defaultdict(list)
    for (u, v), n in count.items():
        if n == 1:
            adj[u].append(v)
            adj[v].append(u)
    if len(adj) < 3:
        return None
    seen = set()
    best = None
    best_area = 0
    for start in list(adj):
        if start in seen:
            continue
        ring = [start]
        seen.add(start)
        prev, cur = None, start
        while len(ring) < 5000:
            nxt = [n for n in adj[cur] if n != prev and (n not in seen or n == start)]
            if not nxt or nxt[0] == start:
                break
            prev, cur = cur, nxt[0]
            ring.append(cur)
            seen.add(cur)
        if len(ring) < 3:
            continue
        p = np.array([pos[i] for i in ring])
        area = 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], -1)) - np.dot(p[:, 1], np.roll(p[:, 0], -1)))
        if area > best_area:
            best, best_area = p, area
    return best


def num(v):
    try:
        f = float(v)
        return f if np.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def decode_tile(path):
    d = b3dm.decode(open(path, 'rb').read())
    x = (d['lon'] - R.ORIGIN[1]) * R.M_PER_DEG_LON
    z = -(d['lat'] - R.ORIGIN[0]) * R.M_PER_DEG_LAT
    xz = np.c_[x, z]
    h = d['h']
    faces = d['faces']
    fb = d['bid'][faces[:, 0]]
    order = np.argsort(fb, kind='stable')
    faces, fb = faces[order], fb[order]
    splits = np.flatnonzero(np.diff(fb)) + 1
    out = []
    a = d['attrs']
    for group in np.split(np.arange(len(faces)), splits):
        if not len(group):
            continue
        i = int(fb[group[0]])
        f = faces[group]
        vh = h[f]
        top = vh.max()
        is_top = np.all(np.abs(vh - top) < 0.05, axis=1)
        ring = rings_from_top(f[is_top], xz)
        if ring is None:
            continue
        zmin = num(a['_zmin'][i])
        zmax = num(a['_zmax'][i])
        mh = num(a['bldg:measuredHeight'][i])
        height = mh if mh and mh > 0 else (zmax - zmin if zmin is not None and zmax is not None else 6.0)
        out.append({
            'id': a['uro:BuildingIDAttribute_uro:buildingID'][i] or f'{os.path.basename(path)}#{i}',
            'ring': ring.astype(np.float32),
            'height': float(height),
            'ground': zmin,
            'class': a['bldg:class'][i],
            'usage': a['bldg:usage'][i],
            'storeys': num(a['bldg:storeysAboveGround'][i]),
            'name': a['gml:name'][i],
        })
    return out


def main():
    files = sorted(glob.glob(os.path.join(CACHE, 'plateau', '*', '*.b3dm')))
    seen = set()
    buildings = []
    minx, minz, maxx, maxz = R.BUILDINGS
    for k, path in enumerate(files):
        for b in decode_tile(path):
            if b['id'] in seen:
                continue
            seen.add(b['id'])
            cx, cz = b['ring'].mean(axis=0)
            if minx <= cx <= maxx and minz <= cz <= maxz:
                buildings.append(b)
        if k % 50 == 0:
            print(f'{k}/{len(files)} tiles, {len(buildings)} buildings', flush=True)
    print(len(buildings), 'buildings in the area')
    pickle.dump(buildings, open(os.path.join(CACHE, 'buildings.pkl'), 'wb'))


if __name__ == '__main__':
    main()
