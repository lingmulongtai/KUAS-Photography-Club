"""Decode PLATEAU LOD1 b3dm tiles: per-building footprints (lon/lat rings) and attributes."""
import json, struct
import numpy as np
import DracoPy

A = 6378137.0
F = 1 / 298.257223563
E2 = F * (2 - F)

def ecef_to_geo(x, y, z):
    lon = np.arctan2(y, x)
    p = np.hypot(x, y)
    lat = np.arctan2(z, p * (1 - E2))
    for _ in range(5):
        n = A / np.sqrt(1 - E2 * np.sin(lat) ** 2)
        h = p / np.cos(lat) - n
        lat = np.arctan2(z, p * (1 - E2 * n / (n + h)))
    n = A / np.sqrt(1 - E2 * np.sin(lat) ** 2)
    h = p / np.cos(lat) - n
    return np.degrees(lon), np.degrees(lat), h

def batch_values(bt, btb, key, n):
    v = bt.get(key)
    if v is None:
        return [None] * n
    if isinstance(v, list):
        return v
    fmt = {'DOUBLE': 'd', 'FLOAT': 'f', 'SHORT': 'h', 'UNSIGNED_SHORT': 'H', 'BYTE': 'b', 'UNSIGNED_BYTE': 'B', 'INT': 'i', 'UNSIGNED_INT': 'I'}[v['componentType']]
    size = struct.calcsize(fmt)
    off = v['byteOffset']
    return list(struct.unpack_from('<' + fmt * n, btb, off))

def decode(b):
    magic, ver, blen, ftj, ftb, btj, btb_len = struct.unpack('<4sIIIIII', b[:28])
    p = 28
    ft = json.loads(b[p:p + ftj]); p += ftj + ftb
    n = ft['BATCH_LENGTH']
    bt = json.loads(b[p:p + btj]) if btj else {}
    btb = b[p + btj:p + btj + btb_len]
    p += btj + btb_len
    glb = b[p:]
    L = struct.unpack('<I', glb[12:16])[0]
    j = json.loads(glb[20:20 + L])
    bin_off = 20 + L + 8
    binchunk = glb[bin_off:]
    rtc = np.array(j.get('extensions', {}).get('CESIUM_RTC', {}).get('center', [0, 0, 0]))
    prim = j['meshes'][0]['primitives'][0]
    dr = prim['extensions']['KHR_draco_mesh_compression']
    bv = j['bufferViews'][dr['bufferView']]
    data = binchunk[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    mesh = DracoPy.decode(data)
    pts = np.array(mesh.points, dtype=np.float64).reshape(-1, 3)
    faces = np.array(mesh.faces, dtype=np.int64).reshape(-1, 3)
    # draco generic attribute for _BATCHID
    bid = None
    for att in mesh.attributes:
        if att.get('unique_id') == dr['attributes']['_BATCHID']:
            bid = np.array(att['data']).reshape(-1).astype(np.int64)
    # node transform (if any)
    node = j['nodes'][0]
    if 'matrix' in node:
        M = np.array(node['matrix']).reshape(4, 4).T
        pts = (np.c_[pts, np.ones(len(pts))] @ M.T)[:, :3]
    # glTF y-up -> 3D Tiles z-up
    ecef = np.c_[pts[:, 0], -pts[:, 2], pts[:, 1]] + rtc
    lon, lat, h = ecef_to_geo(ecef[:, 0], ecef[:, 1], ecef[:, 2])
    attrs = {}
    for key in ('gml:name', 'bldg:class', 'bldg:usage', 'bldg:measuredHeight', 'bldg:storeysAboveGround', 'uro:BuildingIDAttribute_uro:buildingID', '_zmin', '_zmax', '_xmin', '_xmax', '_ymin', '_ymax'):
        attrs[key] = batch_values(bt, btb, key, n)
    return {'n': n, 'lon': lon, 'lat': lat, 'h': h, 'faces': faces, 'bid': bid, 'attrs': attrs}
