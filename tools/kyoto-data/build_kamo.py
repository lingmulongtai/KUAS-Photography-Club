"""High-resolution Kamo shoreline, preserving the delta, shoals and every core road/rail."""
import os
from concurrent.futures import ThreadPoolExecutor

import region as R
from common import CACHE
from fetch import GSI,get
from build_arashiyama import water

B=(450,-3600,1650,1500)


def main():
    jobs=[]
    for z,x,y in R.tiles_for(B,16):
        jobs.append((f'{GSI}/experimental_bvmap/{z}/{x}/{y}.pbf',
                     os.path.join(CACHE,'gsi','bvmap',str(z),str(x),f'{y}.pbf')))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda job:get(*job),jobs))
    if '404' in results:
        raise RuntimeError('Missing Kamo source tiles')
    print('Kamo sources',len(jobs),{s:results.count(s) for s in set(results)},flush=True)
    water(B,'water-kamo.json.gz',attr=2)


if __name__=='__main__':
    main()
