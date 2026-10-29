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
- 「3D都市モデル（Project PLATEAU）京都市・大阪市（2025年度）」（国土交通省）を加工して作成。
  [PLATEAU Policy](https://www.mlit.go.jp/plateau/site-policy/)（CC BY 4.0 互換）
- Place coordinates checked with OpenStreetMap / Nominatim (© OpenStreetMap contributors, ODbL).

Both credits are shown in the site footer.

## 天王山・三川合流域

`python build_regions.py tennozan` は天王山から大山崎・八幡・島本方面にかけての建物輪郭、道路、鉄道、水域と広域写真を生成します。京都市内と重なる部分はPLATEAUの実測建物を優先し、残る国土地理院の輪郭には高さ6mまたは10mを割り当てます。国土地理院由来の高さは実測値ではありません。建物・道路・水面は一度に一地域だけ詳細表示します。京都南部の元データがキャッシュになければPLATEAUを取得してから重複を除きます。

国土地理院由来の建物は、天王山の展望地点から3.5km以内は20m²以上の輪郭を保持し、それより遠くは120m²以上に絞って形状も簡素にします。これは広い地域の転送量と表示負荷を抑えるための省略であり、遠方にある小さな建物の網羅はしていません。

`python build_tennozan_photo.py` は展望地点と合流部周辺の5km四方に、国土地理院のシームレス写真 z16を使ったより鮮明な写真を作ります。PC用760,000 bytes、スマホ用260,000 bytesが上限で、天王山への移動時に読み込みます。遠景の建物は `node --experimental-strip-types tools/kyoto-data/build-south-lod.mjs` で京都南部と三川地域から少数の代表建物を選び、詳細地域と重なる部分を隠します。

`python build_outer_terrain.py` は100m格子と広域写真を大阪方面まで延ばします。地図タイルの取得は生成時のみで、公開ページは地理院に直接アクセスしません。地域追加後は `python build_tunnels.py` で道路トンネルも更新します。

## 大阪方面の街並み

`python build_osaka_lod.py` は国土地理院の建物輪郭から250mごとの代表建物を選び、天王山から大阪中心部までの遠景を軽量に表示します。通常の建物の高さは6mまたは10mの概略値です。大阪市北区のPLATEAU 2025 LOD1のルートタイルから取得した高層建物13棟は実測高さを使い、重なる概略建物を除きます。ルートタイルのみを使い、子タイルと混在させません。遠景データはgzipで約64 KBです。

`python build_regions.py osaka` は大阪北部から梅田周辺の建物・道路・鉄道・水域と広域写真を生成します。大阪駅周辺は20m²以上の建物を保持し、駅から2kmより外は160m²未満の概略建物を間引いて形状を簡素化します。細い道路は駅から2.5km以内に残し、それより外は幅の広い道路を優先します。PLATEAUの実測建物が重なる場所では実測の輪郭を優先し、127.5mを超える高層建物は高さを保持できる遠景レイヤーで描画します。詳細地域は近づいた時だけロードし、重なる遠景の概略建物を隠します。地域の追加後は `python build_tunnels.py` を実行します。

大阪方面へ延長した100m標高格子の南西端には、取得元に標高がない範囲があります。その端だけは既存の標高からゼロへ補間しており、実測地形ではありません。地図・写真・都市モデルは生成時に取得し、公開ページから元のタイルサービスへ直接アクセスしません。

`python build_osaka_photos.py` は大阪詳細地域を4km四方の16区画に分け、国土地理院のシームレス写真 z16から近距離用写真を生成します。各区画はPC 1536²（約2.6m/画素）・スマホ768²（約5.2m/画素）、容量上限は760,000/260,000 bytesです。広域写真に重ねて接近した区画だけを表示し、表示中と先読みを合わせて最大2枚を保持します。天王山のビュー選択時に大阪地域と接近方向の写真を先読みし、自由散策では進行方向の地域も先読みします。

自由散策の地形更新は、手前の8m格子を世界座標に固定し、地形の差し替えで地表の三角形がずれる動きを抑えます。固定の展望ビューは元の細密格子を使用し、地形全体の頂点数は増やしません。

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
