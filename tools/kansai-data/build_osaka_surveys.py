"""Extract textured Osaka districts from PLATEAU Osaka 2025 (DracoPy, NumPy, Pillow, pyproj, Shapely 2).

Each site gathers every LOD2/LOD3 building whose footprint centre lies inside its outline
from the finest (geometric error 0) tiles of a ward's 3D Tiles survey, and writes one GLB in
the viewer's east/up/south frame. Only the photograph texels the selected faces sample are
kept, packed per source tile and encoded as WebP. LOD1 extrusions are left to the regional
city layer. Geometry, material parameters and image texels are from PLATEAU.
Source terms: https://www.mlit.go.jp/plateau/site-policy/

    python tools/kansai-data/build_osaka_surveys.py [--cache DIR] [--only ID]
"""
import argparse
from hashlib import sha256
import json
import math
import struct
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen

import DracoPy
import numpy as np
from PIL import Image
from pyproj import Transformer
import shapely

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/kansai/landmarks'
CATALOGUE = 'osaka-surveys.json'
ASSETS = 'https://assets.cms.plateau.reearth.io/assets/'
SURVEY = '27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_'
WARDS = {
    'kita-lod3': 'cf/c419c0-bee1-4810-b9ae-529bafd07124/' + SURVEY + '27127_kita-ku_lod3/tileset.json',
    'kita-lod2': '92/1459fa-4102-4cfe-a56f-6fe5c7764178/' + SURVEY + '27127_kita-ku_lod2/tileset.json',
}
# Outlines are [west, south, east, north] in degrees; ids describe the district, not a single building.
# USJ (Konohana), Tsutenkaku (Naniwa) and Abeno Harukas (Abeno) are LOD1 extrusions only in
# the 2025 survey, so those landmarks remain hand-modelled in the viewer.
SITES = [
    # 梅田スカイビル・新梅田シティ (OSM way 25426946 for the identity check).
    dict(id='umeda-sky-district', ward='kita-lod3', box=[135.4884, 34.7038, 135.4916, 34.7064]),
    # JR大阪駅・大阪ステーションシティ・グランフロント大阪・阪急/阪神梅田・HEP FIVE・KITTE大阪・ヨドバシ梅田.
    dict(id='osaka-station-district', ward='kita-lod2', box=[135.4925, 34.6986, 135.5012, 34.7072], atlas=2048),
]
MAX_ATLAS = 4096
WEBP_QUALITY = 84
TO_ECEF = Transformer.from_crs(4979, 4978, always_xy=True)
TO_GEO = Transformer.from_crs(4978, 4979, always_xy=True)


def fetch(url, cache):
    name = cache / url.replace('https://', '').replace('/', '_') if cache else None
    if name and name.exists():
        return name.read_bytes()
    with urlopen(url, timeout=180) as response:
        payload = response.read()
    if name:
        name.write_bytes(payload)
    return payload


def leaf_tiles(tileset_url, box, cache):
    tileset = json.loads(fetch(tileset_url, cache))
    west, south, east, north = np.radians(box)
    found = []

    def walk(node):
        region = node['boundingVolume'].get('region')
        if region and (region[2] < west or region[0] > east or region[3] < south or region[1] > north):
            return
        content = node.get('content')
        if content and not node.get('children') and node.get('geometricError', 1) == 0:
            found.append(urljoin(tileset_url, content.get('uri') or content['url']))
        for child in node.get('children', []):
            walk(child)

    walk(tileset['root'])
    return found


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


def feature_lods(batch, batch_binary):
    lod = batch['_lod']
    if isinstance(lod, dict):
        assert lod['componentType'] in ('BYTE', 'UNSIGNED_BYTE') and lod['type'] == 'SCALAR'
        start = lod.get('byteOffset', 0)
        return np.frombuffer(batch_binary, np.uint8, len(batch['gml_id']), start)
    return np.asarray(lod)


def photo_atlas(source, uv, faces, limit=MAX_ATLAS):
    # Keep only the texels this selection samples, with an eight-texel border per chart.
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
    atlas = Image.new('RGB', (width, y + row_height))
    mapped = np.full_like(pixels, np.nan)
    rgb = source.convert('RGB')
    for chart, (w, s, e, n), (x, y) in zip(charts, bounds, packed):
        mapped_here = shapely.intersects_xy(chart, pixels[:, 0], pixels[:, 1])
        mapped[mapped_here] = pixels[mapped_here] + [x - w, y - s]
        atlas.paste(rgb.crop((w, s, e, n)), (x, y))
    assert np.isfinite(mapped).all()
    scale = min(1, limit / max(atlas.size))
    if scale < 1:
        atlas = atlas.resize((max(1, round(atlas.width * scale)), max(1, round(atlas.height * scale))),
                             Image.Resampling.LANCZOS)
        mapped = mapped * scale
    encoded = BytesIO()
    atlas.save(encoded, format='WEBP', quality=WEBP_QUALITY, method=6)
    return mapped / atlas.size, encoded.getvalue(), atlas.size


def extract(site, cache):
    tileset = ASSETS + WARDS[site['ward']]
    west, south, east, north = site['box']
    outline = shapely.box(west, south, east, north)
    lon0, lat0 = (west + east) / 2, (south + north) / 2
    longitude, latitude = np.radians([lon0, lat0])
    east_axis = [-np.sin(longitude), np.cos(longitude), 0]
    up_axis = [np.cos(latitude) * np.cos(longitude), np.cos(latitude) * np.sin(longitude), np.sin(latitude)]
    axes = np.array([east_axis, up_axis, np.cross(east_axis, up_axis)]).T   # glTF east, up, south
    parts, sources = [], []
    for url in leaf_tiles(tileset, site['box'], cache):
        batch, batch_binary, src, read_view = unpack_tile(fetch(url, cache))
        lods = feature_lods(batch, batch_binary)
        rtc = np.asarray(src.get('extensions', {}).get('CESIUM_RTC', {}).get('center', [0, 0, 0]))
        decoded = []
        for primitive in src['meshes'][0]['primitives']:
            draco = primitive['extensions']['KHR_draco_mesh_compression']
            mesh = DracoPy.decode(read_view(draco['bufferView']))

            def attr(key, mesh=mesh, draco=draco):
                return mesh.get_attribute_by_unique_id(draco['attributes'][key])['data']

            ecef = attr('POSITION')[:, [0, 2, 1]] * [1, -1, 1] + rtc
            decoded.append((primitive, mesh, attr, ecef, attr('_BATCHID').ravel()))
        # A feature belongs to the site by the centre of its whole surface, in any primitive.
        totals = {}
        for _, mesh, _, ecef, ids in decoded:
            for feature in np.unique(ids):
                points = ecef[ids == feature]
                total = totals.setdefault(int(feature), [np.zeros(3), 0])
                total[0] += points.sum(axis=0)
                total[1] += len(points)
        chosen = set()
        for feature, (summed, count) in totals.items():
            lon, lat, _ = TO_GEO.transform(*(summed / count))
            if lods[feature] >= 2 and outline.contains(shapely.Point(lon, lat)):
                chosen.add(feature)
        if not chosen:
            continue
        image = None
        if src.get('images'):
            assert len(src['images']) == 1
            image = Image.open(BytesIO(read_view(src['images'][0]['bufferView'])))
        for primitive, mesh, attr, ecef, ids in decoded:
            mask = np.isin(ids[mesh.faces], list(chosen)).all(axis=1)
            faces = mesh.faces[mask]
            if not len(faces):
                continue
            vertices, local = np.unique(faces, return_inverse=True)
            local = local.reshape(-1, 3)
            draco = primitive['extensions']['KHR_draco_mesh_compression']
            uv = attr('TEXCOORD_0')[vertices] if 'TEXCOORD_0' in draco['attributes'] and image else None
            normal = (attr('NORMAL')[vertices][:, [0, 2, 1]] * [1, -1, 1]) @ axes
            material = src['materials'][primitive['material']] if 'material' in primitive else {}
            seeds = np.array([int(sha256(batch['gml_id'][f].encode()).hexdigest()[:8], 16) / 2 ** 32
                              for f in ids[vertices]], dtype=np.float32)
            parts.append(dict(ecef=ecef[vertices], normal=normal, uv=uv, faces=local, image=image,
                              material=material, ids=ids[vertices], seeds=seeds, tile=len(sources)))
        sources.append(dict(url=url, features=[batch['gml_id'][f] for f in sorted(chosen)]))
    if not parts:
        raise ValueError('No textured buildings inside ' + site['id'])
    positions = np.concatenate([p['ecef'] for p in parts])
    height = round(float(TO_GEO.transform(*positions.T)[2].min()), 4)
    origin = np.asarray(TO_ECEF.transform(lon0, lat0, height))
    return write_glb(site, parts, sources, axes, origin, lon0, lat0, height)


def write_glb(site, parts, sources, axes, origin, lon0, lat0, height):
    binary = bytearray()
    doc = dict(asset={'version': '2.0', 'copyright': 'Project PLATEAU / Osaka City 2025, CC BY 4.0'},
               extensionsUsed=['EXT_texture_webp'], extensionsRequired=['EXT_texture_webp'],
               scene=0, scenes=[{'nodes': [0]}], nodes=[{'mesh': 0}], meshes=[{'primitives': []}],
               materials=[], samplers=[{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
               textures=[], images=[], bufferViews=[], accessors=[],
               extras={'sources': sources})

    def view(raw):
        binary.extend(bytes(-len(binary) % 4))
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw)})
        binary.extend(raw)
        return len(doc['bufferViews']) - 1

    def accessor(array, kind, position=False):
        numeric = array.astype('<u4' if kind == 'SCALAR' else '<f4')
        kind = 'SCALAR' if kind == 'SCALAR_F' else kind
        assert np.isfinite(numeric).all()
        fields = dict(bufferView=view(numeric.tobytes()), componentType=5125 if numeric.dtype == np.dtype('<u4') else 5126,
                      type=kind, count=len(numeric))
        if position:
            fields.update(min=numeric.min(axis=0).tolist(), max=numeric.max(axis=0).tolist())
        doc['accessors'].append(fields)
        return len(doc['accessors']) - 1

    footprints = {}
    triangles = texels = 0
    for part in parts:
        local = (part['ecef'] - origin) @ axes
        # A stable per-building value lets the viewer vary untextured facades building by building.
        attrs = {'POSITION': accessor(local, 'VEC3', True), 'NORMAL': accessor(part['normal'], 'VEC3'),
                 '_FEATURE': accessor(part['seeds'], 'SCALAR_F')}
        material = {k: v for k, v in part['material'].items() if k in ('pbrMetallicRoughness', 'doubleSided', 'name')}
        pbr = dict(material.get('pbrMetallicRoughness', {}))
        pbr.pop('baseColorTexture', None)
        if part['uv'] is not None:
            remapped, webp, size = photo_atlas(part['image'], part['uv'], part['faces'], site.get('atlas', MAX_ATLAS))
            doc['images'].append({'bufferView': view(webp), 'mimeType': 'image/webp'})
            doc['textures'].append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(doc['images']) - 1}}})
            pbr['baseColorTexture'] = {'index': len(doc['textures']) - 1}
            attrs['TEXCOORD_0'] = accessor(remapped, 'VEC2')
            texels += size[0] * size[1]
        pbr.setdefault('metallicFactor', 0)
        pbr.setdefault('roughnessFactor', .85)
        doc['materials'].append({**material, 'pbrMetallicRoughness': pbr})
        doc['meshes'][0]['primitives'].append(dict(attributes=attrs, indices=accessor(part['faces'].ravel(), 'SCALAR'),
                                                   material=len(doc['materials']) - 1))
        triangles += len(part['faces'])
        flat = local[part['faces']][:, :, [0, 2]]
        owners = part['ids'][part['faces'][:, 0]]
        for owner in np.unique(owners):
            footprints.setdefault((part['tile'], int(owner)), []).extend(shapely.polygons(flat[owners == owner]))
    rings = []
    for polygons in footprints.values():
        shape = shapely.union_all([p for p in polygons if p.area > .005], grid_size=.1).simplify(.3)
        for polygon in shapely.get_parts(shape):
            if polygon.geom_type != 'Polygon' or polygon.area < 4:
                continue
            ring = np.asarray(polygon.exterior.coords[:-1])
            world = np.column_stack((ring[:, 0], np.zeros(len(ring)), ring[:, 1])) @ axes.T + origin
            rings.append(np.asarray(TO_GEO.transform(*world.T)[:2]).T.round(8).tolist())
    binary.extend(bytes(-len(binary) % 4))
    doc['buffers'] = [{'byteLength': len(binary)}]
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    header = struct.pack('<4sIIII', b'glTF', 2, 28 + len(text) + len(binary), len(text), 0x4e4f534a)
    glb = header + text + struct.pack('<I4s', len(binary), b'BIN\0') + binary
    record = dict(id=site['id'], pref='27', lon=round(lon0, 7), lat=round(lat0, 7), ellipsoidHeight=height,
                  file='/kansai/landmarks/' + site['id'] + '.glb', rings=rings)
    print(site['id'], 'buildings', sum(len(s['features']) for s in sources), 'tiles', len(sources),
          'triangles', triangles, 'texels', texels, 'rings', len(rings), 'size', len(glb))
    return record, glb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--only')
    args = parser.parse_args()
    if args.cache:
        args.cache.mkdir(parents=True, exist_ok=True)
    catalogue_path = args.output / CATALOGUE
    records = {r['id']: r for r in json.loads(catalogue_path.read_text(encoding='utf-8'))} if catalogue_path.exists() else {}
    for site in SITES:
        if args.only and site['id'] != args.only:
            continue
        record, glb = extract(site, args.cache)
        (args.output / (site['id'] + '.glb')).write_bytes(glb)
        records[site['id']] = record
    ordered = [records[s['id']] for s in SITES if s['id'] in records]
    catalogue_path.write_text(json.dumps(ordered, separators=(',', ':')) + '\n', encoding='utf-8')
    # Keep the shipped manifest in step without rebuilding every hand-modelled landmark.
    index_path = args.output / 'index.json'
    index = [r for r in json.loads(index_path.read_text(encoding='utf-8')) if r['id'] not in records]
    index_path.write_text(json.dumps(index + ordered, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
