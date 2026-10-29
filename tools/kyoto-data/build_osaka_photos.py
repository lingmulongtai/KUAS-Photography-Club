"""Bounded close Osaka imagery: one 4 km sheet loaded at a time by the browser."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import region as R
from common import CACHE, OUT
from fetch import GSI, get
from build_higashiyama import render, save

BOX=(-30000,20000,-14000,36000)
ZOOM=16

def main():
    jobs=[]
    for z,x,y in R.tiles_for(BOX,ZOOM):
        path=os.path.join(CACHE,'gsi','seamlessphoto',str(z),str(x),f'{y}.jpg')
        jobs.append((f'{GSI}/seamlessphoto/{z}/{x}/{y}.jpg',path))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda j:get(*j),jobs))
    if '404' in results:
        raise RuntimeError('Missing Osaka close imagery')
    print('sources',len(jobs),{s:results.count(s) for s in set(results)},flush=True)
    photos=[]
    for row in range(4):
        for col in range(4):
            x=BOX[0]+col*4000;z=BOX[1]+row*4000
            box=(x,z,x+4000,z+4000)
            stem=f'aerial-osaka-{row}-{col}'
            photo=render(box,(1536,1536),ZOOM,oversample=1)
            _,size=save(photo,stem+'.webp',760000)
            mobile=photo.resize((768,768),Image.Resampling.LANCZOS)
            _,mobile_size=save(mobile,stem+'-mobile.webp',260000)
            photos.append({'box':box,'file':stem+'.webp','size':photo.size,'bytes':size,'zoom':ZOOM,
                'mobile':{'file':stem+'-mobile.webp','size':mobile.size,'bytes':mobile_size}})
            print(stem,size,mobile_size,flush=True)
    with open(os.path.join(OUT,'photos-osaka.json'),'w',encoding='utf-8') as f:
        json.dump({'source':'GSI seamlessphoto z16','photos':photos},f,indent=1);f.write('\n')

if __name__=='__main__':
    main()
