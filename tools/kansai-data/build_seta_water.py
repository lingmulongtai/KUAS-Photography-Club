"""Reconstruct the occluded river surface under the modelled Karahashi decks.

Input: the GSI seamlessphoto z18 EPSG:3857 orthophoto cropped around both crossings.
Only the photographed deck inside the published GSI water polygon receives opacity.
"""
import argparse
import gzip
from pathlib import Path
import struct

import mapbox_vector_tile
import numpy as np
from PIL import Image
import rasterio
import shapely
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[2] / 'public/kansai'
BOUNDS = (135.90484, 34.97261, 135.90769, 34.97351)
BRIDGES = [((135.9049509,34.9733849),(135.9054889,34.9732521)),
           ((135.9057801,34.9731784),(135.9075769,34.9727382))]


def build(photo):
    west,south,east,north = BOUNDS
    width,height = 540,208
    lat,lon = np.meshgrid(north-(np.arange(height)+.5)*(north-south)/height,
                          west+(np.arange(width)+.5)*(east-west)/width, indexing='ij')
    merc_x = np.deg2rad(lon)*6378137
    merc_y = np.arcsinh(np.tan(np.deg2rad(lat)))*6378137
    world = np.pi*6378137
    u,v = (merc_x/world+1)*16384,(1-merc_y/world)*16384
    tile_x,tile_y = int(u.min()),int(v.min())
    assert int(u.max())==tile_x and int(v.max())==tile_y
    pack = (ROOT/f'surfaces/25/{tile_x//8}-{tile_y//8}.bin').read_bytes()
    start,end = struct.unpack_from('<2I',pack,4*(tile_y%8*8+tile_x%8))
    water = mapbox_vector_tile.decode(gzip.decompress(pack[start:end]),default_options={'y_coord_down':True})['WA']
    outline = shapely.union_all([shape(f['geometry']) for f in water['features']])
    mapped = shapely.contains_xy(outline,(u-tile_x)*water['extent'],(v-tile_y)*water['extent'])
    output = np.zeros((height,width,4),np.uint8)
    with rasterio.open(photo) as src:
        assert src.crs.to_epsg()==3857
        rgb=src.read([1,2,3]).transpose(1,2,0)
        def sample(x,y):
            col,row = ~src.transform*(x,y)
            return rgb[np.clip(row.astype(int),0,src.height-1),np.clip(col.astype(int),0,src.width-1)]
        for (x1,y1),(x2,y2) in BRIDGES:
            dx,dy=(x2-x1)*91299,(y2-y1)*110946
            length=np.hypot(dx,dy)
            nx,ny=-dy/length,dx/length
            x,y=(lon-x1)*91299,(lat-y1)*110946
            across=x*nx+y*ny
            along=(x*dx+y*dy)/length
            # Take water from both sides of each station. A median rejects a mooring or a white boat.
            reference=[]
            for side in [-1,1]:
                offsets=[(side*d-across)/np.cos(np.deg2rad(lat)) for d in [19,21,24,26,29]]
                reference.append(np.median([sample(merc_x+off*nx,merc_y+off*ny) for off in offsets],axis=0))
            w=np.clip((across+15)/30,0,1)[:,:,None]
            colour=reference[0]*(1-w)+reference[1]*w
            active=mapped&(along>=0)&(along<=length)&(np.abs(across)<15)
            output[active,:3]=np.rint(colour[active]).astype(np.uint8)
            output[active,3]=np.rint(255*np.clip((15-np.abs(across[active]))/3,0,1)).astype(np.uint8)
    assert 8000 < np.count_nonzero(output[:,:,3]) < 50000
    target=ROOT/'landmarks/seta-water.png'
    Image.fromarray(output).save(target,optimize=True)
    print(target.name,target.stat().st_size,'bytes;',np.count_nonzero(output[:,:,3]),'river pixels')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('photo',type=Path)
    build(parser.parse_args().photo)
