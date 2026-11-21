"""Extract textured Kyoto monuments from the 2025 PLATEAU survey (DracoPy, NumPy, Pillow, pyproj, Shapely 2).

Each GML feature was matched to the named building's outer footprint. The municipal LOD3
package repeats the LOD2 aquarium tile byte-for-byte. Daikaku-ji's Mie-do and Shinden in
Ukyo data93, Nanzen-ji's Sanmon in Sakyo data147 and Shimogamo's Maidono in data167 are
untextured LOD1 even in the LOD2 district catalogues. Keep those in the regional layer.

The geometry, material parameters and image texels are from PLATEAU. OSM way IDs below
document the identity check only. Camera positions and measured heights are not used to
reconstruct the mesh. Source terms: https://www.mlit.go.jp/plateau/site-policy/
"""
import argparse
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
import struct
from urllib.request import urlopen

import DracoPy
import numpy as np
from PIL import Image
from pyproj import Transformer
import shapely

OUT = Path(__file__).resolve().parents[2] / 'public/kansai/landmarks'
BASE = 'https://assets.cms.plateau.reearth.io/assets/'
SURVEY = '26100_kyoto-shi_city_2025_citygml_1_op_bldg_3dtiles_'
SITES = [
    # Kyoto Aquarium, OSM way 279961174. https://www.kyoto-aquarium.com/about/floor/
    ('kyoto-aquarium', 'bldg_b1b5e06c-47c2-4e90-91f5-d921b3875401', 135.74769, 34.98756,
     'f0/2ed501-5480-4ccb-8293-9469a3856f9a/', '26106_shimogyo-ku_lod2/data/data56.b3dm',
     'd218de5fc52f92a28affc089ed58548a2a1eee830679ca85e08b9c34fa6510b3'),
    # Former prefectural office, OSM relation 9344948. https://www.pref.kyoto.jp/qhonkan/
    ('kyoto-old-office', 'bldg_aa7e1082-f9c0-4d5e-bb1b-0e0b7394cd2e', 135.75559, 35.02105,
     '71/0af6ab-875e-4c69-bb5e-9e06096e6fcb/', '26102_kamigyo-ku_lod2/data/data44.b3dm',
     '6da74c5396b65fedda10bff00bed5531fc88a636f951fa4e758bb756e71aa6b2'),
]
TO_ECEF = Transformer.from_crs(4979, 4978, always_xy=True)
TO_GEO = Transformer.from_crs(4978, 4979, always_xy=True)


def unpack_tile(tile):
    ft, fb, bj, bb = struct.unpack_from('<4I', tile, 12)
    start = 28 + ft + fb
    batch = json.loads(tile[start:start + bj])
    batch_binary = tile[start + bj:start + bj + bb]
    start += bj + bb
    size = struct.unpack_from('<I', tile, start + 12)[0]
    gltf = json.loads(tile[start + 20:start + 20 + size])
    payload = tile[start + 28 + size:]

    def read_view(index):
        view = gltf['bufferViews'][index]
        offset = view.get('byteOffset', 0)
        return payload[offset:offset + view['byteLength']]

    return batch, batch_binary, gltf, read_view


def photo_atlas(source, uv, faces):
    # Collect the source texels sampled by this building alone, including eight texels
    # around each chart for linear filtering and mipmaps. No photo is rescaled or recoloured.
    pixels = uv * source.size
    triangles = pixels[faces]
    low = np.maximum(0, np.floor(triangles.min(axis=1)).astype(int) - 8)
    high = np.minimum(source.size, np.ceil(triangles.max(axis=1)).astype(int) + 8)
    rects = shapely.box(low[:, 0], low[:, 1], high[:, 0], high[:, 1])
    charts = sorted(shapely.get_parts(shapely.union_all(rects)),
                    key=lambda p: (p.bounds[1] - p.bounds[3], *p.bounds))
    bounds = [tuple(map(int, chart.bounds)) for chart in charts]
    width = 2 ** math.ceil(math.log2(max(max(e - w for w, s, e, n in bounds),
        math.sqrt(sum((e - w) * (n - s) for w, s, e, n in bounds)))))
    x = y = row_height = 0
    packed = []
    for w, s, e, n in bounds:
        if x + e - w > width:
            x, y, row_height = 0, y + row_height, 0
        packed.append((x, y))
        row_height = max(row_height, n - s)
        x += e - w
    atlas = Image.new(source.mode, (width, y + row_height))
    mapped = np.full_like(pixels, np.nan)
    for chart, (w, s, _, _), (x, y) in zip(charts, bounds, packed):
        delta = np.array([x - w, y - s])
        # Each UV triangle has all its vertices inside one connected, padded chart.
        selected = shapely.intersects_xy(chart, pixels[:, 0], pixels[:, 1])
        mapped[selected] = pixels[selected] + delta
        for a, b in zip(low[selected[faces[:, 0]]], high[selected[faces[:, 0]]]):
            atlas.paste(source.crop((*a, *b)), tuple(a + delta))
    assert np.isfinite(mapped).all() and (mapped >= 0).all() and (mapped <= atlas.size).all()
    encoded = BytesIO()
    atlas.save(encoded, format='PNG', optimize=True)
    return mapped / atlas.size, encoded.getvalue()


def extract(site, tile):
    name, gml_id, lon, lat, prefix, tail, _ = site
    batch, batch_binary, src, read_view = unpack_tile(tile)
    index = batch['gml_id'].index(gml_id)
    lod = batch['_lod']
    if isinstance(lod, dict):
        assert lod['componentType'] in ('BYTE', 'UNSIGNED_BYTE') and lod['type'] == 'SCALAR'
        actual_lod = batch_binary[lod['byteOffset'] + index]
    else:
        actual_lod = lod[index]
    if actual_lod < 2:
        raise ValueError('Refusing to replace a monument with an LOD1 extrusion: ' + gml_id)
    assert src['nodes'] == [{'mesh': 0}]
    rtc = np.asarray(src['extensions']['CESIUM_RTC']['center'])
    longitude, latitude = np.radians([lon, lat])
    east = [-np.sin(longitude), np.cos(longitude), 0]
    up = [np.cos(latitude)*np.cos(longitude), np.cos(latitude)*np.sin(longitude), np.sin(latitude)]
    axes = np.array([east, up, np.cross(east, up)]).T   # glTF east, up, south
    meshes = []
    for primitive in src['meshes'][0]['primitives']:
        draco = primitive['extensions']['KHR_draco_mesh_compression']
        mesh = DracoPy.decode(read_view(draco['bufferView']))

        def attr(key):
            return mesh.get_attribute_by_unique_id(draco['attributes'][key])['data']

        batch_ids = attr('_BATCHID').ravel()
        faces = mesh.faces[np.all(batch_ids[mesh.faces] == index, axis=1)]
        if not len(faces):
            continue
        vertices, local = np.unique(faces, return_inverse=True)
        xyz = attr('POSITION')[vertices][:, [0, 2, 1]] * [1, -1, 1] + rtc
        normal = attr('NORMAL')[vertices][:, [0, 2, 1]] * [1, -1, 1] @ axes
        uv = attr('TEXCOORD_0')[vertices] if 'TEXCOORD_0' in draco['attributes'] else None
        meshes.append((xyz, normal, uv, local.reshape(-1, 3), primitive['material']))
    if not any(uv is not None for _, _, uv, _, _ in meshes):
        raise ValueError('The selected building has no photographic material: ' + gml_id)
    positions = np.concatenate([m[0] for m in meshes])
    height = round(float(min(TO_GEO.transform(*positions.T)[2])), 4)
    origin = np.asarray(TO_ECEF.transform(lon, lat, height))
    binary = bytearray()
    doc = dict(asset={'version':'2.0', 'copyright':'Project PLATEAU / Kyoto City 2025, CC BY 4.0'},
               scene=0, scenes=[{'nodes':[0]}], nodes=[{'mesh':0}], meshes=[{'primitives':[]}],
               materials=src['materials'], samplers=src['samplers'], textures=[{'source':0, 'sampler':0}],
               bufferViews=[], accessors=[], extras={'gmlId':gml_id, 'lod':actual_lod, 'source':BASE+prefix+SURVEY+tail})

    def view(raw):
        binary.extend(bytes(-len(binary) % 4))
        doc['bufferViews'].append({'buffer':0, 'byteOffset':len(binary), 'byteLength':len(raw)})
        binary.extend(raw)
        return len(doc['bufferViews']) - 1

    def accessor(array, kind, position=False):
        numeric = array.astype('<u4' if kind == 'SCALAR' else '<f4')
        assert np.isfinite(numeric).all()
        fields = dict(bufferView=view(numeric.tobytes()), componentType=5125 if kind == 'SCALAR' else 5126,
                      type=kind, count=len(numeric))
        if position:
            fields.update(min=numeric.min(axis=0).tolist(), max=numeric.max(axis=0).tolist())
        doc['accessors'].append(fields)
        return len(doc['accessors']) - 1

    projected = []
    for xyz, norm, uv, faces, material in meshes:
        local = (xyz - origin) @ axes
        attrs = {'POSITION':accessor(local, 'VEC3', True), 'NORMAL':accessor(norm, 'VEC3')}
        projected.extend(shapely.polygons(local[faces][:, :, [0, 2]]))
        if uv is not None:
            assert not doc.get('images') and len(src['images']) == len(src['textures']) == 1
            image = Image.open(BytesIO(read_view(src['images'][0]['bufferView'])))
            remapped, png = photo_atlas(image, uv, faces)
            doc['images'] = [{'bufferView':view(png), 'mimeType':'image/png'}]
            attrs['TEXCOORD_0'] = accessor(remapped, 'VEC2')
        doc['meshes'][0]['primitives'].append(dict(attributes=attrs, indices=accessor(faces.ravel(), 'SCALAR'), material=material))
    # The exterior masks replace the same surveyed feature, including its original shell.
    footprint = shapely.union_all([p for p in projected if p.area > .005], grid_size=.1).simplify(.15)
    rings = []
    for polygon in shapely.get_parts(footprint):
        if polygon.geom_type != 'Polygon' or polygon.area < 1:
            continue
        ring = np.asarray(polygon.exterior.coords[:-1])
        world = np.column_stack((ring[:,0], np.zeros(len(ring)), ring[:,1])) @ axes.T + origin
        rings.append(np.asarray(TO_GEO.transform(*world.T)[:2]).T.round(8).tolist())
    assert rings
    binary.extend(bytes(-len(binary) % 4))
    doc['buffers'] = [{'byteLength':len(binary)}]
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    header = struct.pack('<4sIIII', b'glTF', 2, 28 + len(text) + len(binary), len(text), 0x4e4f534a)
    glb = header + text + struct.pack('<I4s', len(binary), b'BIN\0') + binary
    record = dict(id=name, pref='26', lon=lon, lat=lat, ellipsoidHeight=height,
                  file='/kansai/landmarks/' + name + '.glb', rings=rings)
    print(name, 'LOD', actual_lod, 'triangles', sum(len(m[3]) for m in meshes),
          'extents (east/up/south, m)', np.ptp((positions-origin) @ axes, axis=0).round(1),
          'size', len(glb))
    return record, glb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    args = parser.parse_args()
    products = []
    for site in SITES:
        with urlopen(BASE + site[4] + SURVEY + site[5], timeout=60) as response:
            payload = response.read()
        if sha256(payload).hexdigest() != site[6]:
            raise ValueError('PLATEAU tile changed: ' + site[0])
        products.append(extract(site, payload))
    args.output.mkdir(parents=True, exist_ok=True)
    for record, glb in products:
        (args.output / (record['id'] + '.glb')).write_bytes(glb)
    (args.output / 'surveyed-sites.json').write_text(
        json.dumps([r for r, _ in products], separators=(',', ':')) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
