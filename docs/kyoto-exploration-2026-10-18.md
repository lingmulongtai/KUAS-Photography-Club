# 京都3Dの操作・景観・地域拡張（2026-10-18）

## 反映した内容

- スマホの2点ピンチを0.7〜3倍の範囲で受け付ける。片指が残っても回転やピン選択へ誤移行しない。1本指の横スワイプと縦のページスクロールの役割は維持。
- 龍安寺などの狭い山際でも、中心の建物を見失わないよう軌道と地形・樹冠のクリアランスを調整。
- 鴨川の水面・川床・岸を連続させ、デルタを保存。三条・五条を含む橋に床版・欄干・橋脚・取付勾配を追加し、車の高さも橋に合わせた。
- 御所、平安神宮、二条城、京都駅、東寺の主要堂、祇園、四条河原町を個別に作り込んだ。庭、中庭、駅の吹き抜けや大階段を単純な直方体で塞がない。
- 太秦の西門側に平屋のフューチャーセンターを追加。南館は階段の下も連続する建物にし、ユーザーの写真と確認に従い、**2階→3階だけ**両脇を北へ上がって中央を南へ折り返す。4階正面の部屋と5階屋上の人工芝を設け、1階→2階は維持。
- 亀岡キャンパスに15の主要施設、各棟の地盤高さ、通路、運動場を追加。亀岡・園部・山科・京都南部を地図から訪問できる。
- 嵐電2路線、阪急京都線・嵐山線、近鉄、JR京都―園部・京都―山科に線路、駅の簡易ホーム・上屋、動く編成を追加。地下・トンネル内では列車を描画しない。
- 月に合わせた季節と手動の春夏秋冬、紅葉、哲学の道南側の桜、積雪と降雪、清水寺の青い夜間光を追加。季節・光は景観演出で、当日の天気・開花・催事の情報ではない。
- 夜の窓の個体識別値をflat補間にし、カメラ移動で光る窓が変わる誤差を修正。既存の遠景の穏やかな明滅・柔らかなブルームと車の安定したライトは維持。
- デスクトップの小さな「自由に散策」から、ドラッグ、W/A/S/D、Q/E、Shift、ホイールで移動できる。Escで元の場所へ戻る。

## 軽量化とデータの境界

地域の建物・道路・航空写真は同時に1地域だけ保持する。高速な地点切り替えでは古い読み込みをGPUへ展開せず破棄し、退出時にテクスチャ・形状・道路の描画先を解放する。植生は直近3地点、地形の位置配列は4地点に制限。新地域を初期表示ですべて取得しない。

鉄道路線データはgzipで42,994 bytes。7区間は地理院の路線コードと接続点で抽出し、欠損を推測した直線でつながない。高架・地下はrailStateを保持する。snglDblの「駅」「側線」を複線として解釈しない。編成・速度・高架高さ・駅の細部は景観用の簡略表現で、時刻表や測量済みの軌道モデルではない。

亀岡・園部の一般建物は地理院の輪郭に6m/10mの代表高さを付けたもの。山科・南部はPLATEAUの実測高さを使用する。亀岡キャンパスは公式構内図・施設写真を基準にし、5棟の屋根と運動場3面にはOSMの輪郭を使用。その他の施設位置・寸法・高さは概略で、構内図との合わせ込みに約15〜25mの誤差があり得る。テニスの塗装面は航空写真からの概略（約±4m）で、未確認の6面配列を作らない。地形は10m、航空写真は最大1792×2048、スマホ版896×1024。運動場は実輪郭を細分化して地盤へ沿わせる。

寺社は公式案内図と実建物の輪郭・高さから特徴を表す低ポリゴンモデルで、文化財の測量復元ではない。ユーザーの階段画像は形状確認のみに使用し、画像そのものを公開テクスチャにしていない。新しい訪問地点にも架空の活動記録を追加していない。

## 検証

- Nodeの操作・形状・実データ・地域切り替えテスト、Astro型検査、production build、公開HTMLとJA/ENリンクの検証を実行。
- 実データの車11,837台を600秒シミュレーションし、京都御苑内への侵入0。烏丸・丸太町の公道は維持。
- WebGL2実描画で窓のflat補間後のハッシュ変動0を確認。`tools/window-stability-fixture.cjs` で再現可能。
- `tools/scenery-shader-fixture.cjs` は本番の木・雪・鉄道・青い光を実際にコンパイル・描画し、GPUエラー0と描画件数を確認する。季節の木のGLSL予約語による失敗もここで検出可能。
- Chromeの390px幅・2点タッチ入力で、ピンチ倍率約1.727、ページ倍率1、スクロール位置0。ピンチ後の1回の220px横スワイプは105.6度回転し、指を離すとdraggingが解除された。
- デスクトップで自由散策715m後の終了を確認。元のカメラ位置との差は数値誤差の範囲、GPUエラー0。桜・積雪と地域データの読み込みも画面で確認。
- これはブラウザ・タッチエミュレーションでの確認。iPhone/Safariや物理スマホの操作感・性能、現地寸法の最終受け入れは未実施。

## 主な出典

- [地理院データ](https://maps.gsi.go.jp/development/ichiran.html)、[ベクトル属性仕様](https://maps.gsi.go.jp/help/pdf/vector/attribute.pdf)、[PLATEAU](https://www.mlit.go.jp/plateau/)
- [亀岡キャンパス公式構内図・施設](https://www.kuas.ac.jp/campus/kameoka/campus-map/)、[OSMのライセンス](https://www.openstreetmap.org/copyright)
- [平安神宮の境内](https://www.heianjingu.or.jp/map/guide/)、[二条城](https://nijo-jocastle.city.kyoto.lg.jp/introduction/highlights/teien/)、[京都御所](https://kyoto-gosho.kunaicho.go.jp/pdf/1A1_ja.pdf)
- [東寺の伽藍](https://toji.or.jp/guide/)、[京都駅ビル](https://www.kyoto-station-building.co.jp/about/history/)、[駅の広場・大階段](https://www.kyoto-station-building.co.jp/service/square/)
- [祇園・花見小路](https://www.gion.or.jp/around/%E8%8A%B1%E8%A6%8B%E5%B0%8F%E8%B7%AF)、[哲学の道の桜](https://ja.kyoto.travel/flower/sakura/single.php?flower_id=1104)、[清水寺の青い夜間光](https://www.kiyomizudera.or.jp/event/yakan.php)

## 実装コミット

以下は実装順。各件名が独立した変更の目的を示す。履歴のamend・squash・rebase・force-pushは行わず、通常のマージで保持する。

<!-- implementation-commits -->

| SHA | 件名・目的 |
| --- | --- |
| [6c10ffd](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/6c10ffd) | feat(hero): support bounded two-finger view zoom |
| [8e891f8](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/8e891f8) | fix(hero): keep temple orbits clear of narrow hillsides |
| [04c7dde](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/04c7dde) | feat(hero): model the Future Center by the west campus gate |
| [4f60153](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/4f60153) | fix(hero): connect South Hall and correct its returning stairs |
| [eb54ed0](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/eb54ed0) | feat(hero): extend the mountain landscape through Sonobe and southern Kyoto |
| [b7aa74d](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/b7aa74d) | fix(hero): keep night window identities stable while the camera moves |
| [fc33037](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/fc33037) | refactor(geo): support bounded regional data without changing the city format |
| [879b764](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/879b764) | feat(geo): add detailed Kamo shorelines without replacing roads or railways |
| [9fa835b](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/9fa835b) | feat(geo): add bounded Kameoka Sonobe Yamashina and southern Kyoto assets |
| [bd4cb36](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/bd4cb36) | feat(hero): join Kamo water and banks beneath physical bridge decks |
| [6dec305](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/6dec305) | fix(hero): replace the low-rise Future Center regardless of building class |
| [50d4003](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/50d4003) | feat(hero): stream one neighbouring Kyoto region at a time |
| [a65d3f5](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/a65d3f5) | feat(hero): replace Toji hall blocks with timber and curved roofs |
| [0d40a52](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/0d40a52) | feat(hero): model Heian Shrine around its open precinct courts |
| [26a9094](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/26a9094) | feat(hero): add Imperial Palace halls gates and enclosing walls |
| [1df00b6](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/1df00b6) | feat(hero): shape Ninomaru Palace as its staggered timber halls |
| [bd9fa89](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/bd9fa89) | feat(hero): open Kyoto Station around its atrium and grand stair |
| [9f4dae8](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/9f4dae8) | feat(hero): add Honmaru halls and the surviving castle gates and turrets |
| [0c95d76](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/0c95d76) | feat(hero): detail the four Kawaramachi corners on measured footprints |
| [f898e40](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/f898e40) | feat(geo): resolve the Kameoka campus hillside at ten metre spacing |
| [134ddd3](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/134ddd3) | feat(hero): detail Gion along the measured Hanamikoji street |
| [ecdebf3](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/ecdebf3) | refactor(hero): share campus materials and configurable drawing frames |
| [a947a0b](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/a947a0b) | fix(hero): replace the fused east shrine block with lower service wings |
| [17b2cfb](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/17b2cfb) | feat(hero): model the fifteen main Kameoka campus facilities |
| [7adbb43](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/7adbb43) | feat(hero): follow the mapped Kameoka grounds along their hillside |
| [0bd4f9e](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/0bd4f9e) | feat(hero): make the detailed Kameoka campus a map destination |
| [f9f2ecb](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/f9f2ecb) | feat(hero): open Sonobe Yamashina and southern Kyoto from the map |
| [8507bf5](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/8507bf5) | feat(hero): run bounded railway consists on attributed Kyoto routes |
| [9593c52](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/9593c52) | feat(hero): offer discreet bounded desktop exploration |
| [6c9e69c](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/6c9e69c) | test(hero): keep the Honmaru court open beneath the sky |
| [0c70085](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/0c70085) | fix(hero): keep moving train faces outward under back-face culling |
| [109f9b7](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/109f9b7) | feat(hero): add seasonal foliage cherry scenery and quiet winter snow |
| [8f84cb6](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/8f84cb6) | feat(hero): cast Kiyomizu's blue light into the night sky |
| [7e2db67](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/7e2db67) | fix(hero): restore scenery and fly from the current exploration pose |
| [5b89297](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/5b89297) | fix(hero): give Kameoka sports grounds their sandy surface |
| [6b2f20b](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/6b2f20b) | fix(hero): compile seasonal foliage on WebGL2 and exercise scenery shaders |
| [e3fb1ba](https://github.com/lingmulongtai/KUAS-Photography-Club/commit/e3fb1ba) | fix(hero): settle Yamashina canals onto their mapped hillside bends |
