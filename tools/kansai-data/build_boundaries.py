"""Build the five prefecture outlines from MLIT N03 municipal polygons (2026-01-01).
Requires shapely. Coordinates are WGS84-compatible JGD2011 longitude / latitude.
"""
import argparse
import io
import json
import zipfile
from pathlib import Path
from urllib.request import urlopen

from shapely import make_valid, union_all
from shapely.geometry import MultiPolygon, mapping, shape
from shapely.geometry.polygon import orient

OUT = Path(__file__).resolve().parents[2] / "public/kansai"
SOURCE = "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archives', type=Path, help='Directory containing the original N03 GML zip archives')
    archives = parser.parse_args().archives
    features = []
    for code in ("25", "26", "27", "28", "29"):
        name = f"N03-20260101_{code}_GML.zip"
        if archives:
            data = (archives / name).read_bytes()
        else:
            with urlopen(SOURCE + name, timeout=90) as response:
                data = response.read()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            geojson, = [p for p in archive.namelist() if p.lower().endswith(".geojson")]
            rows = json.loads(archive.read(geojson))["features"]
        # Preserve shared edges exactly. Simplifying each prefecture separately
        # previously turned slivers of land between Kyoto and Osaka into gaps.
        boundary = union_all([make_valid(shape(row["geometry"])) for row in rows])
        parts = boundary.geoms if hasattr(boundary, "geoms") else [boundary]
        polygon = MultiPolygon([orient(p, sign=1) for p in parts if p.geom_type == "Polygon"])
        features.append({"type": "Feature", "properties": {"code": code, "name": rows[0]["properties"]["N03_001"]},
                         "bbox": list(polygon.bounds), "geometry": mapping(polygon)})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "prefectures.json").write_text(json.dumps({"type": "FeatureCollection", "features": features},
                ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
