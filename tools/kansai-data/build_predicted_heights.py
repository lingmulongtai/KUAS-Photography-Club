"""Rasterize 2020 3D-GloBFP predicted building heights within five prefectures.

Requires GDAL Python bindings, NumPy, Pillow and Shapely. Pass --cache to reuse
the six Figshare ZIPs and their extracted shapefiles between runs.
"""

import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import shutil
import struct
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile

import numpy as np
from osgeo import gdal, osr
from PIL import Image
from shapely.geometry import box, shape


DATA = Path(__file__).resolve().parents[2] / "public" / "kansai"
ARTICLE = "https://doi.org/10.6084/m9.figshare.28906499"
PAPER = "https://doi.org/10.5194/essd-16-5357-2024"
ARCHIVES = (
    ("2477_130.0_35.0_135.0_40.0_JA_KS", 54116636, "76455dd3154688e498cc5f49ce37ab72"),
    ("2482_135.0_35.0_136.25_36.25_JA", 54116759, "d59dfd5de2dcdfcb8daa8287b5d1473a"),
    ("2483_136.25_35.0_137.5_36.25_JA", 54116891, "182eeb637a66d984aa2ddd556acb2501"),
    ("2493_133.75_33.75_135.0_35.0_JA", 54116855, "08f378bdc39beeddc3951d070e1e4219"),
    ("2497_135.0_33.75_136.25_35.0_JA", 54116897, "1396453c8672d0e60c183d57fe8bea8e"),
    ("2498_136.25_33.75_137.5_35.0_JA", 54116825, "298a9cb9b85d46d0ac5b57f48c90e1c0"),
)
RADIUS = 6378137.0
HALF_WORLD = math.pi * RADIUS
PREFECTURES = ("25", "26", "27", "28", "29")
PACK_SIZE = 2048
TILE_SIZE = 256
SIDE = PACK_SIZE // TILE_SIZE
TILE_COUNT = SIDE * SIDE
HEADER_BYTES = 4 * (TILE_COUNT + 1)


def source_files(cache):
    cache.mkdir(parents=True, exist_ok=True)
    unpacked = cache / "shapefiles"
    unpacked.mkdir(exist_ok=True)
    files = []
    for name, file_id, checksum in ARCHIVES:
        archive = cache / f"{name}.zip"
        if not archive.exists():
            partial = archive.with_suffix(".part")
            with urlopen(f"https://ndownloader.figshare.com/files/{file_id}", timeout=120) as response:
                with partial.open("wb") as destination:
                    shutil.copyfileobj(response, destination, 1024 * 1024)
            partial.replace(archive)
        with archive.open("rb") as stream:
            if hashlib.file_digest(stream, "md5").hexdigest() != checksum:
                raise ValueError(f"Figshare MD5 mismatch for {archive.name}")
        with ZipFile(archive) as zipped:
            for member in zipped.infolist():
                target = unpacked / Path(member.filename).name
                if target.stem != name or target.suffix not in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
                    raise ValueError(f"Unexpected archive member {member.filename}")
                if not target.is_file() or target.stat().st_size != member.file_size:
                    with zipped.open(member) as source, target.open("wb") as destination:
                        shutil.copyfileobj(source, destination, 1024 * 1024)
        shapefile = unpacked / f"{name}.shp"
        if not shapefile.with_suffix(".qix").exists():
            with gdal.OpenEx(str(shapefile), gdal.OF_VECTOR | gdal.OF_UPDATE) as dataset:
                dataset.ExecuteSQL(f'CREATE SPATIAL INDEX ON "{name}"')
        files.append(shapefile)
    return files


def lonlat(x, y):
    return x / 4096 * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 4096))))


def tile_xy(lon, lat):
    x = (lon + 180) / 360 * 4096
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 4096
    return math.floor(x), math.floor(y)


def pack_tiles(boundaries):
    features = json.loads(boundaries.read_bytes())["features"]
    if {feature["properties"]["code"] for feature in features} != set(PREFECTURES):
        raise ValueError("Expected all five N03 prefectures")
    tiles = set()
    for feature in features:
        geometry = shape(feature["geometry"])
        west, south, east, north = geometry.bounds
        min_x, min_y = tile_xy(west, north)
        max_x, max_y = tile_xy(east, south)
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                left, top = lonlat(x, y)
                right, bottom = lonlat(x + 1, y + 1)
                if geometry.intersects(box(left, bottom, right, top)):
                    tiles.add((x, y))
    return sorted(tiles)


def start_worker(files, boundaries, output):
    global buildings, prefectures, output_dir, projection
    gdal.UseExceptions()
    buildings = [gdal.OpenEx(str(path), gdal.OF_VECTOR) for path in files]
    prefectures = gdal.OpenEx(str(boundaries), gdal.OF_VECTOR)
    output_dir = output
    reference = osr.SpatialReference()
    reference.ImportFromEPSG(3857)
    projection = reference.ExportToWkt()


def raster(x, y, dtype):
    width = 2 * HALF_WORLD / 4096
    step = width / PACK_SIZE
    grid = gdal.GetDriverByName("MEM").Create("", PACK_SIZE, PACK_SIZE, 1, dtype)
    grid.SetProjection(projection)
    grid.SetGeoTransform((-HALF_WORLD + x * width, step, 0, HALF_WORLD - y * width, 0, -step))
    return grid


def burn(grid, dataset, extent, attribute):
    layer = dataset.GetLayer(0)
    layer.SetSpatialFilterRect(*extent)
    gdal.RasterizeLayer(grid, [1], layer, options=[f"ATTRIBUTE={attribute}"])


def build_pack(tile):
    x, y = tile
    west, north = lonlat(x, y)
    east, south = lonlat(x + 1, y + 1)
    extent = (west, south, east, north)
    height_grid = raster(x, y, gdal.GDT_Float32)
    for dataset in buildings:
        burn(height_grid, dataset, extent, "Height")
    heights = height_grid.ReadAsArray()
    mask_grid = raster(x, y, gdal.GDT_Byte)
    burn(mask_grid, prefectures, extent, "code")
    codes = mask_grid.ReadAsArray()
    valid = np.isfinite(heights) & (heights > 0) & (codes != 0)
    counts = np.bincount(codes[valid], minlength=30)
    if not np.any(valid):
        return tile, 0, [], 0
    if heights[valid].max() > 6553.5:
        raise ValueError("Height exceeds uint16 decimetre range")
    values = np.zeros(heights.shape, dtype=np.uint16)
    values[valid] = np.maximum(1, np.rint(heights[valid] * 10)).astype(np.uint16)
    offsets = [HEADER_BYTES]
    payload = BytesIO()
    occupied = 0
    for row in range(SIDE):
        for col in range(SIDE):
            block = values[row*TILE_SIZE:(row+1)*TILE_SIZE, col*TILE_SIZE:(col+1)*TILE_SIZE]
            if block.any():
                rgb = np.zeros((TILE_SIZE, TILE_SIZE, 3), dtype=np.uint8)
                rgb[:, :, 0] = block >> 8
                rgb[:, :, 1] = block & 255
                Image.fromarray(rgb).save(payload, format="PNG", compress_level=6)
                occupied += 1
            offsets.append(HEADER_BYTES + payload.tell())
    destination = output_dir / f"{x}-{y}.bin"
    pending = destination.with_suffix(".tmp")
    with pending.open("wb") as out:
        out.write(struct.pack(f"<{len(offsets)}I", *offsets))
        out.write(payload.getbuffer())
    pending.replace(destination)
    return tile, occupied, [int(counts[int(code)]) for code in PREFECTURES], offsets[-1]


def generate(cache, boundaries, output, workers):
    gdal.UseExceptions()
    files = source_files(cache)
    tiles = pack_tiles(boundaries)
    output.mkdir(parents=True, exist_ok=True)
    packs = []
    pixels = dict.fromkeys(PREFECTURES, 0)
    subtile_count = byte_count = 0
    with ProcessPoolExecutor(max_workers=workers, initializer=start_worker,
                             initargs=(files, boundaries, output)) as pool:
        for i, ((x, y), occupied, counts, size) in enumerate(pool.map(build_pack, tiles), 1):
            if occupied:
                packs.append(f"{x}/{y}")
                subtile_count += occupied
                byte_count += size
                for code, count in zip(PREFECTURES, counts):
                    pixels[code] += count
            if i % 50 == 0:
                print(f"{i}/{len(tiles)} packs processed", flush=True)
    if not all(pixels.values()):
        raise ValueError("One or more prefectures have no predicted height coverage")
    index = {
        "source": "Che et al., 3D-GloBFP (2020 predicted building heights)",
        "sourceUrl": ARTICLE, "paperUrl": PAPER, "epoch": 2020,
        "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "processing": "Source building polygons rasterized at pixel centres, clipped to MLIT N03 prefectures and quantized to 0.1 m.",
        "modelLimitations": "XGBoost predictions. Japan and North and South Korea together had a reported RMSE of 14.60 m. Footprint omissions and differences in survey dates affect coverage.",
        "crs": "EPSG:3857", "packZoom": 12, "tileZoom": 15, "tileSize": TILE_SIZE,
        "encoding": "256x256 RGB8 PNG; decimetres = R*256+G; zero is nodata.",
        "layout": "65 little-endian uint32 absolute byte offsets; z15 subtiles in row-major order.",
        "path": "{x12}-{y12}.bin", "packs": packs, "subtiles": subtile_count,
        "positivePixelsByPrefecture": pixels, "bytes": byte_count,
        "sourceFiles": [dict(name=name+".zip", id=file_id, md5=checksum) for name, file_id, checksum in ARCHIVES],
    }
    pending = output / "index.tmp"
    pending.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8")
    pending.replace(output / "index.json")
    print(f"{len(packs)} packs; {subtile_count} subtiles; {byte_count:,} bytes; {pixels}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "kansai-globfp")
    parser.add_argument("--boundaries", type=Path, default=DATA / "prefectures.json")
    parser.add_argument("--output", type=Path, default=DATA / "predicted-heights")
    parser.add_argument("--workers", type=int, default=min(6, os.cpu_count() or 1))
    args = parser.parse_args()
    generate(args.cache, args.boundaries, args.output, args.workers)
