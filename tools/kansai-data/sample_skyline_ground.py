"""Bake the level-11 PLATEAU quantized-mesh elevation underneath every far building.

Run with an output cache directory, then pass that directory to build_skyline_mesh.mjs.
Heights are little-endian signed decimetres above the WGS84 ellipsoid.
"""
import argparse
import gzip
import json
import math
import struct
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np

ROOT = Path(__file__).resolve().parents[2] / 'public/kansai/skyline'
BASE = 'https://tile.plateauview.mlit.go.jp/terrain'
LEVEL = 11
SIDE = 2**LEVEL
CELLS = 32


def decode(raw):
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    low, high = struct.unpack_from('<ff', raw, 24)
    count, = struct.unpack_from('<I', raw, 88)
    coords = np.frombuffer(raw, '<u2', 3*count, 92).reshape(3, count).astype('int32')
    coords = ((coords >> 1) ^ -(coords & 1)).cumsum(axis=1).T / 32767
    coords[:,2] = low + (high-low)*coords[:,2]
    size = 4 if count > 65536 else 2
    offset = (92+count*6+size-1)//size*size
    faces, = struct.unpack_from('<I', raw, offset)
    codes = np.frombuffer(raw, '<u'+str(size), faces*3, offset+4).astype('int32')
    highest = (codes==0).cumsum() - (codes==0)
    return coords[(highest-codes).reshape(faces,3)]


def fetch(cache, x, y):
    path = cache/f'{x}-{y}.terrain'
    if not path.exists():
        for attempt in range(4):
            try:
                req = Request(f'{BASE}/{LEVEL}/{x}/{y}.terrain', headers={'Accept':'application/vnd.quantized-mesh'})
                with urlopen(req, timeout=40) as response:
                    raw=response.read()
                triangles=decode(raw)
                path.write_bytes(raw)
                return triangles
            except Exception:
                if attempt==3: raise
                time.sleep(1+attempt)
    return decode(path.read_bytes())


def bake(cache, entry):
    (x,y), rows=entry
    cells=defaultdict(list)
    for i,(_,_,u,v) in enumerate(rows):
        cells[min(CELLS-1,int(u*CELLS)),min(CELLS-1,int(v*CELLS))].append(i)
    tris=fetch(cache,x,y)
    lower=tris[:,:,:2].min(axis=1)
    upper=tris[:,:,:2].max(axis=1)
    values=np.full(len(rows),np.nan)
    for (i,j), ids in cells.items():
        local=tris[(lower[:,0]<=(i+1)/CELLS)&(upper[:,0]>=i/CELLS)&(lower[:,1]<=(j+1)/CELLS)&(upper[:,1]>=j/CELLS)]
        a,b,c=local[:,0,:],local[:,1,:],local[:,2,:]
        v0,v1=b-a,c-a
        det=v0[:,0]*v1[:,1]-v0[:,1]*v1[:,0]
        usable=np.abs(det)>1e-12
        for k in ids:
            _,_,u,v=rows[k]
            dx,dy=u-a[:,0],v-a[:,1]
            s=(dx*v1[:,1]-dy*v1[:,0])/np.where(usable,det,1)
            t=(v0[:,0]*dy-v0[:,1]*dx)/np.where(usable,det,1)
            hit=np.flatnonzero(usable & (s>=-1e-7)&(t>=-1e-7)&(s+t<=1.0000001))
            if not len(hit): raise ValueError(('terrain gap',x,y,u,v))
            n=hit[0]; values[k]=a[n,2]+s[n]*v0[n,2]+t[n]*v1[n,2]
    return [(key,i,round(10*h)) for (key,i,_,_),h in zip(rows,values)]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    cache=parser.parse_args().cache
    cache.mkdir(exist_ok=True,parents=True)
    tiles=defaultdict(list); districts={}
    for f in ROOT.glob('*.json.gz'):
        key=f.name.split('.')[0];x,y=map(int,key.split('-'))
        rows=json.loads(gzip.decompress(f.read_bytes()))
        districts[key]=np.zeros(len(rows),dtype='<i2')
        for i, row in enumerate(rows):
            ring=row[4][0];xs=ring[::2];ys=ring[1::2]
            lon=(x+(min(xs)+max(xs))/32768)/4096*360-180
            def latitude(v): return math.degrees(math.atan(math.sinh(math.pi*(1-2*(y+v/16384)/4096))))
            lat=(latitude(min(ys))+latitude(max(ys)))/2
            u,v=(lon+180)*SIDE/180,(lat+90)*SIDE/180
            tx,ty=math.floor(u),math.floor(v)
            tiles[tx,ty].append((key,i,u-tx,v-ty))
    with ThreadPoolExecutor(max_workers=5) as pool:
        for data in pool.map(lambda e:bake(cache,e),tiles.items()):
            for key,i,height in data: districts[key][i]=height
    for key,heights in districts.items(): (cache/(key+'.i16')).write_bytes(heights.tobytes())
    print(sum(map(len,districts.values())), 'terrain samples in',len(tiles),'surface tiles')


if __name__=='__main__':
    main()
