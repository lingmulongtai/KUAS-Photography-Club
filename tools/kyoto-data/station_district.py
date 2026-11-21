"""Prepare the 222 neighboring survey buildings in the same local frame as the station."""
import gzip
import json
import subprocess
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

CENTER = (-96.23, 1957.7)


def terrain_height():
    # The entire survey fits in the interior of the Kyoto basin's 30 m DEM.
    public = Path(__file__).resolve().parents[2] / "public/kyoto"
    meta = json.loads((public / "terrain.json").read_text())["far"]
    raw = np.frombuffer(gzip.decompress((public / meta["file"]).read_bytes()), dtype=np.uint8)
    low, high = np.split(raw, 2)
    deltas = (low.astype(np.uint16) | (high.astype(np.uint16) << 8)).view(np.int16)
    rows = deltas.astype(np.int32).reshape(meta["nz"], meta["nx"])
    rows[:, 0] = np.cumsum(rows[:, 0])
    grid = np.cumsum(rows, axis=1) * .1

    def height(x, z):
        x = (x - meta["box"][0]) / meta["step"]
        z = (z - meta["box"][1]) / meta["step"]
        i, j = int(x), int(z)
        tx, tz = x-i, z-j
        return ((1-tx) * ((1-tz)*grid[j,i] + tz*grid[j+1,i])
                + tx * ((1-tz)*grid[j,i+1] + tz*grid[j+1,i+1]))
    return height


def survey_photo(material):
    if material and material.use_nodes:
        return next((n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)


def prepare_district(meshes, site, folder):
    by_building = defaultdict(list)
    limits, photos = {}, {}
    height = terrain_height()
    station_base = height(*CENTER)
    minmax = {}
    for obj in meshes:
        by_building[obj.parent.name].append(obj)
    if len(by_building) != 222:
        raise ValueError(f"Unexpected district building count: {len(by_building)}")

    for name, objects in by_building.items():
        corners = np.asarray([list((site @ obj.matrix_world) @ Vector(p))
                              for obj in objects for p in obj.bound_box])
        lo, hi = corners.min(axis=0), corners.max(axis=0)
        minmax[name] = (lo, hi)
        span = max((hi-lo)[:2])
        limit = 1280 if name == "Building.026" else 640 if span >= 60 else 384 if span >= 30 else 256
        for obj in objects:
            for slot in obj.material_slots:
                image = survey_photo(slot.material)
                if image:
                    if not image.packed_file:
                        raise ValueError(f"Missing embedded photograph {image.name}")
                    if image not in photos:
                        photos[image] = f"photo-{len(photos)}"
                        (folder / photos[image]).write_bytes(image.packed_file.data)
                    key = photos[image]
                    limits[key] = max(limits.get(key, 0), limit)
    (folder / "photos.json").write_text(json.dumps(limits))
    subprocess.run(["python", str(Path(__file__).with_name("pack_station_photos.py")), str(folder)], check=True)
    layout = json.loads((folder / "layout.json").read_text())
    materials, maps = {}, {}

    def material(page, tower):
        key = (page, tower)
        if key not in materials:
            mat = bpy.data.materials.new(f"District {'tower' if tower else 'facade'} {page}")
            mat.use_nodes = True
            shader = mat.node_tree.nodes.get("Principled BSDF")
            shader.inputs["Base Color"].default_value = (.56, .57, .57, 1)
            if page >= 0:
                if page not in maps:
                    maps[page] = bpy.data.images.load(str(folder / f"district-{page}.png"))
                    maps[page].pack()
                node = mat.node_tree.nodes.new("ShaderNodeTexImage")
                node.image = maps[page]
                mat.node_tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
            materials[key] = mat
        return materials[key]

    for name, objects in by_building.items():
        lo, hi = minmax[name]
        x, y = ((lo + hi) / 2)[:2]
        # Translate each rigid building as a whole onto the same ground as its proxy.
        dy = height(CENTER[0] + x, CENTER[1] - y) - station_base - lo[2]
        for obj in objects:
            transform = Matrix.Translation((0, 0, dy)) @ site @ obj.matrix_world
            if obj.data.users > 1:
                obj.data = obj.data.copy()
            mesh = obj.data
            mesh.transform(transform)
            obj.parent = None
            obj.matrix_world = Matrix.Identity(4)
            slots = list(mesh.materials) or [None]
            indices = np.empty(len(mesh.polygons), dtype=np.int32)
            sizes = np.empty_like(indices)
            mesh.polygons.foreach_get("material_index", indices)
            mesh.polygons.foreach_get("loop_total", sizes)
            face_slots = np.repeat(indices, sizes)
            layer = mesh.uv_layers.active
            if layer:
                uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
                layer.data.foreach_get("uv", uv)
                uv = uv.reshape(-1, 2)
            for idx, old in enumerate(slots):
                image = survey_photo(old)
                page = -1
                if layer and image:
                    page, u, v, w, h = layout[photos[image]]
                    mask = face_slots == idx
                    uv[mask] = np.clip(uv[mask], 0, 1) * (w, h) + (u, v)
                replacement = material(page, name == "Building.026")
                if len(mesh.materials):
                    mesh.materials[idx] = replacement
                else:
                    mesh.materials.append(replacement)
            if layer:
                layer.data.foreach_set("uv", uv.ravel())
