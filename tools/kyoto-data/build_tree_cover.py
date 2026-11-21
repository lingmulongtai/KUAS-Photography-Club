"""Aggregate ESA WorldCover 2021 v200 tree cover onto the scene's 20 m grid.

Usage: python build_tree_cover.py ESA_WorldCover_10m_2021_v200_N33E135_Map.tif
Requires NumPy and rasterio. See README.md for the source and licence.
"""
import gzip
import hashlib
import json
from pathlib import Path
import struct
import sys

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from rasterio.windows import from_bounds as window_from_bounds, Window

import region

PUBLIC = Path(__file__).resolve().parents[2] / "public" / "kyoto"
SOURCE_SHA256 = "200c0ebb595a49b91b944a690d9a341418bf20427b8edd2345bcfa1cf554688d"
STEP = 20


def main(path):
    with open(path, "rb") as tile:
        if hashlib.file_digest(tile, "sha256").hexdigest() != SOURCE_SHA256:
            raise ValueError("Expected the original WorldCover 2021 v200 N33E135 Map tile")
    x0, z0, x1, z1 = json.loads((PUBLIC / "terrain.json").read_text())["outer"]["box"]
    width, height = (x1 - x0) // STEP, (z1 - z0) // STEP
    assert width * STEP == x1 - x0 and height * STEP == z1 - z0
    north, west = region.to_geo(x0, z0)
    south, east = region.to_geo(x1, z1)
    target = from_bounds(west, south, east, north, width, height)
    with rasterio.open(path) as tile:
        # Read only the scene and one native pixel beyond each edge.
        bounds = window_from_bounds(west, south, east, north, transform=tile.transform)
        col, row = int(bounds.col_off) - 1, int(bounds.row_off) - 1
        window = Window(col, row, int(np.ceil(bounds.width)) + 3, int(np.ceil(bounds.height)) + 3)
        classes = tile.read(1, window=window)
        if (classes == 0).any():
            raise ValueError("The source has missing land cover within the scene")

        def fraction(mask, levels):
            result = np.empty((height, width), dtype=np.uint8)
            reproject(mask.astype(np.uint8) * levels, result,
                      src_transform=tile.window_transform(window), src_crs=tile.crs,
                      dst_transform=target, dst_crs=tile.crs, resampling=Resampling.average)
            return result

        trees = fraction(classes == 10, 15)
        # Preserve open fields and permanent water even where an older woodland polygon overlaps.
        open_land = fraction((classes == 40) | (classes == 80), 100)
        trees[(trees == 0) & (open_land >= 90)] = 16
    header = struct.pack("<4siiIII", b"KTC1", x0, z0, STEP, width, height)
    payload = gzip.compress(header + trees.tobytes(), mtime=0)
    (PUBLIC / "tree-cover.bin").write_bytes(payload)
    print(f"{width} x {height} cells at {STEP} m; {len(payload):,} bytes")


if __name__ == "__main__":
    main(sys.argv[1])
