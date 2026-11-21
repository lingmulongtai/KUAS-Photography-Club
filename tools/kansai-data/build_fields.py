"""Tile MAFF's 2026 paddy and field parcels for Shiga, Kyoto, Osaka, Hyogo and Nara.

Download and extract all split archives for prefectures 25 through 29 from SOURCE.
Run with Python 3.11+ and GDAL's ogr2ogr (FlatGeobuf, GEOS and MVT support):
    python tools/kansai-data/build_fields.py <shiga.fgb> <kyoto.fgb> <osaka.fgb> <hyogo.fgb> <nara.fgb>

Output is a gzip-compressed z12 XYZ Mapbox Vector Tile per occupied tile.
Layer "fields" uses integer attributes "pref" (25..29) and "kind" (1=paddy,
2=other field). The ID is the source file's feature number + 1,000,000 * pref;
fragments of one parcel on either side of a tile boundary retain the same ID.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import xml.etree.ElementTree as ET


SOURCE = "https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html"
OUT = Path(__file__).resolve().parents[2] / "public" / "kansai" / "fields"
ZOOM = 12
EXTENT = 16384
# Native IDs and an interior point from each source hole were checked against
# the packed polygons. These tiles contain parcels or holes too narrow for
# the normal grid and need finer coordinates to retain those features.
PRECISE_TILES = [(3576, 1625), (3583, 1625), (3585, 1631), (3586, 1616),
                 (3586, 1618), (3588, 1623), (3589, 1620), (3590, 1628),
                 (3591, 1627), (3591, 1630)]
PRECISE_EXTENT = 262144
# SHA256 of the unmodified FlatGeobuf and its 100 (paddy) / 200 (field) counts.
DATASETS = {
    25: ("e3b3d7ba984ab99732354e17be3a63254df84e347e7f4dc64111564e69f77d66", 269090, 95759),
    26: ("ba3ba6e4e0f242b82ad9885e50021f2392308297d2aece6aa550021d2aaac622", 204564, 132454),
    27: ("398e3f0d7557defb91ce2fd8b06a0665ea47bd1ec32fbe7aac7310451c3fe46c", 110329, 56031),
    28: ("f4435006300cada018380a102e29b6fbd80575996731aef97acd585dfbf8a550", 655829, 159426),
    29: ("18b07a3fcc833aed43bc0c0474abce20ee0688e61058dac3e453c88c74dc3a45", 169513, 73852),
}


def source_layer(files, destination):
    # Use the prefecture assigned by MAFF. Re-intersecting independent outlines
    # would truncate real parcels at the two releases' administrative boundaries.
    root = ET.Element("OGRVRTDataSource")
    union = ET.SubElement(root, "OGRVRTUnionLayer", name="fields")
    ET.SubElement(union, "PreserveSrcFID").text = "true"
    for (pref, (digest, _, _)), source in zip(DATASETS.items(), files, strict=True):
        with source.open("rb") as handle:
            if hashlib.file_digest(handle, "sha256").hexdigest() != digest:
                raise ValueError(f"Expected the 2026 prefecture {pref} FlatGeobuf: {source.name}")
        layer = ET.SubElement(union, "OGRVRTLayer", name=f"fields{pref}")
        ET.SubElement(layer, "SrcDataSource").text = str(source.resolve())
        ET.SubElement(layer, "SrcSQL", dialect="OGRSQL").text = (
            f"SELECT FID + {pref * 1_000_000} AS parcel, {pref} AS pref, "
            f'CAST(land_type / 100 AS INTEGER) AS kind FROM "MB0001_2026_2025_{pref}"'
        )
        ET.SubElement(layer, "FID").text = "parcel"
        for field in ("pref", "kind"):
            ET.SubElement(layer, "Field", name=field, type="Integer")
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)


def tile_bounds(x, y):
    count = 2 ** ZOOM
    def lon(col):
        return col / count * 360 - 180
    def lat(row):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / count))))
    return [lon(x), lat(y + 1), lon(x + 1), lat(y)]


def generate_tiles(ogr2ogr, source, destination, extent, bounds=()):
    # Disable tile-size-driven reduction. Regular tiles use a one-unit
    # simplification tolerance, about half a metre at Kansai latitudes.
    command = [ogr2ogr, "-f", "MVT", str(destination), str(source),
               "-preserve_fid", "-makevalid", "--config", "GDAL_NUM_THREADS", "4"]
    if bounds:
        command += ["-spat", *map(str, bounds)]
    for option in (
        f"MINZOOM={ZOOM}", f"MAXZOOM={ZOOM}", f"EXTENT={extent}", "BUFFER=0",
        "SIMPLIFICATION=1", "MAX_SIZE=33554432", "MAX_FEATURES=2000000",
        "COMPRESS=YES", "TILE_EXTENSION=pbf.gz",
    ):
        command += ["-dsco", option]
    subprocess.run(command, check=True)


def build(files, output, ogr2ogr):
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output, prefix=".build-") as scratch:
        work = Path(scratch)
        source_layer(files, work / "fields.vrt")
        generate_tiles(ogr2ogr, work / "fields.vrt", work / "tiles", EXTENT)
        tile_root = work / "tiles" / str(ZOOM)
        for x, y in PRECISE_TILES:
            detail = work / f"detail-{x}-{y}"
            generate_tiles(ogr2ogr, work / "fields.vrt", detail, PRECISE_EXTENT, tile_bounds(x, y))
            relative = Path(str(x)) / f"{y}.pbf.gz"
            (detail / str(ZOOM) / relative).replace(tile_root / relative)
        tiles = []
        for path in sorted(tile_root.glob("*/*.pbf.gz")):
            x, y = int(path.parent.name), int(path.name.split(".")[0])
            folder = output / str(x)
            folder.mkdir(exist_ok=True)
            path.replace(folder / path.name)
            tiles.append([x, y])
        if not tiles:
            raise ValueError("GDAL produced no parcel tiles")
        metadata = {
            "zoom": ZOOM,
            "extent": EXTENT,
            "highPrecisionExtent": PRECISE_EXTENT,
            "highPrecisionTiles": PRECISE_TILES,
            "layer": "fields",
            "kind": {"1": "paddy", "2": "field"},
            "parcelCounts": {pref: {"paddy": paddy, "field": field}
                             for pref, (_, paddy, field) in DATASETS.items()},
            "source": "農林水産省統計部「筆ポリゴンデータ（2026年）」を加工して作成",
            "sourceUrl": SOURCE,
            "tiles": sorted(tiles),
        }
        index = work / "index.json"
        index.write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + "\n",
                         encoding="utf-8", newline="\n")
        index.replace(output / "index.json")
        print(f"{len(tiles)} occupied parcel tiles, zoom {ZOOM}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs=5, type=Path)
    parser.add_argument("--output", type=Path, default=OUT)
    parser.add_argument("--ogr2ogr", default="ogr2ogr")
    args = parser.parse_args()
    build(args.files, args.output, args.ogr2ogr)
