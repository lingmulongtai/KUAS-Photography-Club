"""Reconstruct the six connected Lotus Pavilion wings from their OSM footprints.

The atrium roof folds are interpreted from GSI seamless aerial photography.
The park's floor guide identifies the two octagonal halls and interior exhibits.
The height profile, glazing divisions and planted pools are reconstructions.
Requires numpy, pyproj, shapely >= 2.1 and trimesh.
"""
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapely
import trimesh
from pyproj import Geod
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import split

OUT = Path(__file__).resolve().parents[2] / 'public/kansai/landmarks'
origin = [135.9404719, 35.0736969]
geod = Geod(ellps='WGS84')
features = json.loads((OUT/'lotus-pavilion.geojson').read_text(encoding='utf-8'))['features']


def local(lon, lat):
    bearing, _, distance = geod.inv(*origin, lon, lat)
    angle = np.radians(bearing)
    return distance * np.array([np.sin(angle), -np.cos(angle)])


shapes = {f['properties']['part']: Polygon([local(*p) for p in f['geometry']['coordinates'][0]]) for f in features}
atrium = shapes['atrium']
corners = np.asarray(atrium.exterior.coords)
along = corners[3] - corners[5]
along /= np.linalg.norm(along)
across = np.array([-along[1], along[0]])
basis = np.stack([along, across])
uv = corners @ basis.T
offset = np.min(uv, axis=0)
floor = Polygon(uv - offset)

palette = {
    'Glazing': ([155, 194, 196, 111], .17), 'Steel': ([128, 167, 158, 255], .49),
    'Cladding': ([205, 199, 179, 255], .86), 'Roof': ([88, 96, 98, 255], .8),
    'Seam': ([136, 145, 144, 255], .74), 'Window': ([70, 103, 107, 255], .29),
    'Interior': ([154, 146, 126, 255], .93), 'Water': ([45, 96, 94, 255], .22),
    'Stone': ([106, 108, 94, 255], .92), 'Leaves': ([66, 121, 76, 255], .88),
    'Lilies': ([202, 131, 172, 255], .8),
}
pieces = defaultdict(list)


def xyz(p, height):
    return [p[0], height, p[1]]


def world(p):
    return (np.array(p) + offset) @ basis


def triangles(polygon, height, kind, transform=lambda p: p):
    for tri in shapely.get_parts(shapely.constrained_delaunay_triangles(polygon)):
        if tri.area < 1e-7:
            continue
        coords = list(shapely.orient_polygons(tri, exterior_cw=True).exterior.coords)[:3]
        vertices = [xyz(transform(p), height(*p)) for p in coords]
        pieces[kind].append(trimesh.Trimesh(vertices=vertices, faces=[[0, 1, 2]], process=False))


def face(vertices, kind):
    pieces[kind].append(trimesh.Trimesh(vertices=vertices, faces=[[0, 1, 2], [0, 2, 3]], process=False))


def member(a, b, radius, kind, sides=5):
    if np.linalg.norm(np.subtract(b, a)) > .01:
        pieces[kind].append(trimesh.creation.cylinder(radius=radius, segment=[a, b], sections=sides))


def walls(poly, bottom, top, kind, transform=lambda p: p):
    ring = list(poly.exterior.coords)
    for a, b in zip(ring, ring[1:]):
        face([xyz(transform(a), bottom), xyz(transform(b), bottom),
              xyz(transform(b), top(*b)), xyz(transform(a), top(*a))], kind)


def roof_height(u, v):
    # The narrow north and west wings meet at a diagonal hip. The third face
    # descends from their intersection to the long, southeast-facing wall.
    near = min(u, v)
    if near <= 12:
        return 5.4 + .54 * near
    return 11.88 - .43 * (near - 12)


def divide(polygons, line):
    return [part for poly in polygons for part in split(poly, line).geoms if part.area > .0001]


facets = [floor]
for line in [LineString([(12,-50),(12,75)]), LineString([(-50,12),(75,12)]),
             LineString([(-50,-50),(75,75)])]:
    facets = divide(facets, line)

walls(floor, -.5, lambda u,v: .8, 'Cladding', world)
walls(floor, .8, roof_height, 'Glazing', world)
triangles(floor, lambda u,v: .27, 'Interior', world)
frame_edges = set()


def bar(a, b, radius, bottom=False):
    p, q = (tuple(np.round(x, 3)) for x in (a, b))
    k = tuple(sorted((p, q))) + (bottom,)
    if k in frame_edges:
        return
    frame_edges.add(k)
    h = -.35 if bottom else roof_height(*p)
    member(xyz(world(p), h), xyz(world(q), roof_height(*q)), radius, 'Steel')


for facet in facets:
    triangles(facet, roof_height, 'Glazing', world)
    edges = list(facet.exterior.coords)
    for a, b in zip(edges, edges[1:]):
        bar(a, b, .105)
    # Square glazing in both rectangular wings, diagonal glazing on the third face.
    diagonal = min(facet.representative_point().coords[0]) > 12
    for normal in ([np.array([1.,1.]),np.array([1.,-1.])] if diagonal else np.eye(2)):
        normal = normal / np.linalg.norm(normal)
        tangent = np.array([-normal[1],normal[0]])
        for i in range(-30, 36):
            centre = normal * i * 2.05
            cut = facet.intersection(LineString([centre-tangent*85, centre+tangent*85]))
            for segment in shapely.get_parts(cut):
                if segment.geom_type == 'LineString' and segment.length > .1:
                    a, b = segment.coords[0], segment.coords[-1]
                    bar(a, b, .082 if i % 3 == 0 else .042)

ring = list(floor.exterior.coords)
for a, b in zip(ring, ring[1:]):
    stops = max(1, round(np.linalg.norm(np.subtract(a, b)) / 2.5))
    for j in range(stops):
        p = np.asarray(a) + np.subtract(b,a) * j/stops
        bar(p, p, .075, bottom=True)
    member(xyz(world(a), 2.75), xyz(world(b), 2.75), .055, 'Steel')

# The park describes four planted heated pools. Their internal contours are illustrative.
for u,v,rx,rz in [(8,11.5,3.9,2.8),(17.5,7,5,2.9),(8,23.5,3.6,5.1),(22.2,17.5,4.6,3.1)]:
    circle = np.linspace(0,2*np.pi,27)
    pond = Polygon([(u+rx*np.cos(t),v+rz*np.sin(t)) for t in circle]).intersection(floor.buffer(-1))
    triangles(pond, lambda x,y:.44, 'Water', world)
    for a,b in zip(pond.exterior.coords, list(pond.exterior.coords)[1:]):
        member(xyz(world(a),.46),xyz(world(b),.46),.12,'Stone')
    for i in range(17):
        t = i * 2.399963
        x,y = u+.72*rx*np.cos(t)*np.sqrt(i/17),v+.72*rz*np.sin(t)*np.sqrt(i/17)
        if pond.covers(Point(x,y).buffer(.35)):
            triangles(Point(x,y).buffer(.20+.055*(i%3),quad_segs=3),lambda a,b:.47,'Leaves',world)
            if i%4==0:
                triangles(Point(x+.1,y).buffer(.09,quad_segs=2),lambda a,b:.56,'Lilies',world)

for name, poly in shapes.items():
    if name == 'atrium':
        continue
    hall = name in ('theatre','lounge')
    height = 5.9 if hall else 6.7 if name=='main-hall' else 4.6
    walls(poly, -.65, lambda x,z:height, 'Cladding')
    coords = np.array(poly.exterior.coords)
    if hall:
        center = poly.centroid.coords[0]
        for a,b in zip(coords,coords[1:]):
            tip = xyz(center,height+3)
            pieces['Roof'].append(trimesh.Trimesh(vertices=[xyz(a,height),xyz(b,height),tip],
                faces=[[0,1,2]],process=False))
            if np.linalg.norm(a-b)>2:
                member(xyz(a,height+.03),tip,.06,'Seam')
    else:
        triangles(poly, lambda x,z:height, 'Roof')
    for a,b in zip(coords,coords[1:]):
        length = np.linalg.norm(a-b)
        member(xyz(a,height),xyz(b,height),.13,'Seam')
        if length < 5:
            continue
        # Window bands on the public galleries follow each facade orientation.
        n = max(1,int(length/4))
        for j in range(n):
            p=a+(b-a)*(j+.14)/n
            q=a+(b-a)*(j+.86)/n
            mid=(p+q)*.5
            if not atrium.covers(Point(mid)):
                outward = np.array([b[1]-a[1],a[0]-b[0]]) / length
                if poly.contains(Point(mid+outward*.04)):
                    outward = -outward
                p,q=p+outward*.045,q+outward*.045
                face([xyz(p,1.05),xyz(q,1.05),xyz(q,3.4),xyz(p,3.4)],'Window')

scene = trimesh.Scene()
for kind, meshes in pieces.items():
    mesh = trimesh.util.concatenate(meshes)
    # Area-weight smooth normals on joined steel bars while retaining crisp, separate pane edges.
    normals = np.zeros_like(mesh.vertices)
    faces = mesh.vertices[mesh.faces]
    cross = np.cross(faces[:,1] - faces[:,0], faces[:,2] - faces[:,0])
    for i in range(3):
        np.add.at(normals, mesh.faces[:,i], cross)
    lengths = np.linalg.norm(normals, axis=1)
    normals[lengths < 1e-12] = [0, 1, 0]
    mesh.vertex_normals = normals / np.maximum(lengths[:,None], 1e-12)
    rgba, roughness = palette[kind]
    material = trimesh.visual.material.PBRMaterial(name=kind,baseColorFactor=rgba,
        metallicFactor=.16 if kind in ('Steel','Seam') else 0.,roughnessFactor=roughness,
        alphaMode='BLEND' if kind=='Glazing' else 'OPAQUE', doubleSided=True)
    mesh.visual = trimesh.visual.TextureVisuals(material=material)
    scene.add_geometry(mesh, node_name=kind, geom_name=kind)
scene.export(OUT/'lotus-pavilion.glb', include_normals=True)
print('Lotus Pavilion:',len(features),'footprints,',sum(len(m.faces) for m in scene.geometry.values()),'triangles')
