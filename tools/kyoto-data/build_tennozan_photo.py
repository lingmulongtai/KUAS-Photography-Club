"""Build a bounded, sharper GSI photo of Tennozan and the three-river confluence."""
import json
import os
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

import region as R
from common import CACHE, OUT
from fetch import GSI, get
from build_higashiyama import render, save

B = (-9000, 10500, -4000, 15500)
ZOOM = 16


def main():
    jobs = []
    for z, x, y in R.tiles_for(B, ZOOM):
        path = os.path.join(CACHE, 'gsi', 'seamlessphoto', str(z), str(x), f'{y}.jpg')
        jobs.append((f'{GSI}/seamlessphoto/{z}/{x}/{y}.jpg', path))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda job: get(*job), jobs))
    if '404' in results:
        raise RuntimeError('Missing Tennozan imagery')
    photo = render(B, (2048, 2048), ZOOM, oversample=1)
    _, size = save(photo, 'aerial-tennozan-detail.webp', 760000)
    mobile = photo.resize((1024, 1024), Image.Resampling.LANCZOS)
    _, mobile_size = save(mobile, 'aerial-tennozan-detail-mobile.webp', 260000)
    path = os.path.join(OUT, 'terrain.json')
    with open(path, encoding='utf-8') as f:
        meta = json.load(f)
    meta['tennozan'] = {'box': B, 'file': 'aerial-tennozan-detail.webp', 'size': photo.size,
        'bytes': size, 'zoom': ZOOM, 'mobile': {'file': 'aerial-tennozan-detail-mobile.webp',
        'size': mobile.size, 'bytes': mobile_size}}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    print('Tennozan detail', size, mobile_size, len(jobs), 'source tiles', flush=True)


if __name__ == '__main__':
    main()
