"""Join the GSI shorelines across tile edges. W09 identifies Lake Biwa among connected rivers."""
import gzip
import json
import struct
from pathlib import Path
from urllib.request import urlretrieve

import mapbox_vector_tile
from mapbox_vector_tile.Mapbox import vector_tile_pb2
import numpy as np
import pyogrio.raw
import shapely as geom
from shapely.affinity import translate
from shapely.geometry import Point, Polygon, box, shape

import region as R
from common import OUT, CACHE

DATA = Path(OUT)
EXTENT = 4096
SPAN = EXTENT * 32768


def projected(lon, lat):
    return (lon + 180) / 360 * SPAN, (1 - np.arcsinh(np.tan(np.deg2rad(lat))) / np.pi) / 2 * SPAN


def home_coords(points):
    lon = points[:, 0] / SPAN * 360 - 180
    lat = np.rad2deg(np.arctan(np.sinh(np.pi * (1 - 2 * points[:, 1] / SPAN))))
    return np.column_stack(((lon - R.ORIGIN[1]) * R.M_PER_DEG_LON, (R.ORIGIN[0] - lat) * R.M_PER_DEG_LAT))


def parts(g):
    if g.geom_type == 'Polygon':
        if not g.is_empty:
            yield g
    elif hasattr(g, 'geoms'):
        for child in g.geoms:
            yield from parts(child)


def outline():
    archive = Path(CACHE) / 'lakes.zip'
    if not archive.exists():
        archive.parent.mkdir(parents=True, exist_ok=True)
        urlretrieve('https://nlftp.mlit.go.jp/ksj/gml/data/W09/W09-05/W09-05_GML.zip', archive)
    _, _, wkbs, _ = pyogrio.raw.read('/vsizip/' + archive.resolve().as_posix() + '/W09-05-g_Lake.shp',
                                      where="W09_001 = '琵琶湖'", encoding='cp932')
    lake = geom.from_wkb(wkbs[0])
    return geom.transform(lake, lambda pts: np.column_stack(projected(*pts.T)))


def water_areas():
    lake = outline()
    # Both Karahashi spans and the continuous channel from the lake to the Nango weir.
    left, top = projected(135.895, 34.990)
    right, bottom = projected(135.922, 34.943)
    corridor = box(left, top, right, bottom)
    guide = lake.buffer(180).union(corridor)
    tiles = []
    for path in sorted((DATA.parent / 'kansai/surfaces/25').glob('*.bin')):
        px, py = map(int, path.stem.split('-'))
        if not guide.intersects(box(px*8*EXTENT, py*8*EXTENT, (px+1)*8*EXTENT, (py+1)*8*EXTENT)):
            continue
        data = path.read_bytes()
        offsets = struct.unpack_from('<65I', data)
        for i in range(64):
            x, y = (px*8+i%8)*EXTENT, (py*8+i//8)*EXTENT
            if offsets[i] == offsets[i+1] or not guide.intersects(box(x,y,x+EXTENT,y+EXTENT)):
                continue
            tile = vector_tile_pb2.tile.FromString(gzip.decompress(data[offsets[i]:offsets[i+1]]))
            layer = next((v for v in tile.layers if v.name == 'WA'), None)
            if layer is None:
                continue
            only_water = vector_tile_pb2.tile()
            only_water.layers.append(layer)
            wa = mapbox_vector_tile.decode(only_water.SerializeToString(), default_options={'y_coord_down': True})['WA']
            assert wa['extent'] == EXTENT
            polys = [shape(f['geometry']) for f in wa['features'] if f['properties'].get('vt_code') == 5200]
            clipped = geom.intersection(geom.union_all(geom.make_valid(polys)), box(0,0,EXTENT,EXTENT), grid_size=1)
            if not clipped.is_empty:
                tiles.append(translate(clipped, x, y))
    union = geom.union_all(tiles, grid_size=1).intersection(guide)
    connected = next(p for p in parts(union) if p.covers(Point(*projected(135.895,35.025))))
    lake_part = lake.buffer(180).difference(corridor.difference(lake))
    channel = union.intersection(corridor).difference(lake_part)
    # Bridge and weir decks can divide the surveyed channel into disjoint polygons.
    channels = [p for p in parts(channel) if p.area > 8000 / .245**2]
    return [geom.transform(g, home_coords).simplify(1.7) for g in
            (connected.intersection(lake_part), geom.union_all(channels))]


def rings(p):
    def coords(ring):
        return np.round(np.asarray(ring.coords)[:-1], 1).ravel().tolist()
    return {'outer': coords(p.exterior), 'holes': [coords(r) for r in p.interiors]}


def save(name, data):
    (DATA / 'kansai' / name).write_bytes(gzip.compress(json.dumps(data,separators=(',',':')).encode(),mtime=0))


def trim_old_region(water):
    meta = next(r['lines'] for r in json.loads((DATA/'regions.json').read_bytes())['regions'] if r['id']=='yamashina')
    data = gzip.decompress((DATA/meta['file']).read_bytes())
    count, = struct.unpack_from('<I',data)
    kinds = np.frombuffer(data, 'B', count, 4)
    sizes = np.frombuffer(data, '<u2', count, 4+2*count)
    start = np.r_[0, np.cumsum(sizes)]
    packed = np.frombuffer(data,'B',offset=4+4*count).reshape(4,-1).astype(np.uint16)
    xy = np.column_stack([(packed[i] | packed[i+1]<<8).view(np.int16).astype(np.int64).cumsum()*meta['q']+meta['box'][j]
                          for j,i in enumerate((0,2))])
    remove, replacements = [], []
    for i in np.where(kinds==2)[0].tolist():
        end = i+1
        while end<count and kinds[end]==3:
            end+=1
        coords = [xy[start[j]:start[j+1]] for j in range(i,end)]
        p = Polygon(coords[0],coords[1:]).buffer(0)
        if not water.intersects(p):
            continue
        remove.extend(range(i,end))
        replacements.extend(rings(piece) for piece in parts(p.difference(water)) if piece.area>3)
    checksum=2166136261
    for value in data:
        checksum=((checksum^value)*16777619)&0xffffffff
    save('yamashina-lake-remainder.json.gz',{'baseChecksum':checksum,'replace':remove,'polygons':replacements,'attr':0})


if __name__ == '__main__':
    lake, river = water_areas()
    print('areas in square metres:', lake.area, river.area, flush=True)
    assert 640e6 < lake.area < 700e6 and river.area > .5e6
    assert lake.covers(Point(*R.to_local(35.0262,135.8967)))
    assert river.covers(Point(*R.to_local(34.9731,135.9065)))
    payload = []
    for area in (lake, river):
        triangles = geom.constrained_delaunay_triangles(area)
        points = np.asarray([np.asarray(t.exterior.coords)[:3] for t in parts(triangles)], dtype='<f4')
        # +Z is south in the homepage projection; top faces wind clockwise in XZ.
        a, b = points[:,1] - points[:,0], points[:,2] - points[:,0]
        invert = a[:,0]*b[:,1] > a[:,1]*b[:,0]
        points[invert] = points[invert,::-1,:]
        payload.append(points.tobytes())
    header = struct.pack('<II', *(len(p)//8 for p in payload))
    (DATA / 'kansai/biwa-water.bin').write_bytes(gzip.compress(header+b''.join(payload), mtime=0))
    trim_old_region(lake.union(river))
