"""Reconstruct Kyoto Botanical Gardens' conservatory on six Kyoto 2025 PLATEAU footprints.

The prefecture's facility plan specifies 14.80 m overall. GSI orthophotography
locates the roof ridges and the pond-facing lobe; their curvature, glazing bars
and sheltered planting are interpretations. Requires numpy, Pillow, pyproj,
Shapely 2.1 and trimesh.
"""
from collections import defaultdict
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Geod, Transformer
import shapely
from shapely.geometry import LineString, Point, Polygon, box, shape
import trimesh

OUT = Path(__file__).resolve().parents[2] / 'public/kansai/landmarks'
SOURCE = Path(__file__).with_name('kitayama-conservatory')
photo = Image.open(SOURCE/'roof.jpg').convert('RGB')
grid = json.loads((SOURCE/'imagery.json').read_text())
origin = (135.7609759, 35.0482789)
project = Transformer.from_crs(4326, grid['epsg'], always_xy=True)
inverse = Transformer.from_crs(grid['epsg'], 4326, always_xy=True)
anchor = np.array(project.transform(*origin))
angle = math.radians(8)
axes = np.array([[math.cos(angle), math.sin(angle)], [-math.sin(angle), math.cos(angle)]])
geod = Geod(ellps='WGS84')
footprints = json.loads((OUT/'kitayama-conservatory.geojson').read_text())['features']
positions, faces = defaultdict(list), defaultdict(list)


def emit(kind, points):
    # Face upward even when a clipped cell arrives from GEOS wound clockwise.
    if kind in ('Roof','Floor','Frame'):
        area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1]))
        if area < 0:
            points = points[::-1]
    first = len(positions[kind])
    positions[kind].extend(points)
    for i in range(1, len(points)-1):
        faces[kind].append((first, first+i, first+i+1))


def roof_level(u, v, wing):
    if wing == '2009290':
        return 3.8
    if wing == '2100358':
        return 5.9
    # Two longitudinal crests flank an open courtyard. The southeast lobe
    # curves back to the pond-facing eave, as in the prefecture's exterior views.
    def arch(distance, span):
        t = min(1.,abs(distance)/span)
        return (1.-t*t)**1.35
    primary = (5.1 + 5.7*math.exp(-((v+29)/18)**2) + 3.2*math.exp(-((v-35)/16)**2))*arch(u-7, 17)
    west_axis = -15.3-.18*v
    west = (5.6 + 2.5*math.exp(-((v+17)/13)**2) + 2.4*math.exp(-((v-29)/13)**2))*arch(u-west_axis, 14)
    lobe = 7.7*arch(math.hypot((u-22)/21.5, (v+28)/19), 1)
    return min(14.70, 4. + max(primary, west, lobe))


def intervals(intersection):
    for part in shapely.get_parts(intersection):
        if part.geom_type == 'LineString' and part.length > .08:
            yield np.array(part.coords[0]), np.array(part.coords[-1])


def top_ring(uv, fn):
    return [(u, v, fn(u,v)) for u,v in uv]


def canopy(u,v,height):
    crown = height*.32
    for i in range(7):
        t = 2*math.pi*i/7
        dx,dy = math.cos(t),math.sin(t)
        shoulder = (u+dx*crown*.54, v+dy*crown*.54, height)
        for side in (-1,1):
            blade = (shoulder[0]+side*dy*crown*.17, shoulder[1]-side*dx*crown*.17, height-.12)
            tip = (u+dx*crown, v+dy*crown, height-crown*.34)
            emit('Planting',[(u,v,height-.4),blade,tip])
    r = .09
    for dx,dy,nx,ny in [(r,0,0,r),(0,r,-r,0),(-r,0,0,-r),(0,-r,r,0)]:
        emit('Trunks',[(u+dx,v+dy,.2),(u+nx,v+ny,.2),(u+nx*.6,v+ny*.6,height-.4),(u+dx*.6,v+dy*.6,height-.4)])


for feature in footprints:
    wing = feature['properties']['buildingId'].split('-')[-1]
    survey = shape(feature['geometry'])
    rings = []
    for ring in [survey.exterior,*survey.interiors]:
        a = np.array(project.transform(*np.asarray(ring.coords).T)).T
        rings.append((a-anchor) @ axes.T)
    poly = Polygon(rings[0],rings[1:])
    height = lambda x,y: roof_level(x,y,wing)
    opaque = wing in ('2009290','2100358')
    for tri in shapely.get_parts(shapely.constrained_delaunay_triangles(poly)):
        emit('Floor',top_ring(list(tri.exterior.coords)[:3],lambda x,y:.13))

    # Clip small sheets to the measured outlines. The gap between both ranges
    # stays open to the sky and the national aerial image on the ground.
    spacing = 2.7
    w,s,e,n = poly.bounds
    xs = np.arange(math.floor(w/spacing),math.ceil(e/spacing)+1)*spacing
    ys = np.arange(math.floor(s/spacing),math.ceil(n/spacing)+1)*spacing
    for u in xs[:-1]:
        for v in ys[:-1]:
            cell = box(u,v,u+spacing,v+spacing)
            if not cell.intersects(poly):
                continue
            if poly.covers(cell):
                emit('Roof',top_ring(list(cell.exterior.coords)[:4],height))
            else:
                for f in shapely.get_parts(shapely.constrained_delaunay_triangles(cell.intersection(poly))):
                    emit('Roof',top_ring(list(f.exterior.coords)[:3],height))
    # The same roof coordinates drive the upright glazing and its steel caps.
    wall_points = list(shapely.segmentize(poly.exterior,2.5).coords)
    for (u,v),(x,y) in zip(wall_points,wall_points[1:]):
        wall_height, next_height = height(u,v), height(x,y)
        p,q = np.array([u,v]),np.array([x,y])
        emit('Plinth',[(u,v,-.75),(x,y,-.75),(x,y,.8),(u,v,.8)])
        emit('Service walls' if opaque else 'Vertical glass',[(u,v,.8),(x,y,.8),(x,y,next_height),(u,v,wall_height)])
        if not opaque:
            narrow = p+(q-p)*min(1,.11/max(.001,np.linalg.norm(q-p)))
            emit('Frame',[(u,v,.8),(*narrow,.8),(*narrow,height(*narrow)),(u,v,wall_height)])
            emit('Frame',[(u,v,2.65),(x,y,2.65),(x,y,2.75),(u,v,2.75)])
    if opaque:
        continue
    for horizontal,lines in [(True,ys),(False,xs)]:
        for t in lines:
            line = LineString([(w-1,t),(e+1,t)] if horizontal else [(t,s-1),(t,n+1)])
            for p,q in intervals(poly.intersection(line)):
                count = max(1,math.ceil(np.linalg.norm(q-p)/spacing))
                edge = np.linspace(p,q,count+1)
                delta = np.array([0,.065] if horizontal else [.05,0])
                for a,b in zip(edge,edge[1:]):
                    emit('Frame',top_ring([a-delta,b-delta,b+delta,a+delta],lambda x,y:height(x,y)+.1))
    # Tropical silhouettes remain below the glazing and clear of the courtyard.
    if wing in ('2009397','2009312'):
        for row,v in enumerate(np.arange(s+2.5,n,5.8)):
            for u in np.arange(w+2.5+(row%2)*2.6,e,6.2):
                if poly.covers(Point(u,v).buffer(1.6)) and abs(u-7)>2:
                    canopy(u,v,min(height(u,v)-1.1,4.1+2.0*(.5+.5*math.sin(2*u+v))))


palette = {
    'Floor': ([77,90,71,255],.9), 'Roof': ([254,255,255,226],.34),
    'Vertical glass': ([153,182,175,145],.22), 'Frame': ([177,182,177,255],.51),
    'Service walls': ([192,192,175,255],.8), 'Plinth': ([122,123,110,255],.85),
    'Trunks': ([117,99,70,255],.9), 'Planting': ([50,98,59,255],.86)
}
scene = trimesh.Scene()
for name, points in positions.items():
    data = np.array(points)
    east,north = (data[:,:2] @ axes + anchor).T
    lon,lat = inverse.transform(east,north)
    azi,_,dist = geod.inv(np.full(len(lon),origin[0]),np.full(len(lon),origin[1]),lon,lat)
    xyz = np.stack([dist*np.sin(np.radians(azi)),data[:,2],-dist*np.cos(np.radians(azi))],axis=1)
    mesh = trimesh.Trimesh(vertices=xyz,faces=faces[name],process=False)
    color,roughness = palette[name]
    uv = None
    if name == 'Roof':
        uv = np.stack([((east-grid['west'])/grid['pixelM']+.5)/photo.width,
                       1-((grid['north']-north)/grid['pixelM']+.5)/photo.height],axis=1)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv,material=trimesh.visual.material.PBRMaterial(
        name=name,baseColorFactor=color,baseColorTexture=photo if uv is not None else None,
        metallicFactor=.16 if name=='Frame' else 0,roughnessFactor=roughness,
        doubleSided=True,alphaMode='BLEND' if color[3]<255 else 'OPAQUE'))
    points3 = mesh.vertices[mesh.faces]
    normals = np.zeros_like(mesh.vertices)
    cross = np.cross(points3[:,1]-points3[:,0],points3[:,2]-points3[:,0])
    for i in range(3):
        np.add.at(normals,mesh.faces[:,i],cross)
    length = np.linalg.norm(normals,axis=1)
    valid = length > 1.e-12
    normals[valid] /= length[valid,None]
    normals[~valid] = [0,1,0]
    mesh.vertex_normals = normals
    scene.add_geometry(mesh,node_name=name,geom_name=name)
scene.export(OUT/'kitayama-conservatory.glb',include_normals=True)
print('Kitayama conservatory:',len(footprints),'surveyed sections,',sum(len(m.faces) for m in scene.geometry.values()),'triangles')
