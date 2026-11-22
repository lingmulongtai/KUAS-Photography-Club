"""Derive exterior floor outlines at Kobe's Naka Pier from the mapped footprint and airborne surface."""
from io import BytesIO
import gzip
import json
import math
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from PIL import Image, ImageFilter
from affine import Affine
from rasterio.features import shapes
from shapely import contains_xy
from shapely.geometry import Polygon, shape

ROOT = Path(__file__).resolve().parents[2]
LON, LAT = 135.1887109, 34.67987
X_SCALE, Y_SCALE = 91644, 110940
# Published dimensions and fourteen above-ground floors: https://www.kobe-orientalhotel.co.jp/about/
HEIGHT = 59.64


def xy(lon, lat, zoom):
    return ((lon+180)/360*2**zoom, (1-np.arcsinh(np.tan(np.radians(lat)))/np.pi)*2**(zoom-1))


def main():
    key = '-'.join(str(int(i)) for i in xy(LON, LAT, 12))
    attrs = ROOT / 'public/kansai/building-attributes' / (key + '.json.gz')
    row = next(r for r in json.loads(gzip.decompress(attrs.read_bytes())) if r['id'] == 'w47124163')
    ring = row['polygons'][0][0]
    poly = Polygon([((x-LON)*X_SCALE, (LAT-y)*Y_SCALE) for x,y in ring])
    w,s,e,n = poly.bounds
    xs, zs = np.meshgrid(np.arange(math.floor(w)-9, math.ceil(e)+10), np.arange(math.floor(s)-9, math.ceil(n)+10))
    tx, ty = xy(LON+xs/X_SCALE, LAT-zs/Y_SCALE, 17)
    dsm = np.full(xs.shape, np.nan)
    for x in range(int(tx.min()), int(tx.max())+1):
        for y in range(int(ty.min()), int(ty.max())+1):
            url = 'https://tiles.gsj.jp/tiles/elev/hyogodsm/17/{}/{}.png'.format(y,x)
            with urlopen(url,timeout=45) as res:
                rgba = np.asarray(Image.open(BytesIO(res.read())).convert('RGBA'), dtype=int)
            pixels = (tx.astype(int)==x) & (ty.astype(int)==y)
            p = rgba[((ty[pixels]%1)*256).astype(int), ((tx[pixels]%1)*256).astype(int)]
            rgb = p[:,0]*65536 + p[:,1]*256 + p[:,2]
            dsm[pixels] = np.where(p[:,3], np.where(rgb>=8388608,rgb-16777216,rgb)*.01, np.nan)
    mask = contains_xy(poly,xs,zs)
    base = np.nanpercentile(dsm[contains_xy(poly.buffer(8),xs,zs)&~mask],15)
    dsm -= base
    transform = Affine.translation(xs[0,0]-.5,zs[0,0]-.5)
    levels = []
    for t in np.linspace(0,HEIGHT,15)[:-1]:
        if t==0:
            contour = poly
        else:
            img = Image.fromarray(((dsm>t+.25)&mask).astype('uint8')*255).filter(ImageFilter.MedianFilter(5))
            array = np.array(img)
            candidates = [shape(feature) for feature,val in shapes(array, mask=array>0,transform=transform) if val]
            if not candidates:
                raise ValueError('No surveyed roof for floor at '+str(t))
            contour = max(candidates,key=lambda p:p.area).simplify(1.0, preserve_topology=True)
        levels.append([[round(x,2),round(z,2)] for x,z in list(contour.exterior.coords)[:-1]])
    out = {'sourceWay':row['id'],'lon':LON,'lat':LAT,'height':HEIGHT,'floorOutlines':levels}
    assert len(levels)==14 and Polygon(levels[0]).area > Polygon(levels[-1]).area
    Path(__file__).with_name('harbor-hotel.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
    print('Dock datum:',round(base,2),'m; floor areas:',[round(Polygon(r).area) for r in levels])


if __name__ == '__main__':
    main()
