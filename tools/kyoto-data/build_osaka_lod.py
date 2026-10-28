"""Build a bounded distant Osaka skyline from GSI footprints and PLATEAU heights."""
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor

import mapbox_vector_tile as mvt
import numpy as np
from shapely import make_valid
from shapely.geometry import Polygon, box as sbox, shape
from shapely.ops import transform

import region as R
from build_arashiyama import polygons
from build_buildings import heightfield
from build_lines import to_local_fn
from common import CACHE, write_gz
from extract_buildings import decode_tile
from fetch import GSI, get

B = (-30000, 15000, -9000, 36000)
TENNOZAN = (-14000, 8500, 500, 23000)
CELL = 250
PLATEAU = ('https://assets.cms.plateau.reearth.io/assets/73/bc9017-e521-43f2-8777-2837eefd9795/'
           '27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27127_kita-ku_lod1/data/data70.b3dm')


def rectangle(poly, height, ground):
    rect = poly.minimum_rotated_rectangle
    pts = np.array(rect.exterior.coords)[:4]
    e1, e2 = pts[1]-pts[0], pts[2]-pts[1]
    w, d = np.hypot(*e1), np.hypot(*e2)
    if d > w:
        e1, w, d = e2, d, w
    c = rect.centroid
    return [round(c.x), round(c.y), round(float(w)*2)/2, round(float(d)*2)/2,
            round(float(height)*2)/2, round(math.atan2(e1[1],e1[0]) % math.pi,3), round(float(ground),2)]


def main():
    jobs = []
    for z,x,y in R.tiles_for(B,14):
        p=os.path.join(CACHE,'gsi','bvmap',str(z),str(x),f'{y}.pbf')
        jobs.append((f'{GSI}/experimental_bvmap/{z}/{x}/{y}.pbf',p,z,x,y))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda job:get(job[0],job[1]),jobs))
    if '404' in results:
        raise RuntimeError('Missing Osaka vector tile')
    print('Osaka overview tiles',len(jobs),{s:results.count(s) for s in set(results)},flush=True)
    clip=sbox(*B)
    candidates={}
    for _,path,z,x,y in jobs:
        data=mvt.decode(open(path,'rb').read(),default_options={'y_coord_down':True})
        project=to_local_fn(z,x,y)
        for feature in data.get('building',{}).get('features',[]):
            if feature['geometry']['type'] not in ('Polygon','MultiPolygon'):
                continue
            geometry=transform(project,make_valid(shape(feature['geometry'])).intersection(sbox(0,0,4096,4096)))
            for poly in polygons(geometry.intersection(clip)):
                if poly.area<30:
                    continue
                c=poly.centroid
                if TENNOZAN[0]<=c.x<TENNOZAN[2] and TENNOZAN[1]<=c.y<TENNOZAN[3]:
                    continue
                key=(math.floor(c.x/CELL),math.floor(c.y/CELL))
                score=poly.area
                if key not in candidates or score>candidates[key][0]:
                    candidates[key]=(score,rectangle(poly,10 if score>=350 else 6,0))
    boxes=[entry for _,entry in candidates.values()]
    path=os.path.join(CACHE,'plateau','osaka-kita-root.b3dm')
    if get(PLATEAU,path)=='404':
        raise RuntimeError('Missing Osaka PLATEAU root tile')
    ground_at=heightfield()
    towers=[]
    for b in decode_tile(path):
        if b['height']<=127.5:
            continue
        poly=Polygon(b['ring'])
        if poly.is_empty or not clip.contains(poly.centroid):
            continue
        c=poly.centroid
        offset=0 if b['ground'] is None else b['ground']-ground_at(c.x,c.y)
        towers.append(rectangle(poly,b['height'],offset))
    # A measured tower must not also appear as a low illustrative block.
    boxes=[b for b in boxes if all(math.hypot(b[0]-t[0],b[1]-t[1])>35 for t in towers)]
    if len(towers)<5 or len(boxes)<1000:
        raise RuntimeError('Osaka overview source unexpectedly sparse')
    data={'source':'GSI experimental_bvmap z14; Osaka Kita PLATEAU 2025 LOD1 root',
          'box':B,'cell':CELL,'buildings':boxes,'towers':towers}
    size=write_gz('buildings-osaka-lod.json.gz',json.dumps(data,separators=(',',':')).encode())
    if size>150000:
        raise RuntimeError('Osaka overview exceeds 150 KB budget')
    print('Osaka overview',len(boxes),'blocks',len(towers),'measured towers',size,'bytes',flush=True)


if __name__=='__main__':
    main()
