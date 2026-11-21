"""Blender 3.6: blender -b -P export_station.py -- buildings.fbx plaza.fbx station.glb.

Inputs: Kyoto City high-resolution FBX (resource 21224), building and plaza layers.
Requires host Python with Pillow for the neighboring buildings' photo atlases.
Then run gltfpack -i station.glb -o kyoto-station-district.glb -cc -ce ext -mm -km
    -si 0.36 -se 0.0015 -sp -tw -tl 2048 -tq 8 (native gltfpack 1.3)
Repeat with --compact after the three paths for kyoto-station-district-compact.glb.
"""
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from station_district import prepare_district

args = sys.argv[sys.argv.index("--") + 1:]
building, plaza, output = map(Path, args[:3])
bpy.ops.wm.read_factory_settings(use_empty=True)
# Kyoto JGD2011 plane VI east/north into the hero's local east/north axes.
site = Matrix(((.999876364, -.002417062, 0, -.374283),
               (.002417531, 1.000094009, 0, -.826159),
               (0, 0, 1, -26.39), (0, 0, 0, 1))) @ Matrix.Translation((22053, 112471, 0))

for path, is_plaza in [(building, False), (plaza, True)]:
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path.resolve()), use_image_search=False)
    imported = set(bpy.data.objects) - existing
    meshes = sorted((o for o in imported if o.type == "MESH" and
                     (is_plaza or (o.parent and o.parent.name == "Building.095"))),
                    key=lambda o: o.name)
    if not meshes:
        raise ValueError(f"Missing station meshes in {path}")
    district = set()
    if not is_plaza:
        district = {o for o in imported if o.type == "MESH"} - set(meshes)
        with tempfile.TemporaryDirectory() as scratch:
            prepare_district(sorted(district, key=lambda o: o.name), site, Path(scratch), "--compact" in args[3:])
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        transform = site @ obj.matrix_world
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        obj.data.transform(transform)
        if not is_plaza and obj.name == "Object.203":
            # The FBX bakes the central barrel vault and the masonry wings into
            # the same opaque atlas. Its long strips span the surveyed atrium.
            glazing = obj.data.materials[0].copy()
            glazing.name = "Atrium glazing"
            obj.data.materials.append(glazing)
            for face in obj.data.polygons:
                points = [obj.data.vertices[i].co for i in face.vertices]
                x, north, height = zip(*points)
                if (min(x) > -16 and max(x) < 118 and max(x) - min(x) > 50
                        and min(north) > -4 and max(north) < 24 and min(height) > 23):
                    face.material_index = len(obj.data.materials) - 1
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        obj.select_set(True)
    if is_plaza:
        # Store curb and planting heights above the surveyed roadway. The viewer
        # adds local DEM elevation to these offsets so the plaza meets its streets.
        vertices, triangles = [], []
        for road in (o for o in meshes if o.name.split(".")[0] == "車道部"):
            offset = len(vertices)
            vertices.extend(v.co.copy() for v in road.data.vertices)
            road.data.calc_loop_triangles()
            triangles.extend([offset + i for i in t.vertices] for t in road.data.loop_triangles)
        roads = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
        for obj in meshes:
            for vertex in obj.data.vertices:
                surface, _, _, _ = roads.find_nearest(vertex.co)
                vertex.co.z -= surface.z
    for obj in imported - set(meshes) - district:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = "Plaza" if is_plaza else "Station"
    if is_plaza:
        for material in joined.data.materials:
            if material:
                material.name = "Plaza-" + material.name

bpy.ops.export_scene.gltf(filepath=str(output.resolve()), export_format="GLB",
                          export_copyright="Kyoto City, CC BY 4.0; adapted from resource 21224")
