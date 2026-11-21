"""Build the museum's roof terraces, cantilever, skylight and round aquarium.

The two georeferenced outer outlines and four openings are from OSM. Roof breaks
are traced in the GSI source photograph. The museum's construction section sets
the 15 m envelope; intermediate roof and facade levels are reconstructions.
Requires numpy, pyproj, shapely >= 2.1, Pillow and trimesh.
"""
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapely
import trimesh
from PIL import Image
from pyproj import Geod
from shapely.geometry import Polygon, Point

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(__file__).with_name('biwa-museum')
OUT = ROOT/'public/kansai/landmarks'
source = json.loads((SRC/'source.json').read_text(encoding='utf-8'))
features = json.loads((OUT/'biwa-museum.geojson').read_text(encoding='utf-8'))['features']
image = Image.open(SRC/'roof.jpg').convert('RGB')
world_size = 256 * 2 ** source['tileZoom']
origin = (135.9351978, 35.074304)
geod = Geod(ellps='WGS84')
paper_origin = np.array(source['pixelReferenceOrigin'])
image_origin = np.array(source['topLeftWorldPixel'])


def px(lon, lat):
    return np.array([(lon+180)/360, (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2])*world_size - paper_origin


def local(p, h):
    x, y = (p + paper_origin)/world_size
    lon, lat = 360*x-180, math.degrees(math.atan(math.sinh(math.pi*(1-2*y))))
    ang, _, r = geod.inv(*origin, lon, lat)
    return [r*math.sin(math.radians(ang)),h,-r*math.cos(math.radians(ang))]


def outline(coords):
    return Polygon([px(*p) for p in coords[0]], [[px(*p) for p in r] for r in coords[1:]])


main, aquarium = [outline(f['geometry']['coordinates']) for f in features]
skylight = Polygon([px(*p) for p in source['skylight']])
material = {
    'Walls': ([199,197,186,255], .83, 0), 'Stone': ([142,139,128,255], .91, 0),
    'Windows': ([73,96,104,255], .23, .12), 'Zinc': ([146,149,147,255], .52, .25),
    'Metal': ([173,175,172,255], .48, .3), 'Glass': ([91,131,142,255], .19, .15),
    'Mullions': ([157,164,160,255], .48, .29), 'Shade': ([83,82,75,255], .9, 0),
}
pieces = defaultdict(list)
positions, faces, uvs = [], [], []


def panel(vertices, kind):
    n = len(vertices)
    pieces[kind].append(trimesh.Trimesh(vertices=vertices,
        faces=[[0,i,i+1] for i in range(1,n-1)],process=False))


def bar(a, b, radius, kind):
    if np.linalg.norm(np.subtract(a,b)) > .04:
        pieces[kind].append(trimesh.creation.cylinder(radius=radius,segment=[a,b],sections=6))


def skin(poly, height, kind=None):
    for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(poly)):
        if triangle.area < 1e-6:
            continue
        ring = list(shapely.orient_polygons(triangle,exterior_cw=True).exterior.coords)[:3]
        verts = [local(p,height) for p in ring]
        if kind:
            panel(verts,kind)
        else:
            first = len(positions)
            positions.extend(verts)
            faces.append([first,first+1,first+2])
            for p in ring:
                s,t = (p + paper_origin - image_origin) / image.size
                uvs.append([s,1-t])


def facade(poly, low, high, kind='Walls', windows=False):
    for polygon in shapely.get_parts(poly):
        if polygon.geom_type != 'Polygon':
            continue
        for ring in [polygon.exterior,*polygon.interiors]:
            for a,b in zip(ring.coords,list(ring.coords)[1:]):
                p,q = np.array(a),np.array(b)
                face = [local(p,low),local(q,low),local(q,high),local(p,high)]
                panel(face,kind)
                length = np.linalg.norm(np.subtract(face[0],face[1]))
                if windows and length > 4.8:
                    direction = q-p
                    side = np.array([-direction[1],direction[0]])/np.linalg.norm(direction)
                    mid = (p+q)/2
                    if polygon.contains(Point(mid+.1*side)):
                        side = -side
                    count = max(1,round(length/3.6))
                    for j in range(count):
                        start = p+direction*(j+.06)/count+.13*side
                        end = p+direction*(j+.94)/count+.13*side
                        panel([local(start,low+.75),local(end,low+.75),
                               local(end,high-.7),local(start,high-.7)],'Windows')


# Four courtyard openings stay exposed all the way to the mapped ground.
ground_deck = main.difference(aquarium)
skin(ground_deck,5.55)
facade(ground_deck,-1.2,5.55,windows=True)
east = Polygon([(238,269),(298,273),(295,345),(237,341)])
west = Polygon([(152,261),(212,266),(211,280),(205,280),(201,337),(146,332)])
research = Polygon([(325,293),(427,321),(418,358),(315,332)])
hall = Polygon([(69,342),(117,317),(128,352),(80,375)])
terraces = [(west,13.55),(east,13.35),(research,9.05),(hall,8.55)]
for poly, height in terraces:
    roof = poly.intersection(main)
    skin(roof,height)
    facade(roof,5.55,height,windows=True)
    for geom in shapely.get_parts(roof):
        for a,b in zip(geom.exterior.coords,list(geom.exterior.coords)[1:]):
            bar(local(a,height+.08),local(b,height+.08),.13,'Zinc')

# The long silver eave sweeps over the northern garden in the photograph and site plan.
north_edge = [(99,258),(119,250),(144,243),(173,236),(198,233),(225,233),
              (251,235),(277,241),(304,251),(328,263),(349,277)]
overhang = Polygon(north_edge+[(98,258)])
skin(overhang,13.0)
skin(overhang,12.52,'Shade')
facade(overhang,12.52,13.,'Zinc')
for i in (2,4,6,8):
    a,b = north_edge[i],north_edge[i+1]
    support = ((a[0]+b[0])/2,(a[1]+b[1])/2+5.3)
    bar(local(support,0),local(support,12.52),.25,'Metal')

# The glazing between the two rectangular roofs is mapped separately from its surrounding atrium.
skin(skylight,12.35,'Glass')
facade(skylight,5.55,12.35,'Glass')
a,b,c,d = np.array(skylight.exterior.coords[:4])
for i in range(7):
    f = i/6
    bar(local(a+(b-a)*f,12.4),local(d+(c-d)*f,12.4),.06,'Mullions')
for i in range(11):
    f = i/10
    bar(local(a+(d-a)*f,12.4),local(b+(c-b)*f,12.4),.065,'Mullions')

# Shallow raised stainless roof with radial seams over the circular aquarium.
centre = np.array(aquarium.centroid.coords[0])
loop = np.array(aquarium.exterior.coords[:-1])
facade(aquarium,-1.2,8.35,windows=True)
height_limit = source['designMaxHeightM']
rings = [.08,.30,.56,.79,1]
def dome_height(f):
    return 8.35 + (height_limit-8.35)*(1-f**1.7)
for i,boundary in enumerate(loop):
    following = loop[(i+1)%len(loop)]
    for inner,outer in zip(rings,rings[1:]):
        p,q = centre+(boundary-centre)*inner,centre+(boundary-centre)*outer
        r,s = centre+(following-centre)*outer,centre+(following-centre)*inner
        panel([local(p,dome_height(inner)),local(q,dome_height(outer)),
               local(r,dome_height(outer)),local(s,dome_height(inner))],'Metal')
        if i%2==0:
            bar(local(p,dome_height(inner)+.025),local(q,dome_height(outer)+.025),.046,'Zinc')
    f = rings[0]
    panel([local(centre,height_limit),local(centre+(boundary-centre)*f,dome_height(f)),
           local(centre+(following-centre)*f,dome_height(f))],'Metal')

# Round secondary turret visible at the southwest rim of the aquarium roof.
small = Point(328,194).buffer(13.2,quad_segs=10)
facade(small,8.35,12.8,'Metal')
skin(small,12.8,'Zinc')

scene = trimesh.Scene()
roof = trimesh.Trimesh(vertices=positions,faces=faces,process=False)
roof.visual = trimesh.visual.TextureVisuals(uv=uvs,material=trimesh.visual.material.PBRMaterial(
    name='GSI roof imagery',baseColorTexture=image,roughnessFactor=.84,metallicFactor=.03,doubleSided=True))
scene.add_geometry(roof,node_name='Roof terraces',geom_name='Roof terraces')
for kind,meshes in pieces.items():
    rgba, roughness, metal = material[kind]
    mesh = trimesh.util.concatenate(meshes)
    mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
        name=kind,baseColorFactor=rgba,metallicFactor=metal,roughnessFactor=roughness,doubleSided=True))
    scene.add_geometry(mesh,node_name=kind,geom_name=kind)
# Preserve flat pane normals and smooth the separate round metal members.
for mesh in scene.geometry.values():
    tri = mesh.vertices[mesh.faces]
    areas = np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
    normals = np.zeros_like(mesh.vertices)
    for i in range(3):
        np.add.at(normals,mesh.faces[:,i],areas)
    norm = np.linalg.norm(normals,axis=1)
    normals[norm<1e-12] = [0,1,0]
    mesh.vertex_normals = normals/np.maximum(norm[:,None],1e-12)
scene.export(OUT/'biwa-museum.glb',include_normals=True)
print('Lake Biwa Museum:',len(main.interiors),'mapped openings,',len(faces),'textured roof triangles')
