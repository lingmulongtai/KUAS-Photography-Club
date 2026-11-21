"""Extract native GHSL R2023A net and gross building-height grid cells for Kansai.

Requires numpy and rasterio with HTTPS range access. Run from any directory:
    python tools/kansai-data/build_heights.py

Only reads the source COG windows that overlap the five prefectures. Each gzip
tile contains 128 × 128 little-endian Float32 pairs in north-to-south row order.
The first channel is ANBH (m) and the second AGBH (m³/m²). Outside-mask cells
are NaN; all original grid values, including zeros, retain their Float32 bits.
"""

import argparse
from contextlib import ExitStack
import gzip
import json
import math
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import rasterio
from rasterio.features import bounds, geometry_mask
from rasterio.windows import Window


DATA = Path(__file__).resolve().parents[2] / "public" / "kansai"
SIZE = 128
CHANNELS = ("anbh", "agbh")
ETAGS = {
    "anbh": "37f71b11e3910e14f088cb99d41d647f-713",
    "agbh": "010297db335cbadf83c3958d25cc95a1-893",
}


def source_url(channel):
    name = f"GHS_BUILT_H_{channel.upper()}_E2018_GLOBE_R2023A_4326_3ss_V1_0.tif"
    return f"https://jrc-ghsl.s3.eu-central-1.amazonaws.com/ghs-built-h-{channel}/r2023a/4326/3asec/2018/{name}"


def tile_polygons(features, transform):
    tiles = {}
    for feature in features:
        geometry = feature["geometry"]
        if geometry["type"] not in ("Polygon", "MultiPolygon"):
            raise ValueError("Expected polygonal prefecture boundaries")
        parts = geometry["coordinates"]
        if geometry["type"] == "Polygon":
            parts = [parts]
        for coordinates in parts:
            polygon = {"type": "Polygon", "coordinates": coordinates}
            west, south, east, north = bounds(polygon)
            left, top = ~transform * (west, north)
            right, bottom = ~transform * (east, south)
            for x in range(math.floor(left / SIZE), math.floor(right / SIZE) + 1):
                for y in range(math.floor(top / SIZE), math.floor(bottom / SIZE) + 1):
                    tiles.setdefault((x, y), []).append(polygon)
    return tiles


def generate(boundaries, output):
    features = json.loads(boundaries.read_text(encoding="utf-8"))["features"]
    if {f["properties"]["code"] for f in features} != {"25", "26", "27", "28", "29"}:
        raise ValueError("Expected boundaries for all five Kansai prefectures")
    tiles = []
    inside_cells = positive_cells = 0
    source_metadata = []
    with ExitStack() as stack:
        stack.enter_context(rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY=3))
        datasets = []
        for channel in CHANNELS:
            url = source_url(channel)
            with urlopen(Request(url, method="HEAD"), timeout=30) as response:
                etag = response.headers["ETag"].strip('"')
            if etag != ETAGS[channel]:
                raise ValueError(f"Unexpected {channel} source version: {etag}")
            dataset = stack.enter_context(rasterio.open(url))
            if dataset.crs.to_epsg() != 4326 or dataset.dtypes != ("float32",):
                raise ValueError(f"Unexpected {channel} CRS or data type")
            if datasets and (dataset.transform, dataset.shape) != (datasets[0].transform, datasets[0].shape):
                raise ValueError("The two source grids no longer align")
            if dataset.nodata is not None:
                raise ValueError(f"New nodata convention in {channel} source")
            datasets.append(dataset)
            source_metadata.append({"channel": channel.upper(), "url": url, "etag": etag})
        transform = datasets[0].transform
        for (x, y), polygons in sorted(tile_polygons(features, transform).items()):
            window = Window(x * SIZE, y * SIZE, SIZE, SIZE)
            inside = geometry_mask(polygons, (SIZE, SIZE), datasets[0].window_transform(window),
                                   invert=True, all_touched=True)
            if not inside.any():
                continue
            values = np.full((SIZE, SIZE, len(CHANNELS)), np.nan, dtype="<f4")
            for i, dataset in enumerate(datasets):
                original = dataset.read(1, window=window, masked=True)
                np.copyto(values[:, :, i], original.data, where=inside & ~np.ma.getmaskarray(original))
            destination = output / str(x) / f"{y}.f32.gz"
            destination.parent.mkdir(exist_ok=True, parents=True)
            with destination.open("wb") as file, gzip.GzipFile(filename="", mode="wb", fileobj=file, mtime=0) as packed:
                packed.write(values.tobytes())
            tiles.append([x, y])
            inside_cells += int(inside.sum())
            positive_cells += int((values[:, :, 0] > 0).sum())
    index = {
        "crs": "EPSG:4326", "origin": [transform.c, transform.f], "pixelSize": [transform.a, -transform.e],
        "tileSize": SIZE, "path": "{x}/{y}.f32.gz",
        "format": "gzip-compressed little-endian interleaved Float32 pairs, row-major from north-west",
        "channels": ["ANBH (average net building height in metres)", "AGBH (gross building volume in m³ per m² of cell area)"],
        "nodata": "NaN outside the prefecture mask or where masked by the source. Original zeros retained.",
        "insideCells": inside_cells, "positiveNetHeightCells": positive_cells,
        "source": "Pesaresi, Martino and Politis, Panagiotis (2023). GHS-BUILT-H R2023A. European Commission, Joint Research Centre (JRC).",
        "sourceUrl": "https://doi.org/10.2905/85005901-3a49-48dd-9d19-6261354f56fe",
        "sourceFiles": source_metadata, "epoch": 2018,
        "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "licenseSource": "https://registry.opendata.aws/ghs-built-h/",
        "processing": "Clipped native three-arcsecond WGS84 cells to all pixels touched by the five MLIT N03 prefecture boundaries. No resampling or height conversion.",
        "tiles": tiles,
    }
    (output / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n",
                                       encoding="utf-8", newline="\n")
    size = sum((output / str(x) / f"{y}.f32.gz").stat().st_size for x, y in tiles)
    print(f"{len(tiles)} tiles, {inside_cells:,} inside cells, {positive_cells:,} positive ANBH, {size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--boundaries", type=Path, default=DATA / "prefectures.json")
    parser.add_argument("--output", type=Path, default=DATA / "heights")
    args = parser.parse_args()
    generate(args.boundaries, args.output)
