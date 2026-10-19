"""Sharp, bounded GSI imagery for the Phoenix Hall, Aji Pond and Uji River."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import region as R
from common import CACHE, OUT
from fetch import GSI, get
from build_higashiyama import render, save

B = (3700, 12000, 5100, 13400)

def main():
    jobs = []
    for z, x, y in R.tiles_for(B, 17, pad=1):
        path = os.path.join(CACHE, 'gsi', 'seamlessphoto', str(z), str(x), f'{y}.jpg')
        jobs.append((f'{GSI}/seamlessphoto/{z}/{x}/{y}.jpg', path))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda job: get(*job), jobs))
    if '404' in results:
        raise RuntimeError('Missing Uji detail source')
    photo = render(B, (1536, 1536), 17)
    _, size = save(photo, 'aerial-byodoin.webp', 600000)
    mobile = photo.resize((768, 768), Image.Resampling.LANCZOS)
    _, mobile_size = save(mobile, 'aerial-byodoin-mobile.webp', 200000)
    path = os.path.join(OUT, 'terrain.json')
    with open(path, encoding='utf-8') as f:
        meta = json.load(f)
    meta['byodoin'] = {'box': B, 'file': 'aerial-byodoin.webp', 'size': photo.size,
        'bytes': size, 'zoom': 17, 'mobile': {'file': 'aerial-byodoin-mobile.webp',
        'size': mobile.size, 'bytes': mobile_size}}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    print('Byodoin detail', size, mobile_size, len(jobs), 'source tiles', flush=True)

if __name__ == '__main__':
    main()
