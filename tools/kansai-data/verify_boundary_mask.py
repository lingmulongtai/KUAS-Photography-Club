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


class Islets:
    def __init__(self):
        self.atlas=read('islets')
        self.table=self.atlas.reshape(-1,3)
        data=self.table.astype(np.int32)
        self.values=data[:,0]+(data[:,1]<<8)+(data[:,2]<<16)-8388608

    def owner(self, block, x, y):
        # x,y are fractions of a district, measured south-to-north as in the shader.
        row=len(self.atlas)-(block//16+1)*16
        ids=self.atlas[row+int(y*16),block%16*16+int(x*16)]
        if not ids[0]:
            return int(ids[1])
        px,py=x*(4e9/2048),y*(4e9/2048)
        directory=int(ids[1])+256*int(ids[2])
        for ref in self.table[directory:directory+int(ids[0])]:
            header=int(ref[0])+256*int(ref[1])
            owner,count,_=map(int,self.table[header])
            ring=self.values[header+1:header+1+count*2].reshape(-1,2)
            ax,ay=ring[-1]
            inside=False
            for bx,by in ring:
                if (ay>py)!=(by>py) and px-ax<(bx-ax)*((py-ay)/(by-ay)):
                    inside=not inside
                ax,ay=bx,by
            if inside:return owner
        return 0

def unpack(pixel, middle, fine, islands):
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
    for j,i in np.argwhere(sub[:,:,0]==249):
        block=int(sub[j,i,1])+256*int(sub[j,i,2])
        for y in range(16):
            for x in range(16):
                cells[j*16+y,i*16+x]=islands.owner(block,(x+.5)/16,(y+.5)/16)
    return cells


def verify(archives):
    areas={n:official(archives,n) for n in range(25,30)}
    with (ROOT/'prefectures.json').open(encoding='utf-8') as stream:
        for f in json.load(stream)['features']:
            code=int(f['properties']['code'])
            if not shapely.equals(areas[code],shapely.geometry.shape(f['geometry'])):
                raise ValueError(f'Vector boundary differs from N03: {code}')
    coarse,middle,fine=(read(name) for name in ('prefectures','districts','edges'))
    islands=Islets()
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
        actual=unpack(pixel,middle,fine,islands) if pixel[0]>=250 else pixel[0]
        errors+=np.count_nonzero(expected!=actual)
    total=width*height*SIZE**2
    print(f'{total:,} sample centres, {detail.sum():,} subdivided cells, {errors:,} mismatches')
    # Check off-centre queries against the official unsimplified polygons independently
    # of the generator's candidate selection, including the water between close islets.
    rng=np.random.default_rng(20261122)
    precise=0
    def point(lon,lat):
        x,y=(lon-WEST)*2048,(lat-SOUTH)*2048
        ix,iy=int(x),int(y)
        coarse_id=coarse[iy//32,ix//32]
        if coarse_id[0]<250:return
        ref=pointer(coarse_id.reshape(1,3))[0]
        group=middle[ref//128*32+iy%32,ref%128*32+ix%32]
        if group[0]!=249:return
        n=int(group[1])+256*int(group[2])
        return islands.owner(n,x%1,y%1)
    for geom,code in parts:
        p=geom.representative_point()
        actual=point(p.x,p.y)
        if actual is not None:
            precise+=1
            errors+=actual!=code
    for cy,cx in np.argwhere(coarse[:,:,0]>=250):
        parent=pointer(coarse[cy,cx].reshape(1,3))[0]
        sub=middle[parent//128*32:parent//128*32+32,parent%128*32:parent%128*32+32]
        for sy,sx in np.argwhere(sub[:,:,0]==249):
            n=int(sub[sy,sx,1])+256*int(sub[sy,sx,2])
            row=len(islands.atlas)-(n//16+1)*16
            block=islands.atlas[row:row+16,n%16*16:n%16*16+16]
            for y,x in np.argwhere(block[:,:,0]>0):
                local=(rng.random((96,2))+[x,y])/16
                xy=(local+[cx*32+sx,cy*32+sy])/2048+[WEST,SOUTH]
                candidates=index.query(shapely.box(*xy.min(axis=0),*xy.max(axis=0)),predicate='intersects')
                expected=np.zeros(len(xy),dtype='uint8')
                for k in candidates:
                    geom,code=parts[k]
                    expected[shapely.contains_xy(geom,xy[:,0],xy[:,1])]=code
                errors+=np.count_nonzero(expected!=[islands.owner(n,*p) for p in local])
                precise+=len(xy)
    print(f'{precise:,} additional coastal queries, {errors:,} total mismatches')
    if errors:raise SystemExit(1)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('archives',type=Path)
    verify(parser.parse_args().archives)
