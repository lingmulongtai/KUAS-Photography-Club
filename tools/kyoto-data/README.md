# Kyoto data for the top page

The 3D Kyoto on the top page is built from real geodata. These scripts download the
sources once into `cache/` (not committed, about 2 GB) and write compact files to
`public/kyoto/`, which the browser loads.

| File in `public/kyoto/` | What | Source |
| --- | --- | --- |
| `terrain-far.bin` | Elevation every 30 m over 30 × 27 km (Atago to Hiei, Kitayama to Otokoyama) | GSI 標高タイル (DEM10B) |
| `terrain-near.bin` | Elevation every 10 m around Higashiyama and the viewpoint | GSI 標高タイル (DEM5A, DEM10B where missing) |
| `aerial-wide.webp`, `aerial-city.webp` | Aerial photos draped over the terrain | GSI 全国最新写真（シームレス） |
| `lines.bin` | Roads (by width), above-ground railways, rivers and ponds | GSI ベクトルタイル |
| `buildings.bin` | Every building's footprint and measured height | PLATEAU 京都市 2025 LOD1 |

The scene uses local metres on a plane tangent at Shijo-Karasuma (+x east, +z south,
+y metres above sea level); `region.py` and `src/scripts/hero/geo.ts` must agree.

## Rebuild

```sh
pip install numpy pillow shapely mapbox-vector-tile DracoPy
python3 fetch.py gsi          # ~400 map tiles
python3 fetch.py plateau      # PLATEAU LOD1 tiles, read straight out of the 2.4 GB archive with range requests
python3 build_terrain.py
python3 build_lines.py
python3 extract_buildings.py  # decodes the tiles into cache/buildings.pkl
python3 build_buildings.py
```

## Credits and licences

- 国土地理院（地理院タイル：標高タイル、全国最新写真（シームレス）、ベクトルタイル提供実験）を加工して作成。
  [地理院タイル利用規約](https://maps.gsi.go.jp/development/ichiran.html)
- 「3D都市モデル（Project PLATEAU）京都市（2025年度）」（国土交通省）を加工して作成。
  [PLATEAU Policy](https://www.mlit.go.jp/plateau/site-policy/)（CC BY 4.0 互換）
- Place coordinates checked with OpenStreetMap / Nominatim (© OpenStreetMap contributors, ODbL).

Both credits are shown in the site footer.

## Mountain imagery only

```sh
python3 fetch.py photos
python3 build_terrain.py --photos-only
```

This uses GSI seamlessphoto zoom 14 for the same 30 × 27 km area, at
4096 × 3687 pixels (about 7.3 m/pixel). The additional WebP is capped at 3 MiB.
Missing source tiles fail the build instead of becoming black patches.
The existing 2048-pixel wide image remains the lightweight mobile variant.
Elevation, building and road binaries are unchanged by these commands.
