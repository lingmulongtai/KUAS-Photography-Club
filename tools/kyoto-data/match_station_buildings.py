"""Offline: blender -b -P match_district.py -- <buildings.fbx> <public/kyoto> <output.json>.

Select only existing PLATEAU footprints replaced by a surveyed building. IDs index
the original decoded buildings.bin arrays, before scene landmark or temple cutouts.
"""
from array import array
from collections import Counter
from hashlib import sha256
from math import ceil, cos, floor, pi, sin
from pathlib import Path
import gzip
import json
import struct
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def projected_roofs(objects):
    verts, faces, ids = [], [], []
    for obj in objects:
        if obj.type != 'MESH' or not obj.name.startswith('Object') or not obj.parent:
            continue
        group = obj.parent.name
        source_id = int(group.split('.')[1]) if '.' in group else 0
        first = len(verts)
        for vert in obj.data.vertices:
            p = obj.matrix_world @ vert.co
            east, north = p.x + 22053, p.y + 112471
            x = -96.604283 + .999876364 * east - .002417062 * north
            z = 1958.526159 - .002417531 * east - 1.000094009 * north
            verts.append((x, p.z, z))
        for face in obj.data.polygons:
            faces.append(tuple(first + i for i in face.vertices))
            ids.append(source_id + 1)
    tree = BVHTree.FromPolygons(verts, faces)
    x0 = floor(min(v[0] for v in verts)); z0 = floor(min(v[2] for v in verts))
    width = ceil(max(v[0] for v in verts)) - x0
    height = ceil(max(v[2] for v in verts)) - z0
    above = max(v[1] for v in verts) + 10
    pixels = bytearray(width * height)
    down = Vector((0, -1, 0))
    for row in range(height):
        z = z0 + row + .5
        for col in range(width):
            _, _, poly, _ = tree.ray_cast(Vector((x0 + col + .5, above, z)), down)
            if poly is not None:
                pixels[row * width + col] = ids[poly]
    return pixels, x0, z0, width, height


def old_footprints(folder, raw):
    meta = json.loads((folder / 'buildings.json').read_text())
    x0, z0 = meta['box'][:2]
    q = meta['q']
    nb, np, points = struct.unpack_from('<III', raw)
    off = 12
    def plane(n, wide=False):
        nonlocal off
        base = off
        off += n * (2 if wide else 1)
        if wide:
            return array('H', (raw[base+i] | raw[base+n+i] << 8 for i in range(n)))
        return raw[base:off]
    dx, dz = plane(nb, True), plane(nb, True)
    w, d, ang = plane(nb), plane(nb), plane(nb)
    off += 3*nb
    count = plane(np)
    off += 3*np
    px, pz = plane(points, True), plane(points, True)
    x = z = 0
    for i in range(nb):
        x = (x + dx[i]) & 65535; z = (z + dz[i]) & 65535
        cx, cz = x0 + x*q, z0 + z*q
        cw, sd = cos(ang[i]*pi/256), sin(ang[i]*pi/256)
        pw, pd = w[i]*q/2, d[i]*q/2
        corners = [(cx+cw*a-sd*b, cz+sd*a+cw*b) for a,b in ((-pw,-pd),(pw,-pd),(pw,pd),(-pw,pd))]
        yield 'boxes', i, corners
    x = z = k = 0
    for i, n in enumerate(count):
        ring = []
        for _ in range(n):
            x = (x + px[k]) & 65535; z = (z + pz[k]) & 65535; k += 1
            ring.append((x0+x*q,z0+z*q))
        yield 'polys', i, ring


def intersect(ring, projected):
    raw, x0, z0, width, height = projected
    xs, zs = zip(*ring)
    if (max(xs)<x0 or min(xs)>x0+width or max(zs)<z0 or min(zs)>z0+height):
        return 0, Counter()
    count = 0
    hits = Counter()
    edges = list(zip(ring, ring[1:] + ring[:1]))
    for row in range(ceil(min(zs)-z0-.5), ceil(max(zs)-z0-.5)):
        z = row+z0+.5
        cut = sorted(a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1])
                     for a,b in edges if a[1]<=z<b[1] or b[1]<=z<a[1])
        for a,b in zip(cut[::2],cut[1::2]):
            left, right = ceil(a-x0-.5), ceil(b-x0-.5)
            count += right-left
            if row>=0 and row<height:
                for col in range(max(0,left),min(width,right)):
                    source = raw[row*width+col]
                    if source:
                        hits[source-1] += 1
    return count, hits


fbx, folder, output = map(Path, sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(fbx), use_image_search=False)
projected = projected_roofs(bpy.context.scene.objects)
source_area = Counter(value-1 for value in projected[0] if value)
packed = (folder / 'buildings.bin').read_bytes()
raw = gzip.decompress(packed) if packed[:2] == b'\x1f\x8b' else packed
result = {'buildingsSha256': sha256(packed).hexdigest(), 'boxes': [], 'polys': []}
for typ, i, ring in old_footprints(folder, raw):
    area, hits = intersect(ring, projected)
    if not hits:
        continue
    source, best = hits.most_common(1)[0]
    # The station-front box includes annexes outside its single main roof;
    # a >95%-enclosed surveyed roof of comparable size is also a replacement.
    if sum(hits.values()) >= area*.5 or (best >= area*.4 and best >= source_area[source]*.95):
        result[typ].append([i,source])
output.write_text(json.dumps(result,separators=(',',':'))+'\n')
print('MATCHED',len(result['boxes']),len(result['polys']),flush=True)
