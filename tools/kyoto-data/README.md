# Kyoto data for the top page

The 3D Kyoto on the top page is built from real geodata. These scripts download the
sources once into `cache/` (not committed, about 2 GB) and write compact files to
`public/kyoto/`, which the browser loads.

| File in `public/kyoto/` | What | Source |
| --- | --- | --- |
| `terrain-far.bin` | Elevation every 30 m over 30 × 27 km (Atago to Hiei, Kitayama to Otokoyama) | GSI 標高タイル (DEM10B) |
| `terrain-near.bin` | Elevation every 10 m around Higashiyama and the viewpoint | GSI 標高タイル (DEM5A, DEM10B where missing) |
| `aerial-wide.webp`, `aerial-city.webp` | Aerial photos draped over the terrain | GSI 全国最新写真（シームレス） |
| `aerial-arashiyama*.webp`, `aerial-higashiyama*.webp` | Sharper photos of Arashiyama and of the slopes below Shogunzuka and Kiyomizu-dera, PC and mobile sizes | GSI 全国最新写真（シームレス） z16 / z17 |
| `lines.bin` | Roads (by width), above-ground railways, rivers and ponds | GSI ベクトルタイル |
| `tunnels.json.gz` | Road tunnel centre lines over the core and every region (8.5 KB); the browser cuts these stretches out of the roads so none is painted over a mountain | GSI ベクトルタイル (ftCode 2704/2714/2724) |
| `buildings.bin` | Selected building footprints and measured heights; dense detail near viewpoints and KUAS--Arashiyama | PLATEAU 京都市 2025 LOD1 |

The scene uses local metres on a plane tangent at Shijo-Karasuma (+x east, +z south,
+y metres above sea level); `region.py` and `src/scripts/hero/geo.ts` must agree.

## Rebuild

```sh
pip install numpy pillow shapely mapbox-vector-tile DracoPy
python3 fetch.py gsi          # ~400 map tiles
python3 fetch.py plateau      # PLATEAU LOD1 tiles, read straight out of the 2.4 GB archive with range requests
python3 build_terrain.py
python3 build_lines.py
python3 build_tunnels.py     # after build_lines / build_regions; never rewrites lines*.bin
python3 extract_buildings.py  # decodes the tiles into cache/buildings.pkl
python3 build_buildings.py
python3 -m unittest discover -s . -p 'test_*.py'
```

The building exporter keeps houses of at least 14m² within 1km of the KUAS--Togetsukyo
corridor; small open sheds remain excluded. This area also uses the near-viewpoint
outline tolerance (0.6m) and rectangle fit threshold (0.86). Ground offsets blend
the far, near and Arashiyama regional grids in the same order as `heightfield.ts`.
The 2026-10-17 rebuild contains 282,150 buildings in 1,972,029 gzip bytes.
See [the model/night quality audit](../../docs/model-night-quality-2026-10-17.md).

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
# 森林の輪郭

`build_woodland.py` の冒頭にあるOverpassクエリで `natural=wood` / `landuse=forest` のwayとrelationを取得し、ローカルに保存したJSONを渡します。

```sh
python build_woodland.py /path/to/overpass.json
```

relationの外周・穴は元の形状を保持し、単独wayだけ2m許容で簡略化して `public/kyoto/woodland.json.gz` を生成します。独立した森林タグを持つinner wayも保持します。1MiBを上限とし、2026-10-14のデータは405,535 bytes。描画時にAPIを呼び出しません。© OpenStreetMap contributors / ODbL。一部は2006年の森林データ由来なので、PLATEAUの建物と国土地理院の道路・水域（島の穴を保持）で植樹を除外します。

2048pxの森林ラスタを一度だけ作り、地面の森の色と木の配置が同じalphaを参照します。樹形は距離で簡略化し、PCの詳細な枝葉は240m、スマホは160mまで。遠景の疎な森林群は10kmまで続きます。最近の3視点だけ配置バッファを保持し、古い配置は解放します。

## 嵐山の局所データ

`python build_arashiyama.py` は千光寺・渡月橋を含む4×4kmだけを取得します。
GSI seamlessphoto z16からPC2048²・スマホ1024²のWebP、DEM5A z15（欠損時DEM z14）から10m格子、水域z16から島の穴を保持した輪郭を生成します。
写真は1MiB/320KiB、標高350,000 bytes、水域gzip256KiBを上限とし、標高・写真の欠損はビルドを失敗させます。
水域パッチは元の `lines.bin` のSHA256、展開後チェックサム、置換する水域のindexを持ち、対象boxの外側は元の水域を保持します。道路・線路・建物のバイナリは再生成しません。
NumPy、Pillow、Shapely、mapbox-vector-tileが必要です。生のタイルは既存の `cache/` に保存し、公開ページから地理院へリクエストしません。既存の国土地理院クレジットを適用します。

## 東山（将軍塚・清水の舞台の手前）の局所写真

`python build_higashiyama.py` は、鴨川・祇園から将軍塚の背後まで、岡崎の南端から清水寺の下の斜面までの2.0×2.6km（ローカル座標 `[1000,-1000,3000,1600]`）の写真だけを取得します。
国土地理院のシームレス写真 z17（約0.98m/画素、108タイル）を画素中心で2倍に標本化してLanczosで縮小し、PC用1576×2048（約1.27m/画素）とスマホ用788×1024のWebPを生成します。
上限はPC 760,000 bytes、スマホ 260,000 bytesで、品質80から2ずつ下げて収めます。2026-10-17のデータはどちらも品質76で、743,638 bytesと240,998 bytes。写真タイルの欠損はビルドを失敗させます。
標高（`terrain-near.bin` が既に10m間隔）、道路・鉄道・水域・建物のバイナリは再生成しません。NumPyとPillowが必要です。生のタイルは既存の `cache/` に保存し、公開ページから地理院へリクエストしません。
出典は国土地理院「地理院タイル（全国最新写真（シームレス））」で、上記の既存クレジットと[地理院タイル利用規約](https://maps.gsi.go.jp/development/ichiran.html)に従います。
