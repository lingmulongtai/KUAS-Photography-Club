"""Bounded, attributed GSI railway paths. Never bridge gaps with invented straight lines.

GSI vector attribute reference: https://maps.gsi.go.jp/help/pdf/vector/attribute.pdf
1 single, 2 double+, 3 siding, 4 station; railState 2/3 are hidden connections.
For the visible framed deck at Higashino, see the construction survey (photo 1, figure 1):
https://jcmanet.or.jp/bunken/wp-content/uploads/2004/jcma-2004_03.pdf
Run after fetch.py/build_regions.py. Only the named route codes within this box are read.
"""
import heapq
import json
import math
from pathlib import Path

import mapbox_vector_tile as mvt
from shapely import STRtree
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import transform

import region as R
from build_lines import parts, to_local_fn
from common import CACHE, write_gz
from fetch import get, GSI

AREA = (-26000, -12000, 7000, 12700)
KOSEI = (4800, -3000, 9300, 1600)  # Yamashina junction, Nagara tunnel and Otsukyo station
# Points on the two long, surveyed viaducts. Follow each contiguous GSI elevated
# run to its actual ends, including the portals and embankments either side.
VIADUCTS = {
    'jr-shinkansen': ((34.98112, 135.81502), 10.8),
    'jr-yamashina': ((34.994, 135.82852), 8.4),
}
# Endpoints: GSI/OSM station positions; route extents deliberately stop at named stations.
ROUTES = [
    ('randen-main', ['40202000123','40204800008'], (35.0032407,135.7484168), (35.0153367,135.6780678), '#704489', 1, 14.5),
    ('randen-kitano', ['40202000126'], (35.0152093,135.700416), (35.0274574,135.7306874), '#704489', 1, 14.5),
    ('hankyu-kyoto', ['40202000268'], (34.8904855,135.6807350), (35.0037592,135.76819), '#702c31', 4, 19),
    ('hankyu-arashiyama', ['40202000265'], (34.9790124,135.7031679), (35.0098491,135.6823003), '#702c31', 4, 19),
    ('kintetsu', ['40202000070'], (34.9848,135.7567), (34.9561575,135.7561415), '#bb6251', 4, 20),
    ('jr-sagano', ['40201000086'], (34.985135,135.7589257), (35.1023071,135.4833287), '#719783', 4, 20),
    ('jr-yamashina', ['40201000126','40201000069'], (34.985135,135.7589257), (35.02500,135.85800), '#8c9eae', 4, 20),
    ('jr-kyoto', ['40201000126'], (34.985135,135.7589257), (34.8918691,135.6778703), '#8c9eae', 6, 20),
    ('jr-shinkansen', ['40201888888'], (34.8907153,135.6811513), (34.979060,135.834962), '#245a9a', 8, 25),
]


def extract():
    routes = {code for _, codes, *_ in ROUTES for code in codes}
    features = []
    obstacles = []
    structure_tiles = set(R.tiles_for((3300, 550, 7100, 2900), 14))
    clip = box(0,0,4096,4096)
    for z,x,y in sorted(set(R.tiles_for(AREA,14)) | set(R.tiles_for(KOSEI,14))):
        path = Path(CACHE)/'gsi'/'bvmap'/str(z)/str(x)/f'{y}.pbf'
        # The regional builds normally cached these; fetch only this bounded set if absent.
        if not path.exists():
            get(f'{GSI}/experimental_bvmap/{z}/{x}/{y}.pbf',str(path))
        data = mvt.decode(path.read_bytes(), default_options={'y_coord_down':True})
        loc = to_local_fn(z,x,y)
        if (z,x,y) in structure_tiles:
            for layer in ('road','railway','waterarea'):
                for ft in data.get(layer,{}).get('features',[]):
                    p=ft['properties']
                    if layer=='road':
                        if p.get('ftCode') not in (2701,2711,2721,2731):continue
                        width=(3,4.5,9,16,24)[min(4,p.get('rnkWidth',0))]
                    elif layer=='railway':
                        if p.get('railState')!=0:continue
                        width=5.6 if p.get('snglDbl')==2 else 3.1
                    else:width=0
                    footprint=transform(loc,shape(ft['geometry']).intersection(clip))
                    if not footprint.is_empty:obstacles.append(footprint.buffer(width/2+1.25))
        for ft in data.get('railway',{}).get('features',[]):
            p=ft['properties']; codes=set(str(p.get('rtCode','')).split(','))
            if not codes.intersection(routes) or p.get('snglDbl')==3:continue
            for g in parts(shape(ft['geometry']).intersection(clip)):
                if g.geom_type!='LineString' or g.length<.1:continue
                pts=[tuple(round(v*2)/2 for v in loc(*q)) for q in g.coords]
                features.append((codes,pts,int(p.get('railState',0)),int(p.get('snglDbl',1)),p.get('staCode')))
    return features,STRtree(obstacles)


def add_viaduct(route, obstacles):
    probe,width=VIADUCTS[route['id']]
    mark=Point(*R.to_local(*probe))
    pts,states=route['points'],route['states']
    start=min((i for i,s in enumerate(states) if s==1),
              key=lambda i:LineString(pts[i:i+2]).distance(mark))
    if LineString(pts[start:start+2]).distance(mark)>80:
        raise ValueError(f"No elevated source line at the {route['id']} viaduct")
    end=start+1
    while start and states[start-1]==1:start-=1
    while end<len(states) and states[end]==1:end+=1
    span=LineString(pts[start:end+1])
    origin=sum(math.dist(p,q) for p,q in zip(pts[:start],pts[1:start+1]))
    # These are representative frames, not surveyed pier positions. Keep both feet
    # off mapped surface streets, ground tracks and rivers; leave the crossing open.
    piers=[]
    for nominal in range(16, int(span.length)-8, 28):
        frame=None
        # A viaduct beside or over a parallel carriageway may need a single
        # cantilevered head in place of a pair of columns straddling the tracks.
        paired=round(width*.31,2)
        for offsets in ((-paired,paired),(0,),(-paired,),(paired,),(-width*.5,),(width*.5,)):
            for shift in (0,4,-4,8,-8):
                at=nominal+shift
                p=span.interpolate(at)
                a,b=span.interpolate(at-.5),span.interpolate(at+.5)
                length=a.distance(b)
                if length<.1:continue
                nx,nz=(a.y-b.y)/length,(b.x-a.x)/length
                feet=(Point(p.x+offset*nx,p.y+offset*nz) for offset in offsets)
                if all(not len(obstacles.query(foot,predicate='intersects')) for foot in feet):
                    frame=[round(origin+at,2),*offsets];break
            if frame:break
        if frame:piers.append(frame)
    if not piers:raise ValueError(f"No clear pier sites on {route['id']}")
    route['viaduct']={'start':start,'end':end,'width':width,'piers':piers}


def route(spec,features):
    name,codes,start,end,color,cars,car_length=spec
    edges=[]; nodes=[]; buckets={}; graph={}
    def node(p):
        cell=(math.floor(p[0]),math.floor(p[1]))
        for dx in (-1,0,1):
            for dz in (-1,0,1):
                for i in buckets.get((cell[0]+dx,cell[1]+dz),[]):
                    if math.dist(p,nodes[i])<=1:return i
        i=len(nodes);nodes.append(p);buckets.setdefault(cell,[]).append(i);graph[i]=[];return i
    for c,pts,state,tracks,station in features:
        if not c.intersection(codes):continue
        a,b=node(pts[0]),node(pts[-1]); length=sum(math.dist(p,q) for p,q in zip(pts,pts[1:]))
        if a==b or length<.1:continue
        i=len(edges);edges.append((a,b,pts,state,tracks,station,length))
        graph[a].append((b,i,length));graph[b].append((a,i,length))
    def nearest(ll):
        p=R.to_local(*ll);i=min(range(len(nodes)),key=lambda i:math.dist(p,nodes[i]))
        assert math.dist(p,nodes[i])<220,(name,'endpoint too far',math.dist(p,nodes[i]))
        return i
    a,b=nearest(start),nearest(end);todo=[(0,a)];dist={a:0};prev={}
    while todo:
        d,u=heapq.heappop(todo)
        if d!=dist[u]:continue
        if u==b:break
        for v,i,w in graph[u]:
            nd=d+w
            if nd<dist.get(v,math.inf):dist[v]=nd;prev[v]=(u,i);heapq.heappush(todo,(nd,v))
    if b not in dist:raise ValueError(f'{name}: disconnected source graph; fetch missing tiles, never interpolate gaps')
    path=[];v=b
    while v!=a:
        u,i=prev[v];path.append((u,v,i));v=u
    path.reverse();points=[];states=[];tracks=[];stations=[];distance=0
    for u,v,i in path:
        ea,eb,pts,state,multi,station,length=edges[i]
        if ea!=u:pts=list(reversed(pts))
        if not points:points.append(list(nodes[u]))
        section_start=distance
        for p,q in zip(pts,pts[1:]):
            length=math.dist(p,q);n=max(1,math.ceil(length/12))
            for j in range(1,n+1):
                target=[round(p[k]+(q[k]-p[k])*j/n,2) for k in (0,1)]
                if math.dist(points[-1],target)<.01:continue
                distance+=math.dist(points[-1],target);points.append(target);states.append(state);tracks.append(multi)
        if station and state<2:stations.append({'code':station,'distance':round((section_start+distance)/2,2)})
    # Station source features can be split across tiles; merge each station's extents.
    by_station={}
    for s in stations:by_station.setdefault(s['code'],[]).append(s['distance'])
    stations=[{'code':code,'distance':round(sum(ds)/len(ds),2)} for code,ds in by_station.items()]
    # A station is not a track count. Carry the neighbouring main-line count through it.
    known=[i for i,n in enumerate(tracks) if n in (1,2)]
    tracks=[n if n in (1,2) else tracks[min(known,key=lambda j:abs(j-i))] if known else 1 for i,n in enumerate(tracks)]
    print(name,len(points),round(distance),len(stations),flush=True)
    return dict(id=name,points=points,states=states,tracks=tracks,stations=stations,color=color,cars=cars,carLength=car_length)


def main():
    features,obstacles=extract();routes=[route(s,features) for s in ROUTES]
    for r in routes:
        if r['id'] in VIADUCTS:add_viaduct(r,obstacles)
    out=json.dumps({'source':'GSI experimental vector map; illustrative elevations, trains and station architecture','routes':routes},separators=(',',':')).encode()
    print('gzip bytes',write_gz('railways.json.gz',out))


if __name__=='__main__':main()
