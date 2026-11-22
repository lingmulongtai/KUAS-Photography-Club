"""Reconstruct Kobe roof heights and setbacks using the Hyogo airborne DSM/DEM on mapped footprints.

Run with a scratch directory and the MLIT N03-20260101_28_GML.zip. Cached height pairs
are in half metres. Sky/street geometries share the same centroid and footprint grid.
"""
import argparse
import gzip
import io
import json
import math
import subprocess
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np
import requests
import shapely
from affine import Affine
from PIL import Image, ImageFilter
from rasterio.features import shapes
from shapely.geometry import Polygon, shape

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public/kansai"
OUT = DATA / "kobe-roofs"
SESSION = threading.local()
Q = 16384


def field(cache, zoom, x, y):
    path = cache / f"{zoom}-{x}-{y}.npy"
    if path.exists():
        return
    if not hasattr(SESSION, "http"):
        SESSION.http = requests.Session()
    def read(layer):
        url = f"https://tiles.gsj.jp/tiles/elev/{layer}/{zoom}/{y}/{x}.png"
        for attempt in range(4):
            try:
                res = SESSION.http.get(url, timeout=20)
                if res.status_code == 404:
                    return np.full((256, 256), np.nan, np.float32)
                res.raise_for_status()
                p = np.asarray(Image.open(io.BytesIO(res.content)).convert("RGBA"), np.int32)
                a = p[:,:,0]*65536+p[:,:,1]*256+p[:,:,2]
                return np.where(p[:,:,3]>0, np.where(a>=8388608,a-16777216,a)*.01,np.nan)
            except (OSError, requests.RequestException):
                if attempt == 3: raise
                time.sleep(1+attempt)
    heights = read("hyogodsm")-read("hyogodem")
    encoded = np.where(np.isfinite(heights),np.clip(np.rint(heights*2),0,1000),65535).astype(np.uint16)
    np.save(path.with_suffix(".part.npy"),encoded)
    path.with_suffix(".part.npy").replace(path)


def geographic(tx, ty):
    return tx/4096*360-180, math.degrees(math.atan(math.sinh(math.pi*(1-2*ty/4096))))


def tile_range(boundary):
    w,s,e,n = boundary.bounds
    def xy(lo,la):
        return math.floor((lo+180)/360*4096), math.floor((1-math.asinh(math.tan(math.radians(la)))/math.pi)*2048)
    x0,y0=xy(w,n); x1,y1=xy(e,s)
    return [(x,y) for x in range(x0,x1+1) for y in range(y0,y1+1)]


def outlines(cache,x,y,boundary):
    target=cache/f"outlines-{x}-{y}.json.gz"
    if not target.exists():
        subprocess.run(["node",str(Path(__file__).with_name("kobe_footprints.mjs")),str(DATA),str(x),str(y),str(target)],check=True)
    for rings in json.loads(gzip.decompress(target.read_bytes())):
        shell=np.asarray(rings[0]).reshape(-1,2)
        w,n=shell.min(axis=0);e,s=shell.max(axis=0)
        if (e-w)*(s-n)<190: continue
        cx,cy=(w+e)/2,(n+s)/2
        lon,lat=geographic(x+cx/Q,y+cy/Q)
        if not shapely.contains_xy(boundary,lon,lat):continue
        # Dense central wards have one-metre returns; use a two-metre survey in the rest of the city.
        zoom=17 if 135.16<lon<135.23 and 34.666<lat<34.714 else 16
        scale=2**(zoom-12)*256/Q
        yield rings,(int(w),int(n),int(e),int(s)),zoom,scale


@lru_cache(maxsize=72)
def pixels(cache,z,x,y):
    return np.load(cache/f"{z}-{x}-{y}.npy",mmap_mode="r")


def sample(cache,x,y,bounds,zoom,scale):
    w,n,e,s=bounds
    sx,sy=x*Q,y*Q
    u,v=math.floor((sx+w)*scale),math.floor((sy+n)*scale)
    r,t=math.ceil((sx+e)*scale),math.ceil((sy+s)*scale)
    result=np.empty((t-v,r-u),np.uint16)
    for tx in range(u//256,(r-1)//256+1):
        for ty in range(v//256,(t-1)//256+1):
            ax,az=max(u,tx*256),max(v,ty*256);bx,bz=min(r,tx*256+256),min(t,ty*256+256)
            result[az-v:bz-v,ax-u:bx-u]=pixels(cache,zoom,tx,ty)[az-ty*256:bz-ty*256,ax-tx*256:bx-tx*256]
    return result, u/scale-sx,v/scale-sy


def pitched_profile(shell, valid, values, left, top, scale):
    """Fit the same ridge and hip planes used by the renderer to returns inside this footprint."""
    yy, xx = np.nonzero(valid)
    if len(xx) < 20:
        return
    step = max(1, len(xx) // 400)
    pos = np.column_stack((left + (xx[::step] + .5) / scale, top + (yy[::step] + .5) / scale))
    heights = values[yy[::step], xx[::step]].astype(float)
    edges = np.roll(shell, -1, axis=0) - shell
    axis = edges[np.argmax(np.sum(edges*edges, axis=1))]
    length = np.linalg.norm(axis)
    if length < 1:
        return
    axis = axis / length
    best_score = .72
    result = None
    for direction in (axis, np.array([-axis[1], axis[0]])):
        normal = np.array([-direction[1], direction[0]])
        along, across = shell @ direction, shell @ normal
        length, width = np.ptp(along), np.ptp(across)
        if min(width, length) < 4 / scale:
            continue
        u = pos @ direction - along.min()
        v = pos @ normal - across.min()
        # Avoid mixed ground/wall returns along the four outer edges.
        keep = (u > .55/scale) & (u < length-.55/scale) & (v > .55/scale) & (v < width-.55/scale)
        if keep.sum() < 16:
            continue
        u, v, h = u[keep], v[keep], heights[keep]
        h = np.clip(h, *np.percentile(h, [6, 94]))
        variance = np.var(h)
        if variance < 1:
            continue
        gable = 1 - np.abs(2*v/width - 1)
        hip = np.minimum(gable, 2*np.minimum(u, length-u)/min(length, width))
        for kind, fraction in enumerate((gable, hip)):
            if np.ptp(fraction) < .58:
                continue
            mean = fraction.mean()
            f = fraction - mean
            rise = (f @ (h-h.mean())) / (f @ f)
            eaves = h.mean() - mean*rise
            # Heights are half metres, footprint units are about half a metre in Kobe.
            if rise < 2.5 or rise > min(32, width*.78) or eaves < 5:
                continue
            error = np.mean((h - (eaves + rise*fraction))**2)
            score = 1-error/variance - (.018 if kind == 1 else 0)
            if score > best_score:
                best_score = score
                # Rendering coordinates are east/north, survey rasters are east/south.
                angle = math.atan2(-direction[1], direction[0]) % math.pi
                result = [kind, round(angle/math.pi*256) % 256, round(eaves), round(rise)]
    return result


def profile(rings,box,zoom,scale,cache,x,y):
    shell=np.asarray(rings[0]).reshape(-1,2)
    poly=Polygon(shell,[np.asarray(r).reshape(-1,2) for r in rings[1:] if len(r)>=6])
    if poly.area<125 or not poly.is_valid:return
    values,left,top=sample(cache,x,y,box,zoom,scale)
    yy,xx=np.ogrid[:values.shape[0],:values.shape[1]]
    inside=shapely.contains_xy(poly,left+(xx+.5)/scale,top+(yy+.5)/scale)
    valid=inside & (values!=65535) & (values>=5) & (values<=660)
    measured=values[valid]
    if len(measured)<8 or len(measured)<inside.sum()*.64:return
    lo,med,upper=np.percentile(measured,[20,50,93])
    centre=[round((box[0]+box[2])*.5),round((box[1]+box[3])*.5)]
    row=[*centre,box[2]-box[0],box[3]-box[1],round(med),round(upper),[]]
    def finish():
        if not row[6] and upper-lo >= 3 and med <= 52:
            roof = pitched_profile(shell, valid, values, left, top, scale)
            if roof:
                row.append(roof)
        return row
    if upper-lo<5 or poly.area<580:
        return finish()
    # Segment genuine roof plateaus, allowing a sloped house roof to use the pitched-roof mesh.
    hist=np.bincount(measured.astype(int)//4,minlength=170)
    smooth=np.convolve(hist,[.18,.64,.18],"same")
    peaks=sorted((i for i in range(1,len(smooth)-1) if smooth[i]>=smooth[i-1] and smooth[i]>smooth[i+1] and smooth[i]>len(measured)*.04),
                 key=lambda i:-smooth[i])
    levels=[]
    for i in peaks:
        if all(abs(i-j)>=2 for j in levels): levels.append(i)
        if len(levels)==4:break
    levels.sort()
    if len(levels)<2:return finish()
    levels=[float(np.median(measured[(measured>=i*4-1)&(measured<=i*4+4)])) for i in levels]
    previous=levels[0]
    if previous<5 or previous<med*.32:return finish()
    tiers=[]
    for level in levels[1:]:
        cut=(level+previous)*.5
        mask=((values>=cut) & valid).astype(np.uint8)
        if min(mask.shape)>3:
            mask=np.asarray(Image.fromarray(mask*255).filter(ImageFilter.MedianFilter(3)))>0
        if mask.sum()<max(12,valid.sum()*.025) or mask.sum()>valid.sum()*.86:continue
        transform=Affine.translation(left,top)*Affine.scale(1/scale)
        footprints=[]
        for geo,_ in shapes(mask.astype('uint8'),mask=mask.astype(bool),transform=transform):
            if len(geo['coordinates'][0])<4:continue
            clipped=shape(geo).simplify(1.35/scale,preserve_topology=True).intersection(poly)
            for piece in shapely.get_parts(clipped):
                if piece.geom_type!='Polygon' or piece.area<max(48,poly.area*.016):continue
                def encode(ring):
                    return [round(v) for px,py in list(ring.coords)[:-1] for v in (px-centre[0],py-centre[1])]
                footprints.append([encode(piece.exterior),*[encode(hole) for hole in piece.interiors if Polygon(hole).area>48]])
        if footprints:tiers.append([round(level),footprints]);previous=level
    if tiers:row[4],row[6]=round(levels[0]),tiers
    return finish()


def run():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scratch",type=Path);parser.add_argument("boundaries",type=Path)
    parser.add_argument("--rebuild", action="store_true", help="replace generated profiles using the cached height survey")
    args=parser.parse_args();cache=args.scratch;cache.mkdir(exist_ok=True,parents=True);OUT.mkdir(exist_ok=True)
    with zipfile.ZipFile(args.boundaries) as z:
        src=json.loads(z.read(next(f for f in z.namelist() if f.endswith('.geojson'))))['features']
    boundary=shapely.union_all([shape(f['geometry']) for f in src if f['properties'].get('N03_004')=='神戸市'])
    shapely.prepare(boundary)
    index={}
    for x,y in sorted(tile_range(boundary),key=lambda xy:(xy[0]-3586)**2+(xy[1]-1626)**2):
        key=f"{x}-{y}"; dest=OUT/(key+'.json.gz')
        if dest.exists() and not args.rebuild:
            index[key]=len(json.loads(gzip.decompress(dest.read_bytes())));continue
        records=list(outlines(cache,x,y,boundary))
        needed=set()
        for _,(w,n,e,s),z,scale in records:
            for tx in range(math.floor((x*Q+w)*scale/256),math.ceil((x*Q+e)*scale/256)):
                for ty in range(math.floor((y*Q+n)*scale/256),math.ceil((y*Q+s)*scale/256)):
                    needed.add((z,tx,ty))
        if not needed:continue
        print(key,len(records),'footprints,',len(needed),'height tiles',flush=True)
        with ThreadPoolExecutor(max_workers=10) as pool:
            list(pool.map(lambda t:field(cache,*t),sorted(needed)))
        rows=[row for args2 in records if (row:=profile(*args2,cache,x,y))]
        if not rows:continue
        data=json.dumps(rows,separators=(',',':')).encode()
        tmp=dest.with_suffix('.part');tmp.write_bytes(gzip.compress(data,compresslevel=9,mtime=0));tmp.replace(dest)
        index[key]=len(rows)
        print(key,len(rows),'profiles,',sum(bool(r[6]) for r in rows),'stepped',flush=True)
    manifest=OUT/'index.json'
    stage=manifest.with_suffix('.part')
    stage.write_text(json.dumps(index,sort_keys=True,separators=(',',':'))+'\n')
    stage.replace(manifest)

if __name__=='__main__':
    run()
