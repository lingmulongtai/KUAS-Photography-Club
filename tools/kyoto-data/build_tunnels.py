"""
Road tunnels from the GSI vector map (z14), so the browser can lift them out of the road network
instead of painting them over the mountain they pass through. Covers the core box and every
regional box; lines.bin and lines-*.bin stay byte-for-byte intact (water patches index into them).

GSI road ftCode: 2704 道路トンネル, 2714 軽車道トンネル, 2724 徒歩道トンネル.
Writes public/kyoto/tunnels.json.gz: {"source", "lines": [[x0, z0, x1, z1, …], …]} in local metres,
rounded to 0.5 m.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor

import mapbox_vector_tile as mvt
from shapely.geometry import LineString, box as sbox, shape
from shapely.ops import linemerge

import region as R
from build_lines import EXTENT, parts, to_local_fn
from common import CACHE, OUT, write_gz
from fetch import GSI, get

TUNNEL_CODES = (2704, 2714, 2724)


def tiles():
    with open(os.path.join(OUT, 'regions.json'), encoding='utf-8') as f:
        regions = json.load(f)['regions']
    out = set()
    for b in [R.LINES] + [r['lines']['box'] for r in regions]:
        out.update(R.tiles_for(b, 14))
    return sorted(out)


def main():
    jobs = []
    for z, x, y in tiles():
        path = os.path.join(CACHE, 'gsi', 'bvmap', str(z), str(x), f'{y}.pbf')
        jobs.append((f'{GSI}/experimental_bvmap/{z}/{x}/{y}.pbf', path))
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda job: get(*job), jobs))
    if '404' in results:
        raise RuntimeError('Missing vector map tile')

    clip = sbox(0, 0, EXTENT, EXTENT)
    segs = []
    for (z, x, y), (_, path) in zip(tiles(), jobs):
        loc = to_local_fn(z, x, y)
        d = mvt.decode(open(path, 'rb').read(), default_options={'y_coord_down': True})
        for ft in d.get('road', {}).get('features', []):
            if ft['properties'].get('ftCode') not in TUNNEL_CODES:
                continue
            for g in parts(shape(ft['geometry']).intersection(clip)):
                if g.geom_type == 'LineString' and len(g.coords) >= 2:
                    line = LineString([loc(px, py) for px, py in g.coords])
                    if line.length > 0:
                        segs.append(line)
    lines = []
    for g in parts(linemerge(segs)):
        g = g.simplify(0.5)
        if g.length < 4:
            continue
        lines.append([round(v * 2) / 2 for p in g.coords for v in p])
    payload = {'source': 'GSI experimental_bvmap z14 road ftCode 2704/2714/2724', 'lines': lines}
    size = write_gz('tunnels.json.gz', json.dumps(payload, separators=(',', ':')).encode())
    print('tunnels', len(lines), 'km', round(sum(LineString(list(zip(l[::2], l[1::2]))).length for l in lines) / 1000, 1),
          'gz', size)


if __name__ == '__main__':
    main()
