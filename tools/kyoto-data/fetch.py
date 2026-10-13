"""
Download the raw sources into cache/ (not committed). Safe to re-run: files already there are skipped.

  python3 fetch.py gsi        # elevation, aerial photos and vector map tiles from GSI
  python3 fetch.py plateau    # PLATEAU LOD1 building tiles for the wards in view
"""
import json
import os
import sys
import time
import urllib.request

import region as R

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
UA = {'User-Agent': 'KUAS-Photography-Club website build (github.com/lingmulongtai/KUAS-Photography-Club)'}

GSI = 'https://cyberjapandata.gsi.go.jp/xyz'
GSI_SETS = [
    # (name, url pattern, tiles)
    ('dem_png', GSI + '/dem_png/{z}/{x}/{y}.png', R.tiles_for(R.TERRAIN, 12, pad=1)),
    ('dem_png', GSI + '/dem_png/{z}/{x}/{y}.png', R.tiles_for(R.NEAR, 14, pad=1)),
    ('dem5a_png', GSI + '/dem5a_png/{z}/{x}/{y}.png', R.tiles_for(R.NEAR, 15, pad=1)),
    ('seamlessphoto', GSI + '/seamlessphoto/{z}/{x}/{y}.jpg', R.tiles_for(R.TERRAIN, 13)),
    ('seamlessphoto', GSI + '/seamlessphoto/{z}/{x}/{y}.jpg', R.tiles_for(R.AERIAL_DETAIL, 15)),
    ('bvmap', GSI + '/experimental_bvmap/{z}/{x}/{y}.pbf', R.tiles_for(R.LINES, 14)),
]

PLATEAU_ZIP = 'https://assets.cms.plateau.reearth.io/assets/68/ffd721-509d-4a18-9e20-9c5ecab908d6/26100_kyoto-shi_city_2025_3dtiles_mvt_1_op.zip'
PLATEAU_PREFIX = '26100_kyoto-shi_city_2025_citygml_1_op_bldg_3dtiles_'
WARDS = ['26101_kita-ku', '26102_kamigyo-ku', '26103_sakyo-ku', '26104_nakagyo-ku', '26105_higashiyama-ku',
         '26106_shimogyo-ku', '26107_minami-ku', '26108_ukyo-ku', '26109_fushimi-ku', '26111_nishikyo-ku']


def get(url, path):
    if os.path.exists(path):
        return 'cached'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                open(path + '.404', 'w').close()
                return '404'
            time.sleep(2 ** attempt)
        except Exception:
            time.sleep(2 ** attempt)
    else:
        raise RuntimeError('failed: ' + url)
    with open(path + '.part', 'wb') as f:
        f.write(data)
    os.replace(path + '.part', path)
    time.sleep(0.12)  # be gentle with the tile server
    return 'ok'


def fetch_gsi():
    for name, pattern, tiles in GSI_SETS:
        counts = {}
        for z, x, y in tiles:
            ext = pattern.rsplit('.', 1)[1]
            path = os.path.join(CACHE, 'gsi', name, str(z), str(x), f'{y}.{ext}')
            if os.path.exists(path + '.404'):
                counts['404'] = counts.get('404', 0) + 1
                continue
            s = get(pattern.format(z=z, x=x, y=y), path)
            counts[s] = counts.get(s, 0) + 1
        print(name, tiles[0][0], counts)


def intersects(region_rad, box):
    import math
    w, s, e, n = (math.degrees(v) for v in region_rad[:4])
    x0, z1 = R.to_local(s, w)
    x1, z0 = R.to_local(n, e)
    minx, minz, maxx, maxz = box
    return x1 >= minx and x0 <= maxx and z1 >= minz and z0 <= maxz


def leaves(tile, out):
    kids = tile.get('children') or []
    if not kids:
        if 'content' in tile:
            out.append(tile)
    for k in kids:
        leaves(k, out)


def fetch_plateau():
    import remotezip as rz
    dir_path = os.path.join(CACHE, 'plateau', 'directory.json')
    if not os.path.exists(dir_path):
        os.makedirs(os.path.dirname(dir_path), exist_ok=True)
        json.dump(rz.directory(PLATEAU_ZIP), open(dir_path, 'w'))
    entries = {e['name']: e for e in json.load(open(dir_path))}
    for ward in WARDS:
        base = f'{PLATEAU_PREFIX}{ward}_lod1/'
        out_dir = os.path.join(CACHE, 'plateau', ward)
        os.makedirs(out_dir, exist_ok=True)
        ts_path = os.path.join(out_dir, 'tileset.json')
        if not os.path.exists(ts_path):
            open(ts_path, 'wb').write(rz.read(PLATEAU_ZIP, entries[base + 'tileset.json']))
        tileset = json.load(open(ts_path))
        tiles = []
        leaves(tileset['root'], tiles)
        wanted = [t for t in tiles if intersects(t['boundingVolume']['region'], R.BUILDINGS)]

        def one(t):
            uri = t['content']['uri']
            path = os.path.join(out_dir, uri.replace('/', '_'))
            if os.path.exists(path):
                return 0
            data = rz.read(PLATEAU_ZIP, entries[base + uri])
            with open(path + '.part', 'wb') as f:
                f.write(data)
            os.replace(path + '.part', path)
            return 1

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(8) as pool:
            got = sum(pool.map(one, wanted))
        print(ward, f'{len(wanted)}/{len(tiles)} leaf tiles in the area, {got} downloaded', flush=True)


if __name__ == '__main__':
    what = sys.argv[1:] or ['gsi', 'plateau']
    if 'gsi' in what:
        fetch_gsi()
    if 'plateau' in what:
        fetch_plateau()
