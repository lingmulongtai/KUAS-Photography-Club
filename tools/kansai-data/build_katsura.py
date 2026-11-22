"""Restore 2024 surveyed roofs only on buildings confirmed in Kyoto's 2025 CityGML.

Use the six leaf tiles. Four coarser tiles repeat five of these same buildings.
Input hashes identify the official archive entries; --cache can reuse prior downloads.
Requirements: DracoPy, NumPy, Pillow, pyproj, requests, Shapely 2 and KTX-Software toktx.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from io import BytesIO
from pathlib import Path
import struct
import subprocess
import xml.etree.ElementTree as ET
import zlib

import DracoPy
import numpy as np
import requests
import shapely
from PIL import Image
from pyproj import Transformer
from shapely.geometry import Polygon

from build_surveyed_sites import photo_atlas, unpack_tile

OUT = Path(__file__).resolve().parents[2]/'public/kansai/surveys/katsura'
SOURCE = Path(__file__).with_name('katsura-sources.json')
GEO = Transformer.from_crs(4978,4979,always_xy=True)
GRID = Transformer.from_crs(4326,6674,always_xy=True)
GML_ID = '{http://www.opengis.net/gml}id'
DTYPES = {5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}


def member(cache, archive, name, entry):
    offset,size,digest = entry
    path = cache/name
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
        r = requests.get(archive+'?tile='+str(offset),headers={'Range':f'bytes={offset}-{offset+size+220}'},timeout=60)
        r.raise_for_status()
        if r.status_code!=206 or r.content[:4]!=b'PK\x03\x04':
            raise ValueError('Partial ZIP member unavailable: '+name)
        fn,extra = struct.unpack_from('<HH',r.content,26)
        if not r.content[30:30+fn].decode().endswith('/'+name):
            raise ValueError('Unexpected ZIP member: '+name)
        start = 30+fn+extra
        data = zlib.decompress(r.content[start:start+size],-15)
        if hashlib.sha256(data).hexdigest()!=digest:
            raise ValueError('Archive entry changed: '+name)
        path.write_bytes(data)
    return path


def current_buildings(files):
    buildings, polygons = [], []
    for path in files:
        for _, el in ET.iterparse(path,events=['end']):
            if not el.tag.endswith('}Building'):
                continue
            height = el.findtext('{*}measuredHeight')
            footprint = el.find('{*}lod0RoofEdge')
            if footprint is None or not height:
                el.clear()
                continue
            parts, points = [], []
            for region in footprint.iterfind('.//{*}Polygon'):
                rings = []
                for ring in region.findall('{*}exterior/{*}LinearRing/{*}posList') + region.findall('{*}interior/{*}LinearRing/{*}posList'):
                    coords = np.fromstring(ring.text,sep=' ').reshape(-1,3)
                    lat,lon = coords[:,0],coords[:,1]
                    rings.append(np.column_stack(GRID.transform(lon,lat)))
                    points.extend(zip(lon,lat))
                if rings:
                    parts.append(shapely.make_valid(Polygon(rings[0],rings[1:])))
            if parts:
                poly = shapely.union_all(parts)
                extent = np.array(points)
                buildings.append((el.attrib[GML_ID],float(height),[*extent.min(axis=0),*extent.max(axis=0)]))
                polygons.append(poly)
            el.clear()
    return buildings,polygons,shapely.STRtree(polygons)


def filtered_tile(path, current):
    buildings,polygons,index = current
    batch,raw,src,view = unpack_tile(path.read_bytes())
    for key in ('_lod','bldg:measuredHeight'):
        value=batch[key]
        if isinstance(value,dict):
            formats={'BYTE':'i1','UNSIGNED_BYTE':'u1','SHORT':'<i2','UNSIGNED_SHORT':'<u2','FLOAT':'<f4','DOUBLE':'<f8'}
            batch[key]=np.frombuffer(raw,formats[value['componentType']],count=len(batch['gml_id']),offset=value['byteOffset']).tolist()
    lod = np.array(batch['_lod'])
    rtc = np.array(src['extensions']['CESIUM_RTC']['center'])
    projected = defaultdict(list)
    primitives = []
    for prim in src['meshes'][0]['primitives']:
        codec = prim['extensions']['KHR_draco_mesh_compression']
        mesh = DracoPy.decode(view(codec['bufferView']))
        attrs = {k:mesh.get_attribute_by_unique_id(v)['data'] for k,v in codec['attributes'].items()}
        owners = attrs['_BATCHID'].ravel().astype(int)
        face_ids = owners[mesh.faces[:,0]]
        xyz = attrs['POSITION'][:,[0,2,1]]*[1,-1,1]+rtc
        lon,lat,height = GEO.transform(*xyz.T)
        xy = np.column_stack(GRID.transform(lon,lat))
        for bid in np.unique(face_ids[lod[face_ids]==2]):
            triangles = shapely.polygons(xy[mesh.faces[face_ids==bid]])
            projected[bid].extend(triangles[shapely.area(triangles)>.004])
        primitives.append((prim,attrs,mesh.faces,face_ids,height))
    matches = {}
    for bid,parts in projected.items():
        outline = shapely.union_all(parts,grid_size=.025)
        proposals = []
        for i in index.query(outline,predicate='intersects'):
            other = polygons[i]
            shared = other.intersection(outline).area
            if shared <= 0 or shared/min(other.area,outline.area) < .82:
                continue
            score = shared/(other.area+outline.area-shared)
            survey_height = batch['bldg:measuredHeight'][bid]
            if score>=.8 and survey_height is not None and abs(buildings[i][1]-survey_height)<=max(2.,.18*survey_height):
                proposals.append((score,i))
        if len(proposals)==1:
            score,i = proposals[0]
            matches[bid] = (buildings[i],score)
    return src,view,batch,primitives,matches,len(projected)


def pack(gltf, binary):
    data = json.dumps(gltf,separators=(',',':')).encode()
    data += b' '*(-len(data)%4)
    binary += bytes(-len(binary)%4)
    return (struct.pack('<4sIIII',b'glTF',2,28+len(data)+len(binary),len(data),0x4e4f534a)
            +data+struct.pack('<II',len(binary),0x004e4942)+binary)


def b3dm(features, rows, glb):
    fields = json.dumps({'BATCH_LENGTH':features},separators=(',',':')).encode()
    fields += b' '*(-(28+len(fields))%8)
    table = json.dumps(rows,separators=(',',':')).encode()
    table += b' '*(-len(table)%8)
    size = 28+len(fields)+len(table)+len(glb)
    return struct.pack('<4s6I',b'b3dm',1,size,len(fields),0,len(table),0)+fields+table+glb


def neighbourhoods(ids, matches):
    if len(ids)<=18:
        if ids:
            yield sorted(ids)
        return
    bounds = np.array([matches[k][0][2] for k in ids])
    centers = (bounds[:,:2]+bounds[:,2:])/2
    axis = np.argmax(np.ptp(centers,axis=0)*[.82,1])
    ordered = np.array(ids)[np.argsort(centers[:,axis])]
    half = len(ids)//2
    yield from neighbourhoods(ordered[:half].tolist(),matches)
    yield from neighbourhoods(ordered[half:].tolist(),matches)


def write_tile(name, decoded, ids):
    src,read,batch,primitives,matches,_ = decoded
    remap = {old:new for new,old in enumerate(ids)}
    binary = bytearray()
    doc = {k:src[k] for k in ('asset','extensions','nodes','scenes','scene')}
    doc['asset'] = dict(version='2.0',copyright='Kyoto City / Project PLATEAU 2024. Processed and matched to Kyoto City 2025.')
    doc.update(extensionsUsed=['CESIUM_RTC'],bufferViews=[],accessors=[],materials=[],meshes=[{'primitives':[]}])
    def buffer(data):
        binary.extend(bytes(-len(binary)%4))
        i=len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)})
        binary.extend(data)
        return i
    def accessor(vals,kind,component,normalized=False,bounds=False):
        vals=np.ascontiguousarray(vals,dtype=DTYPES[component])
        item={'bufferView':buffer(vals.tobytes()),'componentType':component,'count':len(vals),'type':kind}
        if bounds:
            item.update(min=vals.min(axis=0).tolist(),max=vals.max(axis=0).tolist())
        if normalized:
            item['normalized']=True
        doc['accessors'].append(item)
        return len(doc['accessors'])-1
    z=[]
    materials={}
    atlas=None
    for prim,attrs,faces,owners,height in primitives:
        chosen = faces[np.isin(owners,ids)]
        if not len(chosen):
            continue
        verts,indices = np.unique(chosen,return_inverse=True)
        remapped_uv=None
        if 'TEXCOORD_0' in attrs:
            assert atlas is None and len(src['images'])==1
            # Copy the exact texels and their filtering gutters for this neighbourhood.
            # Avoid decoding the entire municipal 4096-square page to draw a few homes.
            original=Image.open(BytesIO(read(src['images'][0]['bufferView'])))
            remapped_uv,atlas=photo_atlas(original,attrs['TEXCOORD_0'][verts],indices.reshape(-1,3))
            page=Image.open(BytesIO(atlas))
            height4=(page.height+3)//4*4
            if height4!=page.height:
                padded=Image.new(page.mode,(page.width,height4))
                padded.paste(page,(0,0))
                padded.paste(page.crop((0,page.height-1,page.width,page.height)).resize((page.width,height4-page.height)),(0,page.height))
                remapped_uv[:,1]*=page.height/height4
                page=padded
            page.save(OUT/(Path(name).stem+'.png'),compress_level=6)
        dst={}
        for key,values in attrs.items():
            spec=src['accessors'][prim['attributes'][key]]
            if key=='_BATCHID':
                dst[key]=accessor(np.array([remap[v] for v in values.ravel()[verts]]),'SCALAR',5123)
            else:
                selected=remapped_uv if key=='TEXCOORD_0' else values[verts]
                dst[key]=accessor(selected,spec['type'],spec['componentType'],spec.get('normalized',False),key=='POSITION')
        m=prim['material']
        if m not in materials:
            materials[m]=len(doc['materials'])
            doc['materials'].append(src['materials'][m])
        doc['meshes'][0]['primitives'].append({'attributes':dst,'material':materials[m],
            'indices':accessor(indices.ravel(),'SCALAR',5123 if len(verts)<=65536 else 5125)})
        z.extend([height[verts].min(),height[verts].max()])
    if atlas:
        stem=Path(name).stem
        doc['textures']=[{'source':0,'sampler':src['textures'][0]['sampler'],'extensions':{'KHR_texture_basisu':{'source':1}}}]
        doc['samplers']=src['samplers']
        doc['images']=[{'uri':stem+'.png'},{'uri':stem+'.ktx2','mimeType':'image/ktx2'}]
        doc['extensionsUsed'].append('KHR_texture_basisu')
    doc['buffers']=[{'byteLength':len(binary)}]
    rows={'gml_id':[],'source_gml_id':[],'_lod':[],'_xmin':[],'_ymin':[],'_xmax':[],'_ymax':[]}
    audit=[]
    for k in ids:
        (current,height,box),iou=matches[k]
        rows['gml_id'].append(current)
        rows['source_gml_id'].append(batch['gml_id'][k])
        rows['_lod'].append(2)
        for key,value in zip(('_xmin','_ymin','_xmax','_ymax'),box):
            rows[key].append(round(value,9))
        audit.append([batch['gml_id'][k],current,round(iou,5),batch['bldg:measuredHeight'][k],height])
    (OUT/name).write_bytes(b3dm(len(ids),rows,pack(doc,binary)))
    box = [min(rows['_xmin']),min(rows['_ymin']),max(rows['_xmax']),max(rows['_ymax'])]
    # Give the previous survey's overhanging eaves room inside its culling volume.
    region = [math.radians(v+d) for v,d in zip(box,[-.00008,-.00008,.00008,.00008])]+[min(z)-1,max(z)+1]
    return {'boundingVolume':{'region':region},'geometricError':0,'content':{'uri':name}},audit,atlas is not None


def build(cache, toktx):
    cache.mkdir(exist_ok=True,parents=True)
    OUT.mkdir(exist_ok=True,parents=True)
    sources=json.loads(SOURCE.read_text(encoding='utf8'))
    files={y:[member(cache,s['archive'],n,entry) for n,entry in s['entries'].items()] for y,s in sources.items()}
    current=current_buildings(files['2025'])
    decoded={path.name:filtered_tile(path,current) for path in files['2024']}
    used=defaultdict(int)
    for _,_,_,_,matches,_ in decoded.values():
        for b,_ in matches.values():
            used[b[0]]+=1
    children,correspondence,textured=[],[],[]
    for name,data in decoded.items():
        matches=data[-2]
        ids=[k for k,(b,_) in matches.items() if used[b[0]]==1]
        for i,group in enumerate(neighbourhoods(ids,matches)):
            child,rows,has_photo=write_tile(Path(name).stem+'-'+str(i)+'.b3dm',data,group)
            if has_photo:
                textured.append(child)
            children.append(child)
            correspondence.extend(rows)
    def encode(child):
        stem=Path(child['content']['uri']).stem
        source=OUT/(stem+'.png')
        # Keep the lossless atlas on the native path for GPUs without Basis support.
        subprocess.run([str(toktx),'--t2','--genmipmap','--encode','uastc','--uastc_quality','1',
            '--zcmp','6','--threads','2',str(OUT/(stem+'.ktx2')),str(source)],check=True,capture_output=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(encode,textured))
    boxes=np.array([c['boundingVolume']['region'] for c in children])
    region=[*boxes.min(axis=0)[:2],*boxes.max(axis=0)[2:4],boxes[:,4].min(),boxes[:,5].max()]
    tiles={'asset':{'version':'1.0'},'geometricError':4000,'root':{'boundingVolume':{'region':region},
        'geometricError':4000,'refine':'REPLACE','children':children}}
    def save(name,doc):
        (OUT/name).write_text(json.dumps(doc,separators=(',',':'))+'\n',encoding='utf8')
    save('tileset.json',tiles)
    save('matches.json',{'source':'Kyoto City / Project PLATEAU, Kyoto 2024 and 2025',
        'fields':['gml2024','gml2025','footprintIoU','height2024','height2025'],'buildings':correspondence})
    print('Katsura:',sum(d[-1] for d in decoded.values()),'LOD2 candidates,',len(correspondence),'verified buildings in',len(children),'tiles')


if __name__=='__main__':
    args=argparse.ArgumentParser()
    args.add_argument('--cache',type=Path,required=True)
    args.add_argument('--toktx',type=Path,default=Path('toktx'))
    options=args.parse_args()
    build(options.cache,options.toktx)
