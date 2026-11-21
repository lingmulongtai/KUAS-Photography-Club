"""Model four surveyed Kyoto roofs using the prefecture's 0.5 m DCHM + GSI aerials.

Requires numpy, rasterio, pyproj, shapely >= 2.1, Pillow and trimesh >= 4.
The source crops, image tile hashes, footprint IDs and reuse conditions live in
kyoto-roof-surveys/. PLATEAU gives the maximum height. The sheltered timber
frames are reconstructions; the laser returns describe the exposed roof only.
"""
import json
from pathlib import Path

import numpy as np
import rasterio
import shapely
import trimesh
from PIL import Image
from pyproj import Transformer
from shapely.geometry import shape, box


SOURCE = Path(__file__).with_name('kyoto-roof-surveys')
TARGET = Path(__file__).resolve().parents[2] / 'public/kansai/landmarks'
TO_GRID = Transformer.from_crs(4326, 6674, always_xy=True)
TO_WORLD = Transformer.from_crs(6674, 4978, always_xy=True)


def geometry(vertices, faces, material, uv=None):
    vertices, faces = np.array(vertices), np.array(faces)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    # In the glTF Y-up frame, (east, up, -north) is right-handed.
    return mesh


def solid(name, rgb):
    return trimesh.visual.material.PBRMaterial(name=name, baseColorFactor=[*rgb, 255],
        metallicFactor=0., roughnessFactor=.93, doubleSided=True)


def roof_model(info):
    folder = SOURCE / info['site']
    feature = json.loads((folder/'osm.geojson').read_text(encoding='utf-8'))
    footprint = shape(feature['geometry'])
    polygon = shapely.transform(footprint,TO_GRID.transform,interleaved=False)
    lon, lat = info['wgs84Center']
    centre = np.asarray(TO_GRID.transform(lon,lat))
    base = np.array(TO_WORLD.transform(*centre,0.))
    l,b = np.deg2rad([lon,lat])
    east = np.array([-np.sin(l),np.cos(l),0])
    south = np.array([np.sin(b)*np.cos(l),np.sin(b)*np.sin(l),-np.cos(b)])

    with rasterio.open(folder/'surface-height.tif') as src:
        heights = src.read(1)
        affine = src.transform
    with rasterio.open(folder/'gsi-ortho.tif') as src:
        assert src.transform == affine and src.shape == heights.shape
        image = Image.fromarray(np.moveaxis(src.read(),0,2))
    limit = info['plateauMeasuredHeightMeters']
    # The first / last returns occasionally pick up the ground or an adjacent
    # tree. Median-filter a single pixel's neighbourhood before interpolation.
    padded = np.pad(np.clip(heights,0,limit),1,mode='edge')
    filtered = np.median(np.lib.stride_tricks.sliding_window_view(padded,(3,3)),axis=(-1,-2))
    rows,cols = heights.shape
    def sample(x,y):
        c,r = ~affine * (x,y)
        c,r = np.clip(c-.5,0,cols-1.001), np.clip(r-.5,0,rows-1.001)
        i,j = int(c),int(r)
        a,d = c-i,r-j
        h = (1-d)*((1-a)*filtered[j,i]+a*filtered[j,i+1])+d*((1-a)*filtered[j+1,i]+a*filtered[j+1,i+1])
        return max(info['p50Outer2m']*.56,float(h))

    def local(x,y,h):
        v = np.asarray(TO_WORLD.transform(x,y,0.))-base
        return [float(east@v),h,float(south@v)]

    positions,uv,faces,index = [],[],[],{}
    def vertex(x,y):
        key=(round(x,6),round(y,6))
        if key not in index:
            index[key]=len(positions)
            positions.append(local(x,y,sample(x,y)))
            c,r=~affine*(x,y)
            uv.append([c/cols,1-r/rows])  # trimesh's exporter converts to the glTF top-left convention
        return index[key]

    # Clip each cell against the actual roof outline, so projecting eaves and
    # narrow connecting passages survive the conversion at their measured positions.
    for r in range(rows-1):
        for c in range(cols-1):
            x,y=affine*(c+.5,r+.5)
            x1,y1=affine*(c+1.5,r+1.5)
            cell=box(x,y1,x1,y)
            if polygon.covers(cell):
                a,b,c0,d=[vertex(*p) for p in [(x,y1),(x1,y1),(x1,y),(x,y)]]
                faces.extend([(a,b,c0),(a,c0,d)])
            elif polygon.intersects(cell):
                clipped=polygon.intersection(cell)
                for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(clipped)):
                    points=list(shapely.orient_polygons(triangle).exterior.coords)[:3]
                    if triangle.area>1e-6:faces.append([vertex(*p) for p in points])
    # A return can jump from one storey to the lower eave or to the ground.
    # Never stretch the roof photograph over the vertical space between them.
    faces=[f for f in faces if max(positions[i][1] for i in f)-min(positions[i][1] for i in f)<1.25]
    # The orthophoto contains sunlight and shadow. Retain its tile variation,
    # while leaving the survey normals and the scene sun to supply illumination.
    grey=np.asarray(image.convert('L'),dtype=float)
    image=Image.fromarray(np.uint8(np.stack([43+grey*.34,46+grey*.34,50+grey*.34],axis=-1)))
    mat=trimesh.visual.material.PBRMaterial(name='Surveyed roof tiles',baseColorTexture=image,
        metallicFactor=0.,roughnessFactor=.86,doubleSided=True)
    roof=geometry(positions,faces,mat,uv)
    scene=trimesh.Scene()
    scene.add_geometry(roof,node_name='Measured roof',geom_name='Measured roof')
    eave=info['p50Outer2m']
    timber=solid('Weathered timber',(92,64,44))
    plaster=solid('Lime plaster',(192,181,154))
    stone=solid('Stone footings',(130,127,116))
    joinery=solid('Timber in shade',(50,39,33))
    slats=solid('Shutter slats',(114,89,67))
    tiles=solid('Glazed lower eaves',(70,75,82))
    pieces={}
    def add(mesh,material):
        pieces.setdefault(material.name,(material,[]))[1].append(mesh)
    def panel(points,material):
        add(trimesh.Trimesh(vertices=points,faces=[[0,1,2],[0,2,3]],process=False),material)
    def wall(a,b,low,high,material):
        panel([local(*a,low),local(*b,low),local(*b,high),local(*a,high)],material)
    def column(x,y,r,h,low=0):
        from math import sin,cos,tau
        sides=[[x+r*cos(i*tau/10),y+r*sin(i*tau/10)] for i in range(10)]
        for a,b in zip(sides,sides[1:]+sides[:1]):wall(a,b,low,h,timber)

    if info['site']=='nanzenji-sanmon':
        # Five bays and three open passages below the two-storey gate.
        # The OSM outline includes two lower side galleries. Fit the five-bay
        # gate to the high returns only; the galleries have their own eaves.
        rr,cc=np.where(filtered>limit*.70)
        px,py=affine*(cc+.5,rr+.5)
        inside=shapely.contains_xy(polygon,px,py)
        crown=shapely.multipoints(np.column_stack((px[inside],py[inside]))).convex_hull
        rect=np.array(crown.minimum_rotated_rectangle.exterior.coords)[:4]
        edges=np.roll(rect,-1,axis=0)-rect
        u=edges[np.argmax(np.linalg.norm(edges,axis=1))]
        v=np.array([-u[1],u[0]])/np.linalg.norm(u)*min(np.linalg.norm(edges,axis=1))
        mid=rect.mean(axis=0)
        def point(t,z):return mid+t*u+z*v
        deck=eave*.62
        for x in np.linspace(-.42,.42,6):
            for y in [-.32,0,.32]:column(*point(x,y),.49,deck)
        # Timber doors close the two outer bays. Lintels span the three central passages.
        for y in [-.32,.32]:
            wall(point(-.43,y),point(.43,y),deck-1.05,deck-.7,timber)
            for x in [-.42,.252]:
                wall(point(x,y),point(x+.168,y),.35,deck-.95,timber)
        for fragment in shapely.get_parts(polygon.difference(crown.buffer(.75)).buffer(-1.0)):
            if fragment.area<8:continue
            edges=list(fragment.exterior.coords)
            for a,b in zip(edges,edges[1:]):
                top=min(sample(*a),sample(*b),deck+.1)-.3
                if top>1.5:wall(a,b,.2,top,timber)
        for a,b in zip([(-.46,-.39),(.46,-.39),(.46,.39),(-.46,.39)],
                       [(.46,-.39),(.46,.39),(-.46,.39),(-.46,-.39)]):
            wall(point(*a),point(*b),deck-.45,deck,timber)
            wall(point(*a),point(*b),deck+.68,deck+.82,timber)
            aa=point(a[0]*.83,a[1]*.76);bb=point(b[0]*.83,b[1]*.76)
            wall(aa,bb,deck,eave+.35,joinery)
            edge0,edge1=np.array(a),np.array(b)
            def edge(t,s):
                p=(1-t)*edge0+t*edge1
                return point(p[0]*s,p[1]*s)
            # The lower tiled canopy projects beyond the galleries. A raised
            # corner and two intermediate slopes catch the low sun at the eaves.
            bays=5 if np.linalg.norm(bb-aa)>15 else 2
            for t0,t1 in zip(np.linspace(0,1,bays*4+1)[:-1],np.linspace(0,1,bays*4+1)[1:]):
                for inner,outer,hi,lo in [(.80,.97,deck-.22,deck-.96),(.97,1.10,deck-.96,deck-1.22)]:
                    lift=lambda t: (abs(2*t-1)**6)*.35
                    panel([local(*edge(t0,inner),hi+lift(t0)),local(*edge(t1,inner),hi+lift(t1)),
                           local(*edge(t1,outer),lo+lift(t1)),local(*edge(t0,outer),lo+lift(t0))],tiles)
            # Recessed shutters and their lintels stay legible below the dark roof.
            step=(bb-aa)/bays
            for i in range(bays):
                start=aa+i*step;end=start+step
                column(*start,.22,eave+.22,deck)
                soffit=eave-.33
                for j in range(7):
                    s0=start+step*(.07+j*.125)
                    s1=s0+step*.094
                    off=(s0-mid)*.006
                    wall(s0+off,s1+off,deck+.32,soffit,slats)
                for height in [deck+.4,deck+1.18,soffit-.25]:
                    off=((start+end)*.5-mid)*.012
                    wall(start+off,end+off,height,height+.14,joinery)
                for t in [.25,.75]:
                    post=edge((i+t)/bays,.995)
                    column(*post,.078,deck+.82,deck)
        panel([local(*point(x,y),deck) for x,y in [(-.46,-.39),(.46,-.39),(.46,.39),(-.46,.39)]],timber)
    else:
        for enclosed in shapely.get_parts(polygon.buffer(-1.3,join_style='mitre')):
            ring=list(enclosed.exterior.coords)
            for a,b in zip(ring,ring[1:]):
                a,b=np.array(a),np.array(b)
                top=min(eave,min(sample(*a),sample(*b))-.2)
                wall(a,b,-.15,.36,stone)
                wall(a,b,.36,top*.66,timber)
                wall(a,b,top*.66,top,plaster)
                count=max(1,round(np.linalg.norm(b-a)/2.5))
                tangent=(b-a)/count
                normal=np.array([tangent[1],-tangent[0]])
                normal*=.04/max(.001,np.linalg.norm(normal))
                for i in range(count):
                    start=a+tangent*i
                    column(*start,.14,top+.14,.32)
                    for j in range(6):
                        p=start+tangent*(.09+j*.139)+normal
                        wall(p,p+tangent*.098,.62,top*.61,slats)
                    for height in [.58,top*.62,top*.87]:
                        wall(start+normal*2,start+tangent+normal*2,height,height+.14,joinery)
    for name,(material,meshes) in pieces.items():
        combined=trimesh.util.concatenate(meshes)
        combined.visual=trimesh.visual.TextureVisuals(material=material)
        scene.add_geometry(combined,node_name=name,geom_name=name)
    scene.metadata.update({'heightSource':'Kyoto Prefecture DCHM 0.5 m','osmWay':info['way'],
        'plateauId':info['plateauFeature'],'surveyed':'roof surface','reconstructed':'sheltered structure'})
    for part in scene.geometry.values():
        # Use area-weighted normals even in a minimal NumPy-only build of trimesh.
        pts=np.asarray(part.vertices)[part.faces]
        face_normals=np.cross(pts[:,1]-pts[:,0],pts[:,2]-pts[:,0])
        normals=np.zeros_like(part.vertices)
        for k in range(3):np.add.at(normals,part.faces[:,k],face_normals)
        lengths=np.linalg.norm(normals,axis=1)
        normals[lengths<1e-12]=[0,1,0]
        part.vertex_normals=normals/np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-12)
    scene.export(TARGET/(info['site']+'.glb'),include_normals=True)
    print(info['site'],len(faces),'surveyed roof triangles')
    return {'id':info['site'],'pref':'26','lon':lon,'lat':lat,'file':'/kansai/landmarks/'+info['site']+'.glb',
            'rings':[list(footprint.exterior.coords)[:-1]]}


if __name__=='__main__':
    records=json.loads((SOURCE/'index.json').read_text(encoding='utf-8'))
    output=[roof_model(site) for site in records['sites']]
    (TARGET/'temple-roofs.json').write_text(json.dumps(output,separators=(',',':'))+'\n',encoding='utf-8')
