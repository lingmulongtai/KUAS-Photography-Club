"""Bounded, independently loadable city regions. Never overwrite core city assets.

Kyoto wards use PLATEAU measured heights. Kameoka/Sonobe use GSI building
outlines with explicitly illustrative heights; no PLATEAU coverage is claimed.
"""
import json
import os
import pickle
import struct
import sys
from concurrent.futures import ThreadPoolExecutor

import mapbox_vector_tile as mvt
import numpy as np
from PIL import Image
from shapely import make_valid
from shapely.geometry import box as sbox, shape
from shapely.ops import transform

import region as R
from common import CACHE, OUT, write_gz
from fetch import GSI, get, fetch_plateau, leaves, intersects
from build_buildings import export_buildings, heightfield
from build_lines import to_local_fn
from build_higashiyama import render, save
from build_arashiyama import polygons
from extract_buildings import decode_tile

REGIONS = {
    'kameoka': {'box': (-24000,-8000,-9000,4000), 'ja':'亀岡・保津峡', 'en':'Kameoka / Hozukyo'},
    'sonobe': {'box': (-33000,-18000,-21000,-8000), 'ja':'園部・八木', 'en':'Sonobe / Yagi'},
    'yamashina': {'box': (4600,-2500,12500,8500), 'ja':'山科', 'en':'Yamashina', 'wards':['26110_yamashina-ku']},
    'south': {'box': (-9000,6200,4600,19000), 'ja':'京都南部', 'en':'Southern Kyoto', 'wards':['26107_minami-ku','26109_fushimi-ku']},
}


def fetch_sources(region):
    box=region['box']
    jobs=[]
    sets=[('bvmap','experimental_bvmap',14,'pbf'),('seamlessphoto','seamlessphoto',13,'jpg')]
    if not region.get('wards'):
        sets.append(('bvmap','experimental_bvmap',15,'pbf'))
    for name,remote,zoom,ext in sets:
        for z,x,y in R.tiles_for(box,zoom):
            path=os.path.join(CACHE,'gsi',name,str(z),str(x),f'{y}.{ext}')
            jobs.append((f'{GSI}/{remote}/{z}/{x}/{y}.{ext}',path))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda job:get(*job),jobs))
    if '404' in results:
        raise RuntimeError('Missing regional map/imagery source')
    print('sources',len(jobs),{s:results.count(s) for s in set(results)},flush=True)
    if region.get('wards'):
        fetch_plateau(region['wards'],box)


def tiles(box,zoom):
    for z,x,y in R.tiles_for(box,zoom):
        path=os.path.join(CACHE,'gsi','bvmap',str(z),str(x),f'{y}.pbf')
        with open(path,'rb') as f:
            yield mvt.decode(f.read(),default_options={'y_coord_down':True}),to_local_fn(z,x,y)


def clipped_buildings(key,region):
    cache=os.path.join(CACHE,f'buildings-{key}.pkl')
    if os.path.exists(cache):
        with open(cache,'rb') as f:
            return pickle.load(f)
    clip=sbox(*region['box'])
    buildings=[]
    if region.get('wards'):
        seen=set()
        for ward in region['wards']:
            directory=os.path.join(CACHE,'plateau',ward)
            with open(os.path.join(directory,'tileset.json')) as f:
                root=json.load(f)['root']
            wanted=[]
            leaves(root,wanted)
            wanted=[t for t in wanted if intersects(t['boundingVolume']['region'],region['box'])]
            for i,tile in enumerate(wanted):
                path=os.path.join(directory,tile['content']['uri'].replace('/','_'))
                for b in decode_tile(path):
                    if b['id'] in seen:
                        continue
                    seen.add(b['id'])
                    for p in polygons(make_valid(shape({'type':'Polygon','coordinates':[b['ring']]})).intersection(clip)):
                        if p.area>=20:
                            buildings.append({**b,'ring':np.array(p.exterior.coords)[:-1]})
                if i%20==0:
                    print(key,ward,i,len(wanted),len(buildings),'buildings',flush=True)
    else:
        outlines=[]
        for data,project in tiles(region['box'],15):
            for ft in data.get('building',{}).get('features',[]):
                if ft['geometry']['type'] not in ('Polygon','MultiPolygon'):
                    continue
                geom=transform(project,make_valid(shape(ft['geometry'])).intersection(sbox(0,0,4096,4096)))
                outlines.extend(polygons(geom.intersection(clip)))
        # Merge the same footprint when GSI tile edges divide it. Touching
        # buildings retain their separate outlines unless the tile cut joins them.
        from shapely.ops import unary_union
        for p in polygons(unary_union(outlines)):
            if p.area<20:
                continue
            large=p.area>=350
            buildings.append({'ring':np.array(p.exterior.coords)[:-1],
                'height':10 if large else 6,'ground':None,'class':'堅ろう建物' if large else '普通建物',
                'usage':'','storeys':None,'name':''})
    if not buildings:
        raise RuntimeError('No regional buildings decoded')
    with open(cache,'wb') as f:
        pickle.dump(buildings,f)
    print(key,len(buildings),'source buildings',flush=True)
    return buildings


def line_parts(g):
    if g.is_empty:
        return []
    if g.geom_type=='LineString':
        return [g]
    return [p for child in getattr(g,'geoms',[]) for p in line_parts(child)]


def export_lines(key,box):
    feats=[]
    clip=sbox(*box)
    origin=np.array(box[:2])
    def add(kind,attr,coords):
        q=np.round((np.array(coords)-origin)/.5).astype(np.int32)
        if len(q)<2:
            return
        q=q[np.r_[True,np.any(np.diff(q,axis=0),axis=1)]]
        if len(q)>= (3 if kind>=2 else 2):
            if len(q)>65535 or q.min()<0 or q.max()>32767:
                raise RuntimeError('Regional line coordinate overflow')
            feats.append((kind,attr,q))
    for data,project in tiles(box,14):
        for layer,kind in [('road',0),('railway',1),('waterarea',2)]:
            for ft in data.get(layer,{}).get('features',[]):
                p=ft['properties'];attr=0
                if kind==0:
                    rank=int(p.get('rnkWidth') or 0)
                    if rank<1:
                        continue
                    category=int(p['rdCtg']) if p.get('rdCtg') is not None else 2
                    attr=rank|(category<<4)
                elif kind==1:
                    state=p.get('railState')
                    if state not in (0,1):
                        continue
                    attr=(1 if state==1 else 0)|(2 if p.get('snglDbl')==2 else 0)
                g=transform(project,make_valid(shape(ft['geometry'])).intersection(sbox(0,0,4096,4096))).intersection(clip)
                if kind<2:
                    for part in line_parts(g):
                        add(kind,attr,list(part.simplify(1).coords))
                else:
                    for part in polygons(g):
                        if part.area<10:
                            continue
                        part=part.simplify(1)
                        add(2,0,list(part.exterior.coords)[:-1])
                        for hole in part.interiors:
                            add(3,0,list(hole.coords)[:-1])
    if not feats:
        raise RuntimeError('No regional infrastructure')
    kinds=np.array([f[0] for f in feats],np.uint8);attrs=np.array([f[1] for f in feats],np.uint8)
    counts=np.array([len(f[2]) for f in feats],'<u2')
    last=np.zeros(2,np.int32);steps=[]
    for _,_,pts in feats:
        steps.append(np.diff(pts,axis=0,prepend=[last]));last=pts[-1]
    steps=np.concatenate(steps)
    if np.abs(steps).max()>32767:
        raise RuntimeError('Regional line delta overflow')
    def planes(v):
        u=v.astype(np.int16).view(np.uint16)
        return (u&255).astype(np.uint8).tobytes()+(u>>8).astype(np.uint8).tobytes()
    payload=struct.pack('<I',len(feats))+kinds.tobytes()+attrs.tobytes()+counts.tobytes()+planes(steps[:,0])+planes(steps[:,1])
    name=f'lines-{key}.bin'
    size=write_gz(name,payload)
    return {'file':name,'box':box,'q':.5,'bytes':size,'features':len(feats)}


def build(key,region):
    fetch_sources(region)
    buildings=clipped_buildings(key,region)
    export_buildings(buildings,box=region['box'],stem=f'buildings-{key}',ground_at=heightfield(),
                     keep_fn=lambda b,area,x,z:area>=20,close_fn=lambda x,z:True)
    lines=export_lines(key,region['box'])
    building_bytes=os.path.getsize(os.path.join(OUT,f'buildings-{key}.bin'))
    if building_bytes+lines['bytes']>1.5*1024*1024:
        raise RuntimeError('Regional vector assets exceed 1.5 MiB budget')
    width=region['box'][2]-region['box'][0];depth=region['box'][3]-region['box'][1]
    dims=(2048,round(2048*depth/width)) if width>=depth else (round(2048*width/depth),2048)
    photo=render(region['box'],dims,13,oversample=1)
    _,size=save(photo,f'aerial-{key}.webp',600_000)
    mobile=photo.resize(tuple(round(v/2) for v in dims),Image.Resampling.LANCZOS)
    _,mobile_size=save(mobile,f'aerial-{key}-mobile.webp',220_000)
    return {'id':key,'ja':region['ja'],'en':region['en'],'box':region['box'],
        'heightSource':'PLATEAU measured' if region.get('wards') else 'GSI outlines; illustrative heights (6 m / 10 m)',
        'buildings':{'meta':f'buildings-{key}.json','file':f'buildings-{key}.bin','bytes':building_bytes},'lines':lines,
        'photo':{'box':region['box'],'file':f'aerial-{key}.webp','size':dims,'bytes':size,'zoom':13,
                 'mobile':{'file':f'aerial-{key}-mobile.webp','size':mobile.size,'bytes':mobile_size}}}


def main():
    path=os.path.join(OUT,'regions.json')
    existing=json.load(open(path,encoding='utf-8')) if os.path.exists(path) else {'regions':[]}
    selected=sys.argv[1:] or list(REGIONS)
    for key in selected:
        entry=build(key,REGIONS[key])
        existing['regions']=[r for r in existing['regions'] if r['id']!=key]+[entry]
        with open(path,'w',encoding='utf-8') as f:
            json.dump(existing,f,ensure_ascii=False,indent=1);f.write('\n')
        print('finished',key,flush=True)


if __name__=='__main__':
    main()
