"""Pin the official 3D Tiles URLs and their culling bounds, grouped by prefecture and LOD."""
import json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen
from survey_regions import write_regions

API = "https://api.plateauview.mlit.go.jp/datacatalog/"
OUT = Path(__file__).resolve().parents[2] / "public/kansai/surveys"
CODES = ("25", "26", "27", "28", "29")
TYPES = {"bldg", "brid", "frn", "tran", "veg", "cons"}
# The official Expo archive is separate from Osaka's municipal survey catalogue.
# The Grand Ring is city furniture, while the pavilions are buildings.
EXPO_ASSETS = {
    "bldg": "7b/f67643-f9ad-40f9-8a83-7308c7e83748",
    "frn": "79/da1696-6197-4856-8876-4404af1bd499",
}


def expo_child(kind):
    uri = ("https://assets.cms.plateau.reearth.io/assets/" + EXPO_ASSETS[kind] +
           "/27999_osaka-shi_city_2025_citygml_1_op_" + kind + "_lod3/tileset.json")
    root = fetch(uri)["root"]
    assert root["children"] and root["content"]["uri"].endswith(".b3dm")
    return {"boundingVolume": root["boundingVolume"], "geometricError": root["geometricError"],
            "content": {"uri": uri}}


def fetch(url):
    with urlopen(url, timeout=90) as response:
        return json.load(response)


def build():
    catalogue = fetch(API + "plateau-datasets")
    best = {}
    for row in catalogue["datasets"]:
        if row["pref_code"] not in CODES or row["type_en"] not in TYPES or row["format"] != "3D Tiles":
            continue
        key = (row["pref_code"], row["type_en"], int(row["lod"] or 0), row["ward_code"] or row["city_code"])
        if key not in best or (row["year"], row["texture"]) > (best[key]["year"], best[key]["texture"]):
            best[key] = row
    groups = defaultdict(dict)

    def resolve(item):
        key, row = item
        root = fetch(row["url"])["root"]
        assert "region" in root["boundingVolume"] and row["url"].startswith("https://")
        child = {"boundingVolume":root["boundingVolume"], "geometricError":root["geometricError"],
                 "content":{"uri":row["url"]}}
        return key, row, [child]

    credits = defaultdict(set)
    with ThreadPoolExecutor(max_workers=6) as pool:
        for (pref, kind, lod, city), row, children in pool.map(resolve, sorted(best.items())):
            credits[pref].add(row["city"])
            group = groups[pref, kind, lod]
            for child in children:
                group[child["content"]["uri"]] = child

    for kind in EXPO_ASSETS:
        child = expo_child(kind)
        groups["27", kind, 3][child["content"]["uri"]] = child

    OUT.mkdir(parents=True, exist_ok=True)
    layers = []
    for (pref, kind, lod), refs in sorted(groups.items()):
        children = list(refs.values())
        boxes = [c["boundingVolume"]["region"] for c in children]
        bounds = [(min if axis in (0, 1, 4) else max)(b[axis] for b in boxes) for axis in range(6)]
        name = f"{pref}-{kind}-{lod}.json"
        root = {"boundingVolume": {"region": bounds}, "geometricError": 50000, "refine": "ADD", "children": children}
        (OUT / name).write_text(json.dumps({"asset":{"version":"1.0"},"geometricError":50000,"root":root}, separators=(",",":")))
        layers.append({"pref":pref,"kind":kind,"lod":lod,"file":name,"sources":len(children)})
    (OUT / "index.json").write_text(json.dumps({"layers":layers,"cities":{c:sorted(credits[c]) for c in CODES}},
                                              ensure_ascii=False,separators=(",",":")),encoding="utf-8")


if __name__ == "__main__":
    build()
    write_regions()
