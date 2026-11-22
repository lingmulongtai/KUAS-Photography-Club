"""Build registered forest and cropland masks from the original ESA WorldCover rasters.

Python 3.11+ with numpy, rasterio and Pillow. Run after building prefectures.json:
    python tools/kansai-data/build_landcover.py --cache <source-cache-directory>

Each north-up PNG covers 1/8 degree square and contains 500 by 500 cells.
R and G are the proportions of the nine native pixels classified as tree cover
and cropland respectively, scaled to 0..255. Blue is zero. Cell values describe
land cover, not tree coordinates or elevations.
"""

import argparse
from contextlib import ExitStack
import hashlib
import json
import math
from pathlib import Path
import shutil
from urllib.request import urlopen

import numpy as np
from PIL import Image
import rasterio
from rasterio.features import bounds, geometry_mask
from rasterio.transform import from_bounds
from rasterio.windows import Window


PROJECT = Path(__file__).resolve().parents[2]
DATA = PROJECT / "public" / "kansai"
SOURCE_ROOT = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
SOURCES = {
    132: "dca25b37a5aa634b3d916086d02c6d493cee01813e1f80adb0e7abb84943a195",
    135: "200c0ebb595a49b91b944a690d9a341418bf20427b8edd2345bcfa1cf554688d",
}
PREFECTURE_CODES = {"25", "26", "27", "28", "29"}
TILES_PER_DEGREE = 8
SIZE = 500
NATIVE_SIZE = 3 * SIZE


def original(cache, longitude, checksum):
    filename = f"ESA_WorldCover_10m_2021_v200_N33E{longitude}_Map.tif"
    path = cache / filename
    if not path.exists():
        partial = path.with_suffix(".part")
        with urlopen(SOURCE_ROOT + filename, timeout=120) as source, partial.open("wb") as output:
            shutil.copyfileobj(source, output)
        with partial.open("rb") as download:
            if hashlib.file_digest(download, "sha256").hexdigest() != checksum:
                raise ValueError(f"Invalid source download: {filename}")
        partial.replace(path)
    with path.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != checksum:
            raise ValueError(f"Unexpected checksum: {filename}")
    return path


def tile_polygons(boundaries):
    features = boundaries["features"]
    if {str(feature["properties"]["code"]) for feature in features} != PREFECTURE_CODES:
        raise ValueError("Expected Shiga, Kyoto, Osaka, Hyogo and Nara boundaries")
    tiles = {}
    for feature in features:
        geometry = feature["geometry"]
        polygons = geometry["coordinates"]
        if geometry["type"] == "Polygon":
            polygons = [polygons]
        elif geometry["type"] != "MultiPolygon":
            raise ValueError("Expected polygonal prefecture boundaries")
        for polygon in polygons:
            shape = {"type": "Polygon", "coordinates": polygon}
            west, south, east, north = bounds(shape)
            for x in range(math.floor(west * TILES_PER_DEGREE), math.ceil(east * TILES_PER_DEGREE)):
                for y in range(math.floor((90 - north) * TILES_PER_DEGREE), math.ceil((90 - south) * TILES_PER_DEGREE)):
                    tiles.setdefault((x, y), []).append(shape)
    return tiles


def class_counts(classes, value):
    cells = (classes == value).reshape(SIZE, 3, SIZE, 3)
    return cells.sum(axis=(1, 3), dtype=np.uint8)


def generate(cache, boundary_path, output):
    boundaries = json.loads(boundary_path.read_text(encoding="utf-8"))
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    # The palette preserves both independent cover fractions, even for mixed cells.
    # Index = 10 * number of native tree pixels + number of native crop pixels.
    levels = [round(i * 255 / 9) for i in range(10)]
    palette = [component for trees in levels for crops in levels for component in (trees, crops, 0)]
    tiles = []
    with ExitStack() as stack:
        rasters = {
            lon: stack.enter_context(rasterio.open(original(cache, lon, checksum)))
            for lon, checksum in SOURCES.items()
        }
        for (x, y), shapes in sorted(tile_polygons(boundaries).items()):
            west, north = x / TILES_PER_DEGREE, 90 - y / TILES_PER_DEGREE
            transform = from_bounds(west, north - 1 / TILES_PER_DEGREE,
                                    west + 1 / TILES_PER_DEGREE, north, SIZE, SIZE)
            # Include every touched boundary cell so narrow islands and capes survive.
            inside = geometry_mask(shapes, (SIZE, SIZE), transform, all_touched=True, invert=True)
            if not inside.any():
                continue
            raster = rasters[3 * math.floor(west / 3)]
            col = round((west - raster.bounds.left) / raster.transform.a)
            row = round((north - raster.bounds.top) / raster.transform.e)
            classes = raster.read(1, window=Window(col, row, NATIVE_SIZE, NATIVE_SIZE))
            if classes.shape != (NATIVE_SIZE, NATIVE_SIZE):
                raise ValueError(f"Incomplete WorldCover window at {x}, {y}")
            trees = class_counts(classes, 10)
            crops = class_counts(classes, 40)
            packed = trees * 10 + crops
            packed[~inside] = 0
            picture = Image.frombytes("P", (SIZE, SIZE), packed.tobytes())
            picture.putpalette(palette)
            picture.save(output / f"{x}-{y}.png", compress_level=9)
            tiles.append([x, y])
    index = {
        "tileSize": SIZE,
        "tilesPerDegree": TILES_PER_DEGREE,
        "crs": "EPSG:4326",
        "origin": [0, 90],
        "channels": {"r": "tree fraction", "g": "cropland fraction"},
        "source": "ESA WorldCover 10 m 2021 v200, Zanaga et al. (2022)",
        "sourceUrl": "https://doi.org/10.5281/zenodo.7254221",
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.",
        "processing": "Mean of 3 × 3 native class pixels, clipped to the supplied prefecture polygons.",
        "tiles": tiles,
    }
    (output / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n",
                                       encoding="utf-8", newline="\n")
    print(f"{len(tiles)} tiles, {sum((output / f'{x}-{y}.png').stat().st_size for x, y in tiles):,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--boundaries", type=Path, default=DATA / "prefectures.json")
    parser.add_argument("--output", type=Path, default=DATA / "landcover")
    args = parser.parse_args()
    generate(args.cache, args.boundaries, args.output)
