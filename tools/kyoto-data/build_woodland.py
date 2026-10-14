"""Convert an Overpass woodland export to bounded, metre-based polygons.

Query: (way["natural"="wood"](34.88,135.60,35.13,135.86);
way["landuse"="forest"](34.88,135.60,35.13,135.86);
relation["natural"="wood"](34.88,135.60,35.13,135.86);
relation["landuse"="forest"](34.88,135.60,35.13,135.86););out geom;
Usage: python build_woodland.py path/to/overpass.json
Source: https://www.openstreetmap.org/copyright (ODbL).
"""
import gzip
import json
from pathlib import Path
import sys
import region as R


def point(p):
    x, z = R.to_local(p['lat'], p['lon'])
    return round(x), round(z)


def rings(chains):
    pending = [list(map(point, chain)) for chain in chains if len(chain) > 1]
    result = []
    while pending:
        ring = pending.pop()
        while ring[-1] != ring[0]:
            found = False
            for i, other in enumerate(pending):
                if ring[-1] == other[0]:
                    ring.extend(other[1:])
                elif ring[-1] == other[-1]:
                    ring.extend(other[-2::-1])
                elif ring[0] == other[-1]:
                    ring = other[:-1] + ring
                elif ring[0] == other[0]:
                    ring = other[:0:-1] + ring
                else:
                    continue
                pending.pop(i)
                found = True
                break
            if not found:
                raise ValueError('Unclosed woodland relation')
        if len(ring) >= 4:
            result.append(ring)
    return result


def simplify(points, epsilon=2):
    # Iterative Douglas-Peucker: retain closed rings and coastline/clearance details.
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, az = points[a]
        dx, dz = points[b][0] - ax, points[b][1] - az
        distance, index = 0, a
        for i in range(a + 1, b):
            x, z = points[i]
            t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / max(1, dx * dx + dz * dz)))
            d = (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2
            if d > distance:
                distance, index = d, i
        if distance > epsilon ** 2:
            keep.add(index)
            stack.extend([(a, index), (index, b)])
    out = [points[i] for i in sorted(keep)]
    return out if len(out) >= 4 else points


def main(path):
    source = json.loads(Path(path).read_text(encoding='utf-8'))
    relations = [e for e in source['elements'] if e['type'] == 'relation']
    members = {m['ref'] for e in relations for m in e.get('members', []) if m['type'] == 'way'}
    polygons = []
    for e in source['elements']:
        if e['type'] == 'way' and e['id'] not in members:
            outer = rings([e['geometry']])
            polygons.extend({'outer': [simplify(r)], 'holes': []} for r in outer)
        elif e['type'] == 'relation':
            outer = rings([m.get('geometry', []) for m in e['members'] if m['type'] == 'way' and m.get('role') != 'inner'])
            holes = rings([m.get('geometry', []) for m in e['members'] if m['type'] == 'way' and m.get('role') == 'inner'])
            if outer:
                polygons.append({'outer': [simplify(r) for r in outer], 'holes': [simplify(r) for r in holes]})
    data = {'source': '© OpenStreetMap contributors, ODbL', 'timestamp': source.get('osm3s', {}).get('timestamp_osm_base'), 'polygons': polygons}
    payload = gzip.compress(json.dumps(data, separators=(',', ':')).encode(), mtime=0)
    if len(payload) > 1024 * 1024:
        raise ValueError('Woodland data exceeds 1 MiB budget')
    out = Path(__file__).resolve().parents[2] / 'public/kyoto/woodland.json.gz'
    out.write_bytes(payload)
    print(len(polygons), 'woodland polygons;', len(payload), 'compressed bytes')


if __name__ == '__main__':
    main(sys.argv[1])
