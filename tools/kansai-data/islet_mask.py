"""Preserve N03 islands which fall between the three-metre ownership samples."""
from math import ceil
from pathlib import Path

import numpy as np
from PIL import Image
from shapely import STRtree, box, contains_xy, get_parts

ORIGIN = np.array([134., 33.75])
SAMPLES = 32768
QUANTIZE = 4_000_000_000


def indices(geom):
    w, s, e, n = geom.bounds
    x, y = np.floor(([w, s]-ORIGIN)*SAMPLES).astype(int)
    xx, yy = np.floor(([e, n]-ORIGIN)*SAMPLES).astype(int)
    return x, y, xx+1, yy+1


def sampled(geom):
    # A narrow island can have some land samples and still map its own interior point to sea.
    p = np.floor((np.array(geom.representative_point().coords[0])-ORIGIN)*SAMPLES)
    return contains_xy(geom, *(ORIGIN+(p+.5)/SAMPLES))


def pointer(pixel):
    r,g,b = map(int,pixel)
    return (r-250)*65536+b*256+g


def base_owner(pixel, fine, x, y):
    if pixel[0] < 250:
        return int(pixel[0])
    n = pointer(pixel)
    r,g,b = map(int,fine[n//256*4+y//4,n%256*8+x//2])
    code = ((r+(g<<8)+(b<<16))>>(3*((y%4)*2+x%2))) & 7
    return 24+code if code else 0


def pack_islets(path:Path, parts):
    # The original rings stay intact. A neighbouring coast in the same sample
    # must also use its real edges, or a narrow channel can fill with land.
    cells = set()
    tiny = {i for i,(g,_) in enumerate(parts) if not sampled(g)}
    for idx in sorted(tiny):
        geom = parts[idx][0]
        x0,y0,x1,y1 = indices(geom)
        for y in range(y0,y1):
            for x in range(x0,x1):
                p = ORIGIN+np.array([x,y])/SAMPLES
                if geom.intersects(box(*p,*(p+1/SAMPLES))):
                    # Resolve both channels alongside an islet even if the centre of
                    # the next raster sample happened to land on a neighbouring rock.
                    cells.update((x+dx,y+dy) for dx in range(-2,3) for dy in range(-2,3))
    keys = sorted({(x//16,y//16) for x,y in cells},key=lambda p:(p[1],p[0]))
    tree = STRtree([g for g,_ in parts])
    cache, table, lists = {}, [], {}
    def ring(code, polygon, key):
        name = (code,key,polygon.wkb)
        if name not in cache:
            base = ORIGIN+np.asarray(key)/2048
            points = np.rint((np.asarray(polygon.exterior.coords)[:-1]-base)*QUANTIZE).astype(int)
            if polygon.interiors or len(points)>255:
                raise ValueError('Unexpected complex island ring')
            start=len(table)
            table.append([code,len(points),0])
            for v in points.flat:
                value = int(v)+8388608
                if not 0<=value<16777216:
                    raise ValueError('Island ring exceeds its local coordinate range')
                table.append([value%256,(value>>8)%256,value>>16])
            cache[name]=start
        return cache[name]

    coarse, middle, fine = (np.asarray(Image.open(path/(f+'.png')).convert('RGB')).copy()
                            for f in ('prefectures','districts','edges'))
    blocks = []
    for block,key in enumerate(keys):
        mx,my = key
        p = coarse[my//32,mx//32]
        if p[0]<250:
            raise ValueError('An islet is outside the subdivided coastal cells')
        parent = pointer(p)
        m = middle[parent//128*32+my%32,parent%128*32+mx%32]
        data = np.zeros((16,16,3),dtype='uint8')
        for j in range(16):
            for i in range(16):
                x,y = mx*16+i,my*16+j
                if (x,y) not in cells:
                    data[j,i,1]=base_owner(m,fine,i,j)
                    continue
                corner=ORIGIN+np.array([x,y])/SAMPLES
                cell=box(*corner,*(corner+1/SAMPLES))
                ids=[]
                for idx in sorted(tree.query(cell,predicate='intersects')):
                    geom,code=parts[idx]
                    if geom.covers(cell):
                        data[j,i,1]=code
                        break
                    # Reuse short rings across all adjoining cells. Clip larger pieces
                    # in the local coordinate system to keep the shader's work bounded.
                    bounds=np.array(geom.bounds).reshape(2,2)
                    fits=(len(geom.exterior.coords)<=80 and not geom.interiors and
                          np.max(np.abs((bounds-(ORIGIN+np.array(key)/2048))*QUANTIZE))<8388607)
                    pieces=[geom] if fits else get_parts(geom.intersection(cell))
                    for piece in pieces:
                        if piece.area:
                            ids.append(ring(code,piece,key))
                if ids:
                    ids=tuple(ids)
                    if ids not in lists:
                        if len(ids)>255 or len(table)+len(ids)>65535:
                            raise ValueError('Coastal sample exceeds atlas capacity')
                        lists[ids]=len(table)
                        table.extend([idx%256,idx//256,0] for idx in ids)
                    offset=lists[ids]
                    data[j,i]=[len(ids),offset%256,offset//256]
        m[:]=[249,block%256,block//256]
        blocks.append(data)
    rows=ceil(len(table)/256)+ceil(len(blocks)/16)*16
    image=np.zeros((rows,256,3),dtype='uint8')
    image.reshape(-1,3)[:len(table)]=table
    for n,b in enumerate(blocks):
        y=rows-(n//16+1)*16
        image[y:y+16,n%16*16:n%16*16+16]=b
    Image.fromarray(middle).save(path/'districts.png',optimize=True)
    Image.fromarray(image).save(path/'islets.png',optimize=True)
    print(len(tiny),'small or narrow islets and',len(cells),'coastal samples in',len(blocks),'blocks')
