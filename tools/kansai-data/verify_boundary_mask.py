"""Check every packed administrative-area sample against the official N03 ZIPs.

python verify_boundary_mask.py /path/to/downloaded/N03-archives
Requires NumPy, Pillow, affine, rasterio and Shapely 2.
"""
import argparse
import json
from pathlib import Path
import zipfile

from affine import Affine
import numpy as np
from PIL import Image
from rasterio.features import rasterize
import shapely

ROOT = Path(__file__).resolve().parents[2] / 'public/kansai'
WEST, SOUTH, SCALE, SIZE = 134, 33.75, 64, 512


def official(archives, code):
    with zipfile.ZipFile(archives/f'N03-20260101_{code}_GML.zip') as archive:
        name, = [p for p in archive.namelist() if p.lower().endswith('.geojson')]
        features = json.loads(archive.read(name))['features']
    return shapely.union_all([shapely.make_valid(shapely.geometry.shape(f['geometry'])) for f in features])


def read(name):
    with Image.open(ROOT/'borders'/f'{name}.png') as image:
        return np.asarray(image.convert('RGB'))


def pointer(pixel):
    r,g,b=pixel.astype(np.int32).T
    return (r-250)*65536+g+256*b


def unpack(pixel, middle, fine):
    ref=pointer(pixel.reshape(1,3))[0]
    sub=middle[ref//128*32:ref//128*32+32,ref%128*32:ref%128*32+32]
    cells=np.repeat(np.repeat(sub[:,:,0],16,axis=0),16,axis=1)
    y,x=np.indices((16,16))
    for j,i in np.argwhere(sub[:,:,0]>=250):
        ref=pointer(sub[j,i].reshape(1,3))[0]
        rgb=fine[ref//256*4+y//4,ref%256*8+x//2].astype(np.int32)
        bits=rgb[:,:,0]+(rgb[:,:,1]<<8)+(rgb[:,:,2]<<16)
        codes=(bits>>(3*((y%4)*2+x%2)))&7
        cells[j*16:j*16+16,i*16:i*16+16]=np.where(codes,codes+24,0)
    return cells


def verify(archives):
    areas={n:official(archives,n) for n in range(25,30)}
    with (ROOT/'prefectures.json').open(encoding='utf-8') as stream:
        for f in json.load(stream)['features']:
            code=int(f['properties']['code'])
            if not shapely.equals(areas[code],shapely.geometry.shape(f['geometry'])):
                raise ValueError(f'Vector boundary differs from N03: {code}')
    coarse,middle,fine=(read(name) for name in ('prefectures','districts','edges'))
    height,width=coarse.shape[:2]
    row,col=np.indices((height,width))
    boxes=shapely.box(WEST+col/SCALE,SOUTH+row/SCALE,WEST+(col+1)/SCALE,SOUTH+(row+1)/SCALE)
    border=shapely.union_all([a.boundary for a in areas.values()])
    shapely.prepare(border)
    detail=(coarse[:,:,0]>=250)|shapely.intersects(border,boxes)
    transform=Affine.translation(WEST,SOUTH)*Affine.scale(1/SCALE)
    truth=rasterize([(geom,n) for n,geom in areas.items()],(height,width),transform=transform,dtype='uint8')
    errors=np.count_nonzero((truth!=coarse[:,:,0]) & ~detail)*SIZE**2
    parts=[(p,n) for n,a in areas.items() for p in shapely.get_parts(a) if p.area>0]
    index=shapely.STRtree([p for p,_ in parts])
    # For a coarse cell containing no boundary all 262144 centres have the
    # same class. Expand all other cells independently of the packed atlas.
    for j,i in np.argwhere(detail):
        cell=boxes[j,i]
        w,s,e,n=cell.bounds
        shapes=[(shapely.clip_by_rect(parts[k][0],w-.0001,s-.0001,e+.0001,n+.0001),parts[k][1])
                for k in sorted(index.query(cell,predicate='intersects'))]
        xf=Affine.translation(w,s)*Affine.scale(1/(SCALE*SIZE))
        expected=rasterize(shapes,(SIZE,SIZE),transform=xf,dtype='uint8') if shapes else np.zeros((SIZE,SIZE),np.uint8)
        pixel=coarse[j,i]
        actual=unpack(pixel,middle,fine) if pixel[0]>=250 else pixel[0]
        errors+=np.count_nonzero(expected!=actual)
    total=width*height*SIZE**2
    print(f'{total:,} sample centres, {detail.sum():,} subdivided cells, {errors:,} mismatches')
    if errors:raise SystemExit(1)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('archives',type=Path)
    verify(parser.parse_args().archives)
