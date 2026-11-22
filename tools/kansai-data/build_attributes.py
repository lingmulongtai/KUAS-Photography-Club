"""Extract mapped building dimensions and original OSM polygons from the Geofabrik Kansai PBF.

Python 3.11+ with osmium and shapely. The default dated extract is checked against its published
MD5. An existing copy may be supplied with --source. Output and geometry are ODbL 1.0.

Each z12 JSON array is independently gzipped. Its records contain OSM element ID, polygons
(MultiPolygon nesting in longitude/latitude), and only dimensions or roof attributes mapped
on that element. A feature is copied to every intersecting z12 tile. Distances are metres;
storey counts remain storey counts and are never converted to invented heights here.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile
from urllib.request import urlopen

import osmium
import shapely
from shapely.geometry import box, mapping, shape

DATA = Path(__file__).resolve().parents[2] / "public/kansai"
NAME = "kansai-261101.osm.pbf"
SOURCE = "https://download.geofabrik.de/asia/japan/kansai/" + NAME
MD5 = "bb72623497eab32a0ee898a49a189b46"
METRES = {
    "height": "height", "min_height": "minHeight", "roof:height": "roofHeight",
}
LEVELS = {
    "building:levels": "levels", "building:min_level": "minLevel", "roof:levels": "roofLevels",
}
TAGS = (*METRES, *LEVELS, "roof:shape")
UNITS = {"": 1, "m": 1, "metre": 1, "metres": 1, "meter": 1, "meters": 1,
         "cm": 0.01, "ft": 0.3048, "feet": 0.3048, "foot": 0.3048}
PREFECTURES = {"25", "26", "27", "28", "29"}
# Maps real OSM building=* values onto Kyoto's USAGE enum (buildings-data.ts).
BUILDING_USE = {
    "house": 1, "detached": 1, "residential": 1, "semidetached_house": 1, "terrace": 1, "bungalow": 1, "farm": 1,
    "apartments": 2, "dormitory": 2, "flats": 2, "condominium": 2,
    "retail": 3, "commercial": 3, "supermarket": 3, "mall": 3, "department_store": 3, "kiosk": 3,
    "office": 4, "bank": 4,
    "hotel": 5, "motel": 5, "hostel": 5, "guest_house": 5, "ryokan": 5,
    "public": 6, "civic": 6, "government": 6, "school": 6, "university": 6, "college": 6,
    "kindergarten": 6, "hospital": 6, "clinic": 6, "library": 6, "museum": 6,
    "train_station": 6, "station": 6, "transportation": 6, "fire_station": 6, "police": 6,
    "stadium": 6, "sports_hall": 6, "grandstand": 6, "community_centre": 6,
    "industrial": 7, "warehouse": 7, "factory": 7, "manufacture": 7, "parking": 7, "hangar": 7,
}
# Include non-house sturdy building types even when height/levels are not yet mapped in OSM.
STANDALONE_USES = {2, 3, 4, 5, 6, 7}


def number(value, distance):
    """Reject ranges, lists and free text rather than assigning an ambiguous value."""
    value = value.strip().lower()
    if distance:
        feet_inches = re.fullmatch(r"(\d+)\s*['′]\s*(?:(\d+(?:\.\d+)?)\s*[\"″]?)?", value)
        if feet_inches:
            feet, inches = feet_inches.groups()
            return round(int(feet) * 0.3048 + float(inches or 0) * 0.0254, 5)
    match = re.fullmatch(r"([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z]*)", value)
    if not match:
        return None
    raw, unit = match.groups()
    if (unit and not distance) or unit not in UNITS:
        return None
    result = float(raw) * UNITS[unit]
    return round(result, 5) if math.isfinite(result) else None


def mapped_attributes(tags):
    attrs = {}
    for source, field in (*METRES.items(), *LEVELS.items()):
        raw = tags.get(source)
        if raw is None:
            continue
        value = number(raw, source in METRES)
        if value is None or (field not in {"minHeight", "minLevel"} and value < 0):
            continue
        attrs[field] = int(value) if value.is_integer() else value
    roof = tags.get("roof:shape", "").strip().lower()
    if re.fullmatch(r"[a-z][a-z0-9_\-]{0,39}", roof) and roof not in {"yes", "no", "unknown"}:
        attrs["roof"] = roof
    use = BUILDING_USE.get(tags.get("building", "").strip().lower())
    if use is not None and (attrs or use in STANDALONE_USES):
        attrs["use"] = use
    return attrs


def region_boundaries():
    features = json.loads((DATA / "prefectures.json").read_text(encoding="utf-8"))["features"]
    values = {f["properties"]["code"]: shape(f["geometry"]) for f in features}
    if set(values) != PREFECTURES:
        raise ValueError("Expected the five prefecture boundaries")
    for boundary in values.values():
        shapely.prepare(boundary)
    return values


def tile_y(lat):
    return math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * 2048)


def latitude(y):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 4096))))


def tile_keys(geometry):
    west, south, east, north = geometry.bounds
    x0, x1 = (math.floor((lon + 180) * 4096 / 360) for lon in (west, east))
    y0, y1 = tile_y(north), tile_y(south)
    if (x0, y0) == (x1, y1):
        yield x0, y0
        return
    for x in range(x0, x1 + 1):
        left = x * 360 / 4096 - 180
        for y in range(y0, y1 + 1):
            if geometry.intersects(box(left, latitude(y + 1), left + 360 / 4096, latitude(y))):
                yield x, y


def original(cache, source):
    if source is None:
        cache.mkdir(parents=True, exist_ok=True)
        source = cache / NAME
        if not source.exists():
            partial = source.with_suffix(".part")
            with urlopen(SOURCE, timeout=180) as download, partial.open("wb") as stream:
                shutil.copyfileobj(download, stream)
            with partial.open("rb") as stream:
                if hashlib.file_digest(stream, "md5").hexdigest() != MD5:
                    raise ValueError("Geofabrik source MD5 mismatch")
            partial.replace(source)
    with source.open("rb") as stream:
        if hashlib.file_digest(stream, "md5").hexdigest() != MD5:
            raise ValueError("Geofabrik source MD5 mismatch")
    return source


def json_data(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def generate(source, output):
    limits = region_boundaries()
    memberships = Counter()
    totals = Counter()
    observed_roofs = Counter()
    packs = defaultdict(list)
    skipped_geometry = 0
    factory = osmium.geom.WKBFactory()
    building_filter = osmium.filter.KeyFilter("building", "building:part")
    # Assemble relations before filtering so older multipolygons can inherit outer-way tags.
    processor = osmium.FileProcessor(str(source)).with_areas()
    processor.with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
    processor.with_filter(building_filter)
    for area in processor:
        tags = area.tags
        is_part = tags.get("building:part", "no") not in {"no", "0", "false"}
        b_val = tags.get("building", "no").strip().lower()
        if not is_part and b_val in {"no", "0", "false"}:
            continue
        if b_val not in BUILDING_USE and not any(k in tags for k in TAGS):
            continue
        attrs = mapped_attributes(tags)
        if not attrs:
            continue
        try:
            geom = shapely.from_wkb(factory.create_multipolygon(area))
        except (RuntimeError, shapely.errors.GEOSException):
            skipped_geometry += 1
            continue
        if geom.is_empty or not geom.is_valid:
            skipped_geometry += 1
            continue
        owners = [code for code, boundary in limits.items() if boundary.intersects(geom)]
        if not owners:
            continue
        memberships.update(owners)
        coords = mapping(geom)["coordinates"]
        ident = ("w" if area.from_way() else "r") + str(area.orig_id())
        record = {"id": ident, "polygons": coords, **attrs}
        if is_part:
            record["part"] = True
        totals["features"] += 1
        totals.update(attrs.keys())
        if is_part:
            totals["parts"] += 1
        if "roof" in attrs:
            observed_roofs[attrs["roof"]] += 1
        for key in tile_keys(geom):
            packs[key].append(record)
    if set(memberships) != PREFECTURES or not totals["height"] or not totals["levels"]:
        raise ValueError("Unexpected building attribute coverage")
    output.mkdir(parents=True, exist_ok=True)
    byte_size = 0
    for (x, y), rows in sorted(packs.items()):
        file = output / f"{x}-{y}.json.gz"
        temp = file.with_suffix(".part")
        payload = gzip.compress(json_data(sorted(rows, key=lambda row: row["id"])), compresslevel=9, mtime=0)
        temp.write_bytes(payload)
        temp.replace(file)
        byte_size += len(payload)
    with osmium.io.Reader(str(source), osmium.osm.NOTHING) as reader:
        timestamp = reader.header().get("osmosis_replication_timestamp")
    manifest = {
        "version": 1, "zoom": 12, "source": SOURCE, "md5": MD5, "sourceTimestamp": timestamp,
        "attribution": "© OpenStreetMap contributors", "attributionUrl": "https://www.openstreetmap.org/copyright",
        "license": "ODbL 1.0", "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "tiles": [f"{x}/{y}" for x, y in sorted(packs)], "featuresByPrefecture": dict(sorted(memberships.items())),
        "counts": dict(sorted(totals.items())), "roofShapes": dict(sorted(observed_roofs.items())), "bytes": byte_size,
        "invalidAreasSkippedInGeofabrikExtract": skipped_geometry,
    }
    temp = output / "index.part"
    temp.write_bytes(json_data(manifest) + b"\n")
    temp.replace(output / "index.json")
    print(f"{len(packs)} tiles, {byte_size:,} bytes, {dict(totals)}, prefectures {dict(memberships)}", flush=True)


def verify(output):
    m = json.loads((output / "index.json").read_bytes())
    limits = region_boundaries()
    unique = {}
    membership = Counter()
    totals = Counter()
    roofs = Counter()
    file_bytes = 0
    duplicates = 0
    files = set(output.glob("*.json.gz"))
    for key in m["tiles"]:
        x, y = map(int, key.split("/"))
        path = output / f"{x}-{y}.json.gz"
        files.remove(path)
        file_bytes += path.stat().st_size
        rows = json.loads(gzip.decompress(path.read_bytes()))
        if not rows or len({r["id"] for r in rows}) != len(rows):
            raise ValueError(f"Invalid building attribute tile {key}")
        for row in rows:
            ident = row["id"]
            digest = hashlib.sha256(json_data(row)).digest()
            if ident in unique:
                previous, keys = unique[ident]
                if digest != previous or (x, y) not in keys:
                    raise ValueError(f"Inconsistent cross-tile geometry {ident}")
                keys.remove((x, y))
                duplicates += 1
                continue
            geom = shape({"type": "MultiPolygon", "coordinates": row["polygons"]})
            if not geom.is_valid or geom.is_empty:
                raise ValueError(f"Invalid OSM polygon {ident}")
            keys = set(tile_keys(geom))
            keys.remove((x, y))
            unique[ident] = digest, keys
            owners = [code for code, boundary in limits.items() if boundary.intersects(geom)]
            if not owners:
                raise ValueError(f"Feature is outside all five prefectures {ident}")
            membership.update(owners)
            totals["features"] += 1
            for field in (*METRES.values(), *LEVELS.values(), "roof", "use"):
                if field in row:
                    totals[field] += 1
            if row.get("part"):
                totals["parts"] += 1
            if "roof" in row:
                roofs[row["roof"]] += 1
    if (files or any(keys for digest, keys in unique.values()) or file_bytes != m["bytes"]
            or dict(membership) != m["featuresByPrefecture"] or dict(totals) != m["counts"]
            or dict(roofs) != m["roofShapes"]):
        raise ValueError("Physical tiles differ from the metadata or their spatial coverage")
    print(f"Verified {len(unique):,} unique OSM elements and {duplicates} cross-tile copies")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--source", type=Path, help="Existing copy of the checksum-pinned Geofabrik PBF")
    cli.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "kuas-regional-osm")
    cli.add_argument("--output", type=Path, default=DATA / "building-attributes")
    cli.add_argument("--verify", action="store_true", help="Validate all local shards without the PBF")
    args = cli.parse_args()
    if args.verify:
        verify(args.output)
    else:
        generate(original(args.cache, args.source), args.output)
