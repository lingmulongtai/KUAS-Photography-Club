"""
The area the top-page scene covers, and the projection shared with the browser code.

Local metres on a plane tangent at Shijo-Karasuma: +x east, +z south, +y up (elevation above sea level).
Over the ~30 km the scene spans, an equirectangular projection is accurate to well under a metre.
"""
import math

ORIGIN = (35.0036, 135.7595)  # lat, lon of 四条烏丸

_A = 6378137.0
_E2 = 0.00669437999014
_phi = math.radians(ORIGIN[0])
_w = math.sqrt(1 - _E2 * math.sin(_phi) ** 2)
M_PER_DEG_LON = math.pi / 180 * _A * math.cos(_phi) / _w
M_PER_DEG_LAT = math.pi / 180 * _A * (1 - _E2) / _w ** 3


def to_local(lat, lon):
    """(lat, lon) degrees -> (x, z) metres."""
    return (lon - ORIGIN[1]) * M_PER_DEG_LON, -(lat - ORIGIN[0]) * M_PER_DEG_LAT


def to_geo(x, z):
    """(x, z) metres -> (lat, lon) degrees."""
    return ORIGIN[0] - z / M_PER_DEG_LAT, ORIGIN[1] + x / M_PER_DEG_LON


# (minX, minZ, maxX, maxZ) in metres
TERRAIN = (-21000, -13000, 9000, 14000)     # 30 x 27 km: Atago and Nishiyama to Hiei and Otokoyama
TERRAIN_STEP = 30                            # metres per DEM sample
NEAR = (500, -4500, 5000, 4000)              # Higashiyama around the viewpoint
NEAR_STEP = 10
AERIAL_DETAIL = (-5600, -4600, 4400, 4400)   # the basin core seen up close
BUILDINGS = (-9000, -7000, 4600, 6200)       # Arashiyama to Higashiyama, Kitayama foothills to Kujo
LINES = BUILDINGS                            # roads, railways and water

# Places the scene needs to know about, with verified coordinates
PLACES = {
    'shogunzuka': (35.0022428, 135.7874304),  # 将軍塚青龍殿 大舞台, the viewpoint
    'kuas': (35.0099245, 135.7184382),        # 京都先端科学大学 太秦キャンパス
}


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_lat_lon(x, y, z):
    n = 2 ** z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def tiles_for(box, z, pad=0):
    """XYZ tiles covering a local-metre box."""
    minx, minz, maxx, maxz = box
    lat0, lon0 = to_geo(minx, maxz)  # south-west
    lat1, lon1 = to_geo(maxx, minz)  # north-east
    x0, y1 = tile_xy(lat0, lon0, z)
    x1, y0 = tile_xy(lat1, lon1, z)
    return [(z, x, y) for x in range(int(x0) - pad, int(x1) + 1 + pad) for y in range(int(y0) - pad, int(y1) + 1 + pad)]
