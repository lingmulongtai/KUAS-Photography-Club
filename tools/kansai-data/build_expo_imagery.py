"""Tile the June 2025 Expo orthophoto at its native extent for the noncommercial exhibit."""
import argparse
import json
from pathlib import Path
import zipfile

import numpy as np
from PIL import Image
from rasterio.io import MemoryFile

OUT = Path(__file__).resolve().parents[2] / "public/kansai/expo-imagery"
SOURCE = "https://www.geospatial.jp/ckan/dataset/plateau-27999-osaka-shi-2025"
TERMS = "https://gic-plateau.s3.ap-northeast-1.amazonaws.com/2025/expo-doc/3d-license/license.pdf"


def build(archive):
    width, height, last = 384, 256, 3
    with zipfile.ZipFile(archive) as z:
        names = sorted(n for n in z.namelist() if n.endswith(".tif"))
        assert len(names) == 6
        rectangles = []
        for name in names:
            with MemoryFile(z.read(name)) as memory, memory.open() as src:
                assert src.crs.to_epsg() == 6668
                rectangles.append(src.bounds)
        west, south = min(r.left for r in rectangles), min(r.bottom for r in rectangles)
        east, north = max(r.right for r in rectangles), max(r.top for r in rectangles)
        for name, rect in zip(names, rectangles):
            col = round(3 * (rect.left-west)/(east-west))
            row = round(2 * (north-rect.top)/(north-south))
            with MemoryFile(z.read(name)) as memory, memory.open() as src:
                rgb = np.moveaxis(src.read(), 0, -1)
            photo = Image.fromarray(rgb)
            # The black border lies outside the flown swath. Keep the base aerial visible there.
            photo.putalpha(Image.fromarray(np.any(rgb != 0, axis=-1).astype("uint8")*255))
            for level in range(last+1):
                span = 2**level
                layer = photo.resize((width*span, height*span), Image.Resampling.LANCZOS)
                for x in range(span):
                    folder = OUT/str(level)/str(col*span+x)
                    folder.mkdir(parents=True, exist_ok=True)
                    for y in range(span):
                        tile = layer.crop((x*width, y*height, (x+1)*width, (y+1)*height))
                        tile.save(folder/f"{row*span+y}.webp", quality=92, method=4)
        metadata = {"bounds":[west,south,east,north], "columns":3,"rows":2,
                    "width":width,"height":height,"maximumLevel":last,"source":SOURCE,"terms":TERMS}
        (OUT/"index.json").write_text(json.dumps(metadata,separators=(",",":"))+"\n", encoding="utf8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Official 27999 ortho ZIP")
    build(parser.parse_args().archive)
