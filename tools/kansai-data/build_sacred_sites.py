"""Extract Japanese shrines, temples, pagodas, sacred gates and torii across Kansai.

Reads the checksum-pinned Geofabrik Kansai OSM PBF (same source as build_attributes.py)
and matches unmapped GSI BldA footprints inside mapped temple/shrine precincts or at
place_of_worship nodes so rural and urban shrines/temples across all five prefectures
(Shiga 25, Kyoto 26, Osaka 27, Hyogo 28, Nara 29) receive dedicated sacred models.

Output per z12 tile in public/kansai/sacred/{x}-{y}.json.gz:
  [[u16, v16, w_dm, d_dm, angle_byte, h_dm, kind], ...]
where u16/v16 are 0..65535 inside the z12 tile, w_dm/d_dm/h_dm are decimetres,
angle_byte is floor((angle % pi) / pi * 256) in the Kyoto local x/z frame (+x east, +z south),
and kind matches SACRED in src/scripts/kansai/sacred-models.ts:
  0=temple, 1=shrine, 2=shrineVermilion, 3=pagoda, 4=gate, 5=torii, 6=toriiStone.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import tempfile

from mapbox_vector_tile.Mapbox import vector_tile_pb2
import osmium
import shapely
from shapely import STRtree
from shapely.geometry import Point as ShPoint, Polygon, shape

DATA = Path(__file__).resolve().parents[2] / "public" / "kansai"
NAME = "kansai-261101.osm.pbf"
SOURCE = "https://download.geofabrik.de/asia/japan/kansai/" + NAME
MD5 = "bb72623497eab32a0ee898a49a189b46"
PREFECTURES = {"25", "26", "27", "28", "29"}

TEMPLE = 0
SHRINE = 1
SHRINE_VERMILION = 2
PAGODA = 3
GATE = 4
TORII = 5
TORII_STONE = 6

EXCLUDED_RELIGIONS = {"christian", "muslim", "jewish", "sikh", "hindu", "bahai", "taoist", "scientologist"}
MODERN_BUILDINGS = {
    "apartments", "office", "commercial", "retail", "supermarket", "hotel", "motel",
    "industrial", "warehouse", "factory", "school", "university", "college", "kindergarten",
    "hospital", "clinic", "parking", "garage", "garages", "toilets", "shed", "greenhouse",
    "house", "detached", "residential", "terrace", "semidetached_house", "train_station",
    "station", "service", "transformer_tower", "civic", "public", "government", "stadium",
    "church", "cathedral", "chapel", "mosque", "synagogue", "kingdom_hall",
}
SACRED_BUILDING_VALUES = {"temple", "shrine", "pagoda", "religious", "monastery"}

SHINTO_RE = re.compile(r"神社|神宮|大社|天満宮|八幡宮|八幡社|稲荷|権現|天神|明神|大神|御霊|恵比須|住吉|熊野|春日|日吉|賀茂|愛宕|祇園|貴船|生田|長田|湊川|多賀|厳島|浅間|氷川|諏訪|白山|社$")
BUDDHIST_RE = re.compile(r"寺|院|堂|庵|大師|観音|不動|地蔵|薬師|阿弥陀|釈迦|大仏|禅|坊|舎利|塔|山門|仁王門|本堂|講堂|金堂|経蔵|鐘楼|庫裏|方丈")
VERMILION_RE = re.compile(r"稲荷|大社|神宮|八幡|天満宮|生田|長田|湊川|住吉|春日|日吉|賀茂|祇園|八坂|貴船|平安|厳島|熊野|多賀|恵比須")
GATE_RE = re.compile(r"山門|楼門|仁王門|総門|唐門|南大門|中門|勅使門|三門|黒門|赤門|随身門|神門|表門|大門|東大門|西大門|北門|南門")
PAGODA_RE = re.compile(r"五重塔|三重塔|多宝塔|宝塔|塔$")

METRES_PER_DEG_LAT = 110940.6404266756


def parse_height(tags):
    raw = tags.get("height")
    if raw:
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)?\s*$", raw.strip().lower())
        if m:
            v = float(m.group(1))
            if 1.5 <= v <= 90:
                return v
    lvl = tags.get("building:levels")
    if lvl:
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*$", lvl.strip())
        if m:
            v = float(m.group(1))
            if 1 <= v <= 10:
                return v * 3.6 + 1.8
    return None


def tradition_of(tags):
    rel = tags.get("religion", "").strip().lower()
    if rel in EXCLUDED_RELIGIONS:
        return None
    if rel == "shinto":
        return "shinto"
    if rel == "buddhist":
        return "buddhist"
    b = tags.get("building", "").strip().lower()
    h = tags.get("historic", "").strip().lower()
    if b == "shrine" or h == "shrine":
        return "shinto"
    if b in {"temple", "pagoda", "monastery"} or h in {"temple", "pagoda"}:
        return "buddhist"
    name = tags.get("name", "") or tags.get("name:ja", "")
    if name:
        if SHINTO_RE.search(name):
            return "shinto"
        if BUDDHIST_RE.search(name):
            return "buddhist"
    return None


def is_vermilion(tags, area, lon, lat):
    col = (tags.get("colour", "") + " " + tags.get("building:colour", "")).lower()
    if any(c in col for c in ("red", "vermilion", "orange", "#c", "#d", "#e", "#b")):
        return True
    name = tags.get("name", "") or tags.get("name:ja", "")
    if name and VERMILION_RE.search(name):
        return True
    if area >= 150:
        h = (int(round(lon * 1e5)) * 2654435761 ^ int(round(lat * 1e5)) * 2246822519) & 0xFFFFFFFF
        return (h / 4294967296.0) < 0.45
    return False


def classify_kind(tags, trad, area, w, d, height, lon, lat):
    b = tags.get("building", "").strip().lower()
    h = tags.get("historic", "").strip().lower()
    name = tags.get("name", "") or tags.get("name:ja", "")
    aspect = max(w, d) / max(0.1, min(w, d))
    if (b == "pagoda" or h == "pagoda" or tags.get("tower:type") == "pagoda"
            or (name and PAGODA_RE.search(name) and aspect < 1.5 and area < 500)
            or (height is not None and height >= 19 and aspect < 1.3 and area < 350)):
        return PAGODA
    if b == "gate" or h == "city_gate" or (name and GATE_RE.search(name)):
        return GATE
    if trad == "shinto":
        return SHRINE_VERMILION if is_vermilion(tags, area, lon, lat) else SHRINE
    return TEMPLE


def default_height(kind, area, tags):
    name = tags.get("name", "") or tags.get("name:ja", "")
    if kind == PAGODA:
        if "五重" in name:
            return 34.0
        if "三重" in name:
            return 21.0
        return 20.0
    if kind == GATE:
        return min(16.0, max(5.8, 4.8 + math.sqrt(area) * 0.45))
    if kind in (SHRINE, SHRINE_VERMILION):
        return min(15.5, max(4.8, 4.2 + math.sqrt(area) * 0.36))
    return min(22.0, max(5.6, 5.0 + math.sqrt(area) * 0.42))


def tile_xy(lon, lat, zoom=12):
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y


def lon_lat(tx, ty, zoom=12):
    n = 2 ** zoom
    lon = tx / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * ty / n))))
    return lon, lat


def fit_box_from_ring(ring_lonlat):
    """Fit a principal-axis rectangle matching cityFootprint's Kyoto x/z angle convention."""
    if len(ring_lonlat) < 3:
        return None
    lat0 = sum(p[1] for p in ring_lonlat) / len(ring_lonlat)
    lon0 = sum(p[0] for p in ring_lonlat) / len(ring_lonlat)
    mx = 40075016.7 * math.cos(math.radians(lat0)) / 360.0
    # Kyoto local tangent frame: +x east, +z south
    pts = [((lon - lon0) * mx, -(lat - lat0) * METRES_PER_DEG_LAT) for lon, lat in ring_lonlat]
    area2 = 0.0
    longest = 0.0
    angle = 0.0
    n = len(pts)
    for i in range(n):
        ax, az = pts[i]
        bx, bz = pts[(i + 1) % n]
        area2 += ax * bz - bx * az
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz
        if l2 > longest:
            longest = l2
            angle = math.atan2(dz, dx)
    area = abs(area2) * 0.5
    if area < 9.0 or longest < 1.0:
        return None
    c, s = math.cos(angle), math.sin(angle)
    us = [x * c + z * s for x, z in pts]
    vs = [-x * s + z * c for x, z in pts]
    left, right = min(us), max(us)
    back, front = min(vs), max(vs)
    w = right - left
    d = front - back
    if w < 2.2 or d < 2.0 or w > 95 or d > 95:
        return None
    u_mid = (left + right) * 0.5
    v_mid = (back + front) * 0.5
    if d > w:
        w, d = d, w
        angle += math.pi * 0.5
    cx = c * u_mid - s * v_mid
    cz = s * u_mid + c * v_mid
    clon = lon0 + cx / mx
    clat = lat0 - cz / METRES_PER_DEG_LAT
    angle = angle % math.pi
    return clon, clat, w, d, angle, area


def decode_mvt_rings(geometry_ints, extent):
    """Minimal MVT polygon command decoder for GSI BldA rings."""
    rings = []
    ring = []
    x = y = 0
    i = 0
    n = len(geometry_ints)
    while i < n:
        cmd_int = geometry_ints[i]
        i += 1
        cmd = cmd_int & 7
        count = cmd_int >> 3
        if cmd == 1:  # MoveTo
            for _ in range(count):
                dx, dy = geometry_ints[i], geometry_ints[i + 1]
                i += 2
                x += (dx >> 1) ^ -(dx & 1)
                y += (dy >> 1) ^ -(dy & 1)
                ring = [(x / extent, y / extent)]
        elif cmd == 2:  # LineTo
            for _ in range(count):
                dx, dy = geometry_ints[i], geometry_ints[i + 1]
                i += 2
                x += (dx >> 1) ^ -(dx & 1)
                y += (dy >> 1) ^ -(dy & 1)
                ring.append((x / extent, y / extent))
        elif cmd == 7:  # ClosePath
            if len(ring) >= 3:
                rings.append(ring)
            ring = []
    return rings


def region_boundaries():
    features = json.loads((DATA / "prefectures.json").read_text(encoding="utf-8"))["features"]
    values = {f["properties"]["code"]: shape(f["geometry"]) for f in features}
    if set(values) != PREFECTURES:
        raise ValueError("Expected the five Kansai prefecture boundaries")
    union = shapely.union_all(list(values.values()))
    shapely.prepare(union)
    for b in values.values():
        shapely.prepare(b)
    return values, union


def extract(source: Path, output: Path):
    with source.open("rb") as stream:
        if hashlib.file_digest(stream, "md5").hexdigest() != MD5:
            raise ValueError("Geofabrik source MD5 mismatch")

    pref_bounds, kansai_union = region_boundaries()
    factory = osmium.geom.WKBFactory()

    # Stage 1: Collect sacred precincts, direct sacred buildings, torii, and place_of_worship POI nodes.
    direct_records = []  # (priority, lon, lat, w, d, angle, h, kind, source_type)
    precincts = []       # (geom, trad, name, tags_dict)
    poi_nodes = []       # (lon, lat, trad, name, tags_dict)
    torii_ways_ids = set()

    print("Pass 1: scanning nodes and ways for torii & place_of_worship POIs...", flush=True)
    # Nodes with torii or place_of_worship
    node_proc = osmium.FileProcessor(str(source)).with_filter(osmium.filter.EntityFilter(osmium.osm.NODE)).with_filter(
        osmium.filter.KeyFilter("man_made", "historic", "barrier", "amenity")
    )
    for n in node_proc:
        t = n.tags
        if not n.location.valid():
            continue
        lon, lat = n.location.lon, n.location.lat
        if not shapely.contains_xy(kansai_union, lon, lat):
            continue
        if t.get("man_made") == "torii" or t.get("historic") == "torii" or t.get("barrier") == "torii":
            mat = (t.get("material", "") + " " + t.get("colour", "")).lower()
            stone = any(k in mat for k in ("stone", "granite", "concrete", "grey", "gray", "white"))
            h = parse_height(t) or 5.2
            w = min(22.0, max(3.4, h * 1.05))
            direct_records.append((4, lon, lat, w, 1.2, 0.0, h, TORII_STONE if stone else TORII, "osm-torii-node"))
        elif t.get("amenity") == "place_of_worship":
            trad = tradition_of(t)
            if trad:
                poi_nodes.append((lon, lat, trad, t.get("name", ""), dict(t)))

    # Linear torii ways (two-point or multi-point span giving exact orientation and width)
    way_proc = osmium.FileProcessor(str(source)).with_locations().with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)).with_filter(
        osmium.filter.KeyFilter("man_made", "historic")
    )
    for w_ent in way_proc:
        t = w_ent.tags
        if t.get("man_made") != "torii" and t.get("historic") != "torii":
            continue
        if w_ent.is_closed() and len(w_ent.nodes) >= 4:
            continue  # handled in area pass
        coords = [(nd.lon, nd.lat) for nd in w_ent.nodes if nd.location.valid()]
        if len(coords) < 2:
            continue
        lon = (coords[0][0] + coords[-1][0]) * 0.5
        lat = (coords[0][1] + coords[-1][1]) * 0.5
        if not shapely.contains_xy(kansai_union, lon, lat):
            continue
        mx = 40075016.7 * math.cos(math.radians(lat)) / 360.0
        dx = (coords[-1][0] - coords[0][0]) * mx
        dz = -(coords[-1][1] - coords[0][1]) * METRES_PER_DEG_LAT
        span = math.hypot(dx, dz)
        if span < 1.8 or span > 35:
            span = 5.5
        angle = math.atan2(dz, dx) % math.pi
        mat = (t.get("material", "") + " " + t.get("colour", "")).lower()
        stone = any(k in mat for k in ("stone", "granite", "concrete", "grey", "gray", "white"))
        h = parse_height(t) or min(22.0, max(3.5, span * 0.92))
        direct_records.append((5, lon, lat, span, 1.4, angle, h, TORII_STONE if stone else TORII, "osm-torii-way"))
        torii_ways_ids.add(w_ent.id)

    print(f"Found {len(direct_records)} torii and {len(poi_nodes)} place_of_worship POI nodes", flush=True)

    print("Pass 2: scanning OSM areas for sacred buildings and temple/shrine precincts...", flush=True)
    area_proc = osmium.FileProcessor(str(source)).with_areas().with_filter(osmium.filter.EntityFilter(osmium.osm.AREA)).with_filter(
        osmium.filter.KeyFilter("amenity", "landuse", "historic", "man_made", "religion", "building")
    )
    for area in area_proc:
        t = area.tags
        b = t.get("building", "").strip().lower()
        if b in {"no", "0", "false"}:
            b = ""
        is_torii_area = t.get("man_made") == "torii" or t.get("historic") == "torii"
        is_pow = t.get("amenity") == "place_of_worship"
        is_rel_land = t.get("landuse") == "religious"
        is_sacred_b = bool(b) and (
            b in SACRED_BUILDING_VALUES
            or is_pow
            or t.get("historic") in {"temple", "shrine", "pagoda"}
            or (b == "gate" and tradition_of(t) is not None)
        )
        is_precinct = (is_pow or is_rel_land) and not b
        if not (is_torii_area or is_sacred_b or is_precinct):
            continue
        try:
            geom = shapely.from_wkb(factory.create_multipolygon(area))
        except (RuntimeError, shapely.errors.GEOSException):
            continue
        if geom.is_empty or not geom.is_valid:
            continue
        c = geom.centroid
        if not shapely.contains_xy(kansai_union, c.x, c.y):
            continue

        if is_torii_area:
            polys = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
            for poly in polys:
                fit = fit_box_from_ring(list(poly.exterior.coords)[:-1])
                if not fit:
                    continue
                lon, lat, w, d, angle, _ = fit
                mat = (t.get("material", "") + " " + t.get("colour", "")).lower()
                stone = any(k in mat for k in ("stone", "granite", "concrete", "grey", "gray", "white"))
                h = parse_height(t) or min(22.0, max(3.8, w * 0.92))
                direct_records.append((5, lon, lat, w, max(1.0, min(3.0, d)), angle, h, TORII_STONE if stone else TORII, "osm-torii-area"))
            continue

        if is_sacred_b:
            trad = tradition_of(t)
            if trad is None:
                continue
            polys = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
            for poly in polys:
                fit = fit_box_from_ring(list(poly.exterior.coords)[:-1])
                if not fit:
                    continue
                lon, lat, w, d, angle, a_m2 = fit
                if a_m2 > 6000:
                    continue
                h = parse_height(t)
                kind = classify_kind(t, trad, a_m2, w, d, h, lon, lat)
                h = h or default_height(kind, a_m2, t)
                direct_records.append((3, lon, lat, w, d, angle, h, kind, "osm-direct"))
            continue

        if is_precinct:
            trad = tradition_of(t)
            if trad is None:
                continue
            # Reject huge mountain-wide landuse polygons (> 0.6 km²) that enclose whole towns.
            w_deg = geom.bounds[2] - geom.bounds[0]
            h_deg = geom.bounds[3] - geom.bounds[1]
            if w_deg * h_deg > 0.00012:
                continue
            precincts.append((geom, trad, t.get("name", ""), dict(t)))

    print(
        f"Pass 2 done: {len(direct_records)} direct sacred/torii, {len(precincts)} precincts",
        flush=True,
    )

    # Stage 3: Match GSI BldA footprints inside precincts or at place_of_worship POI nodes
    # so rural shrines and temples without OSM building polygons also get real sacred models!
    poi_pts = [ShPoint(lon, lat) for lon, lat, *_ in poi_nodes]
    poi_tree = STRtree(poi_pts) if poi_pts else None

    # Identify which z12 tiles contain precincts or POIs
    active_tiles = defaultdict(lambda: {"precincts": [], "pois": []})
    for idx, (geom, trad, pname, ptags) in enumerate(precincts):
        w0, s0, e0, n0 = geom.bounds
        x0, y0 = (math.floor(v) for v in tile_xy(w0, n0, 12))
        x1, y1 = (math.floor(v) for v in tile_xy(e0, s0, 12))
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                active_tiles[(tx, ty)]["precincts"].append(idx)
    for idx, (lon, lat, *_rest) in enumerate(poi_nodes):
        tx, ty = (math.floor(v) for v in tile_xy(lon, lat, 12))
        active_tiles[(tx, ty)]["pois"].append(idx)

    # Index already-discovered direct records by z12 tile to avoid duplicates
    existing_by_tile = defaultdict(list)
    for rec in direct_records:
        tx, ty = (math.floor(v) for v in tile_xy(rec[1], rec[2], 12))
        existing_by_tile[(tx, ty)].append((rec[1], rec[2]))

    net_index = json.loads((DATA / "network" / "index.json").read_text(encoding="utf-8"))
    pack_paths = {}
    for code, keys in net_index["prefectures"].items():
        for k in keys:
            tx, ty = map(int, k.split("/"))
            pack_paths.setdefault((tx, ty), DATA / "network" / code / f"{tx}-{ty}.bin")

    gsi_precinct_count = 0
    gsi_poi_count = 0
    HEADER = struct.Struct("<257I")
    print(f"Pass 3: matching GSI BldA footprints across {len(active_tiles)} z12 tiles...", flush=True)
    for (tx, ty), bucket in sorted(active_tiles.items()):
        pack_path = pack_paths.get((tx, ty))
        if not pack_path or not pack_path.exists():
            continue
        local_precincts = [precincts[i] for i in bucket["precincts"]]
        local_p_tree = STRtree([p[0] for p in local_precincts]) if local_precincts else None
        local_pois = [poi_nodes[i] for i in bucket["pois"]]
        local_poi_pts = [ShPoint(p[0], p[1]) for p in local_pois]
        local_poi_tree = STRtree(local_poi_pts) if local_pois else None
        near_existing = existing_by_tile[(tx, ty)]

        pack = pack_path.read_bytes()
        offsets = HEADER.unpack_from(pack)
        # Track best GSI footprint per POI node so each POI node claims at most 1 main hall
        poi_best = {}  # poi_idx -> (dist, rec)
        for slot in range(256):
            start, end = offsets[slot], offsets[slot + 1]
            if start == end:
                continue
            sx, sy = tx * 16 + (slot % 16), ty * 16 + (slot // 16)
            # Quick z16 subtile bounding check against local precincts & POIs
            w_sub, n_sub = lon_lat(sx, sy, 16)
            e_sub, s_sub = lon_lat(sx + 1, sy + 1, 16)
            sub_box = shapely.box(w_sub, s_sub, e_sub, n_sub)
            has_p = local_p_tree is not None and len(local_p_tree.query(sub_box, predicate="intersects")) > 0
            has_n = local_poi_tree is not None and len(local_poi_tree.query(sub_box.buffer(0.00015), predicate="intersects")) > 0
            if not has_p and not has_n:
                continue
            tile = vector_tile_pb2.tile()
            tile.ParseFromString(gzip.decompress(pack[start:end]))
            blda = next((ly for ly in tile.layers if ly.name == "BldA"), None)
            if not blda:
                continue
            code_idx = list(blda.keys).index("vt_code") if "vt_code" in blda.keys else -1
            vals = [v.int_value or v.uint_value or v.sint_value for v in blda.values]
            for feat in blda.features:
                vt_code = 3101
                if code_idx >= 0:
                    for k in range(0, len(feat.tags), 2):
                        if feat.tags[k] == code_idx:
                            vt_code = vals[feat.tags[k + 1]]
                            break
                if vt_code not in (3101, 3102):
                    continue
                rings_norm = decode_mvt_rings(feat.geometry, blda.extent)
                if not rings_norm:
                    continue
                outer = [lon_lat(sx + u, sy + v, 16) for u, v in rings_norm[0]]
                if len(outer) < 3:
                    continue
                # Quick centroid
                clon = sum(p[0] for p in outer) / len(outer)
                clat = sum(p[1] for p in outer) / len(outer)
                if any(abs(clon - ex) < 0.000045 and abs(clat - ey) < 0.000038 for ex, ey in near_existing):
                    continue
                pt = ShPoint(clon, clat)
                matched_trad = None
                matched_tags = None
                if has_p and local_p_tree is not None:
                    hits = local_p_tree.query(pt, predicate="within")
                    if len(hits):
                        _, matched_trad, _, matched_tags = local_precincts[int(hits[0])]
                        fit = fit_box_from_ring(outer)
                        if fit and 16.0 <= fit[5] <= 3800.0:
                            lon, lat, w, d, angle, a_m2 = fit
                            kind = classify_kind(matched_tags, matched_trad, a_m2, w, d, None, lon, lat)
                            h = default_height(kind, a_m2, matched_tags)
                            direct_records.append((1, lon, lat, w, d, angle, h, kind, "gsi-precinct"))
                            near_existing.append((lon, lat))
                            gsi_precinct_count += 1
                            continue
                if has_n and local_poi_tree is not None:
                    # Check if a POI node lies inside or within ~12m of this building
                    cand_pois = local_poi_tree.query(pt.buffer(0.00018))
                    if len(cand_pois):
                        poly = Polygon(outer)
                        if not poly.is_valid:
                            continue
                        fit = fit_box_from_ring(outer)
                        if not fit or not (16.0 <= fit[5] <= 3800.0):
                            continue
                        lon, lat, w, d, angle, a_m2 = fit
                        for pi in cand_pois:
                            pi = int(pi)
                            plon, plat, ptrad, _, ptags = local_pois[pi]
                            if any(abs(plon - ex) < 0.00008 and abs(plat - ey) < 0.00007 for ex, ey in near_existing):
                                continue
                            dist = 0.0 if poly.contains(local_poi_pts[pi]) else math.hypot((clon - plon) * 91284, (clat - plat) * 110940)
                            if dist > 12.0:
                                continue
                            prev = poi_best.get(pi)
                            if prev is None or dist < prev[0]:
                                kind = classify_kind(ptags, ptrad, a_m2, w, d, None, lon, lat)
                                h = default_height(kind, a_m2, ptags)
                                poi_best[pi] = (dist, (1, lon, lat, w, d, angle, h, kind, "gsi-poi"))
        for _, rec in poi_best.values():
            direct_records.append(rec)
            gsi_poi_count += 1

    print(f"Pass 3 done: {gsi_precinct_count} GSI-precinct + {gsi_poi_count} GSI-POI matched buildings", flush=True)

    # Deduplicate spatially (priority order: torii-way/area > torii-node > osm-direct > osm-precinct > gsi)
    direct_records.sort(key=lambda r: (-r[0], -r[3] * r[4]))
    kept_grid = defaultdict(list)
    tiles = defaultdict(list)
    by_pref = Counter()
    by_kind = Counter()
    by_source = Counter()
    for prio, lon, lat, w, d, angle, h, kind, src_tag in direct_records:
        gx, gy = int(math.floor(lon * 20000)), int(math.floor(lat * 20000))
        dup = False
        is_torii = kind in (TORII, TORII_STONE)
        thresh_lon = 0.000025 if is_torii else 0.00004
        thresh_lat = 0.000022 if is_torii else 0.000035
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for elon, elat, ekind in kept_grid[(gx + dx, gy + dy)]:
                    if (ekind in (TORII, TORII_STONE)) == is_torii:
                        if abs(lon - elon) < thresh_lon and abs(lat - elat) < thresh_lat:
                            dup = True
                            break
                if dup:
                    break
            if dup:
                break
        if dup:
            continue
        owner = next((code for code, bnd in pref_bounds.items() if shapely.contains_xy(bnd, lon, lat)), None)
        if not owner:
            continue
        kept_grid[(gx, gy)].append((lon, lat, kind))
        fx, fy = tile_xy(lon, lat, 12)
        tx, ty = math.floor(fx), math.floor(fy)
        u16 = min(65535, max(0, round((fx - tx) * 65535)))
        v16 = min(65535, max(0, round((fy - ty) * 65535)))
        w_dm = min(2000, max(15, round(w * 10)))
        d_dm = min(2000, max(8, round(d * 10)))
        h_dm = min(1000, max(25, round(h * 10)))
        ang_b = round((angle % math.pi) / math.pi * 256) & 255
        tiles[(tx, ty)].append([u16, v16, w_dm, d_dm, ang_b, h_dm, kind])
        by_pref[owner] += 1
        by_kind[kind] += 1
        by_source[src_tag] += 1

    output.mkdir(parents=True, exist_ok=True)
    # Remove any stale files
    for old in output.glob("*.json.gz"):
        old.unlink()
    total_bytes = 0
    tile_counts = {}
    for (tx, ty), rows in sorted(tiles.items()):
        rows.sort(key=lambda r: (r[1], r[0], r[6]))
        payload = gzip.compress(json.dumps(rows, separators=(",", ":")).encode("utf-8"), compresslevel=9, mtime=0)
        (output / f"{tx}-{ty}.json.gz").write_bytes(payload)
        tile_counts[f"{tx}/{ty}"] = len(rows)
        total_bytes += len(payload)

    manifest = {
        "version": 1,
        "zoom": 12,
        "source": SOURCE,
        "md5": MD5,
        "attribution": "© OpenStreetMap contributors / 国土地理院最適化ベクトルタイルを加工",
        "kinds": {
            "0": "temple", "1": "shrine", "2": "shrineVermilion",
            "3": "pagoda", "4": "gate", "5": "torii", "6": "toriiStone",
        },
        "tiles": tile_counts,
        "total": sum(tile_counts.values()),
        "byPrefecture": dict(sorted(by_pref.items())),
        "byKind": {str(k): v for k, v in sorted(by_kind.items())},
        "bySource": dict(sorted(by_source.items())),
        "bytes": total_bytes,
    }
    (output / "index.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(tile_counts)} tiles, {manifest['total']:,} sacred structures, {total_bytes:,} bytes\n"
        f"  byPrefecture: {manifest['byPrefecture']}\n"
        f"  byKind: {manifest['byKind']}\n"
        f"  bySource: {manifest['bySource']}",
        flush=True,
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--output", type=Path, default=DATA / "sacred")
    args = p.parse_args()
    extract(args.source, args.output)
