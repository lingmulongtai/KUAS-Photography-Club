"""Pack native Hyogo DSM minus DEM in centimetres for street views around Kobe's port and Sannomiya."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
from io import BytesIO
import json
import math
from pathlib import Path
import struct
import time

import numpy as np
from PIL import Image
import requests

DATA = Path(__file__).resolve().parents[2] / 'public/kansai'
ZOOM = 17


def tile(lon, lat):
    scale = 2**ZOOM
    return math.floor((lon+180)/360*scale), math.floor((1-math.asinh(math.tan(math.radians(lat)))/math.pi)*scale/2)


def elevation(cache, layer, x, y):
    path = cache / f'{layer}-{x}-{y}.png'
    if not path.exists():
        url = f'https://tiles.gsj.jp/tiles/elev/{layer}/{ZOOM}/{y}/{x}.png'
        for attempt in range(4):
            try:
                res = requests.get(url, timeout=30)
                if res.status_code == 404:
                    return None
                res.raise_for_status()
                Image.open(BytesIO(res.content)).verify()
                path.write_bytes(res.content)
                break
            except (requests.RequestException, OSError):
                if attempt == 3:
                    raise
                time.sleep(1+attempt)
    with Image.open(path) as image:
        rgba = np.asarray(image.convert('RGBA'), np.int32)
    rgb = rgba[:,:,0]*65536+rgba[:,:,1]*256+rgba[:,:,2]
    return np.where(rgb>=8388608, rgb-16777216, rgb), rgba[:,:,3]>0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    out = DATA/'kobe-street-heights'
    out.mkdir(exist_ok=True)
    coverage = json.loads((DATA/'lidar-coverage.json').read_text())
    west,north = tile(135.165,34.714)
    east,south = tile(135.221,34.664)

    def write_pack(key):
        px,py = key
        blocks = []
        for slot in range(16):
            x,y = px*4+slot%4,py*4+slot//4
            mask = bytes.fromhex(coverage.get(f'{x//32}/{y//32}', ''))
            bit = (y%32)*32+x%32
            if not mask or not (mask[bit//8] >> (bit%8)) & 1:
                blocks.append(b'')
                continue
            dsm = elevation(args.cache,'hyogodsm',x,y)
            dem = elevation(args.cache,'hyogodem',x,y)
            heights = np.zeros((256,256),dtype='<u2')
            if dsm is not None and dem is not None:
                delta = dsm[0]-dem[0]
                valid = dsm[1] & dem[1] & (delta>=200) & (delta<=33000)
                heights[valid] = delta[valid]
            blocks.append(gzip.compress(heights.tobytes(),compresslevel=6,mtime=0))
        if not any(blocks):
            return None
        offsets = [17*4]
        for block in blocks:
            offsets.append(offsets[-1]+len(block))
        name = f'{px}-{py}'
        (out/(name+'.bin')).write_bytes(struct.pack('<17I',*offsets)+b''.join(blocks))
        return name

    jobs = [(x,y) for x in range(west//4,east//4+1) for y in range(north//4,south//4+1)]
    with ThreadPoolExecutor(max_workers=5) as pool:
        names = sorted(name for name in pool.map(write_pack,jobs) if name)
    (out/'index.json').write_text(json.dumps(names,separators=(',',':'))+'\n')
    print(len(names),'street height packs',flush=True)


if __name__ == '__main__':
    main()
