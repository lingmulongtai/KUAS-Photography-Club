# 京都3Dの造形・構図・森林の改善

対象: `3527765` 以降。2026-10-14〜15、太秦キャンパスを含む京都Heroの改善。

## 変更と目的

- 市街・キャンパスの水平回転の制限を撤去。キャンパスは上空89°まで回れ、スマホでも「真上から」を選べる。
- 船岡山はキャンパスを中央付近へ移す。京都タワーは塔を外から見る構図へ変更。清水寺と塔は縦長画面で中央寄りに補正する。
- 京都タワーのホテル基壇、展望階の窓・縦桟・外装の継ぎ目を追加。金閣寺、清水寺の本堂・舞台・18本の柱、渡月橋を代表形状として追加する。
- 金閣寺の専用視点を追加。夜の大文字に斜面をたどる送り火のイメージを置く。
- 森林は航空写真の色に加え、OpenStreetMapの森林区域を使用。島・空地・独立した竹林も保持する。
- 木は全周に配置し、近景から遠景へ樹形を簡略化。詳細な枝葉はPC240m／スマホ160m、疎な森林群は10kmまで。768mの区画ごとに画面外を除外する。
- 森林の判定は2048pxラスタの一度の生成と定数時間の参照に変更。3視点分の配置だけ再利用し、古いインスタンスは解放する。
- 白い平屋根を落ち着いた仕上げへ変更し、壁の根元・軒下を陰影で区別。キャンパスのガラスと敷石、水面の細かい模様を画面上の大きさに合わせて平滑化する。
- 全17スポットにプレビューと静的な遷移先を用意。未記録の地点は明示的なイメージ用サンプルで、日付・人数・現地撮影写真を捏造しない。実記録が入れば優先する。
- 影は9点の明示的な深度参照に変更し、ANGLEの可変ループ勾配警告を解消。HDRのMSAAは2サンプル、継続して遅い場合だけ描画解像度を最大0.75まで下げる。

## 根拠とモデルの限界

- [京都タワー公式フロアガイド](https://www.kyoto-tower.jp/floorguide/): 展望階とホテル基壇の関係を参照。
- [金閣寺公式境内案内](https://www.shokoku-ji.jp/kinkakuji/guide/): 上2層の金色、屋根、鳳凰を参照。
- [清水寺公式歴史](https://www.kiyomizudera.or.jp/history.php): 約13mの舞台と18本の柱を参照。
- OpenStreetMapの金閣舎利殿way403406106と渡月橋way28640677を参照。橋軸約152.5m、幅約11m、方位約5.8°。金閣寺の旧ピンを約99m西へ修正する。
- 森林のOverpass取得時刻は2026-10-14T13:53:11Z。森林データは2,858ポリゴン、gzip405,535bytes、転送予算1MiB以内。© OpenStreetMap contributors／ODbL。
- OSMの森林区域の一部は2006年由来。現行のPLATEAU建物・国土地理院の道路・水域で植樹を除外するが、現地の最新植生の保証ではない。
- 造形は公式資料・公開地物から作ったローポリの代表形状。現地測量、実物テクスチャ、歴史建築の精密な復元ではない。キャンパスの構造データは保持し、質感を改善する。
- 地形の範囲は従来の30×27km。遠景の森林群は個々の樹木の実測位置ではなく、森林区域内の景観表現。大文字の個々の火床も代表配置で、実際の点火状況は表示しない。
- 新しい地点別プレビューのイラストは表示確認用。撮影会記事の写真とは区別する。

## 検証

- Node22.20／Astro7.3.4。各単位で`astro check`、配置・操作・データ境界の関連テストを実行する。
- `npm test`: 15件成功。360°と慣性、縦スクロールの維持、森林全周と候補数、建物の除外、森林の穴・竹林、17地点のURLと実記録優先を確認。
- `npm run check`: 117ファイル、error/warning/hint各0。
- `npm run build`: ASCIIの一時コピーでVercel用出力を生成。日本語OneDriveパスでは既存のネイティブプロセス終了が起きるため、ソースを維持したまま検証コピーを使う。
- PC実GPU: NVIDIA GeForce RTX4050 Laptop／ANGLE Direct3D11。全描画プログラムのコンパイルログに警告・エラーなし。
- 嵐山、通常アニメーション、単独の検証タブ、DPR1: 100フレームの間隔の中央値24.3ms（約41fps）、95パーセンタイル30.3ms。スマホ性能の代替にはしない。
- 初回の約14fps測定は複数の検証タブが同時に存在した条件。その後は単独タブで測定する。森林のLODとHDRのサンプル数も変更しているため、単一変更の改善率として扱わない。
- 8万点の森林ラスタ参照約2.8ms。初期実装で計測した木の配置全体約274ms、その後の配置再利用約29ms。これらはホストの一例で全端末の上限ではない。
- PCの各名所、北側のキャンパス構図、上空へのドラッグ、キャンパスのサンプルからの飛行をブラウザで確認。390pxの縦長画面で塔・寺院を確認し、横はみ出しを確認する。
- スケジュール、ガイドライン、連絡先、入部先、管理画面APIへの差分はなし。

## 公開の状態

今回の版のスマホ実機確認は未完了。前回A〜J版の「実機で問題なし」は今回の新しい造形・森林の合格として流用しない。
指示書の「PCとスマホの実機で確かめてからpush」に従い、今回の版の確認結果が揃うまでmainへpushしない。

## コミット列

SHA・件名・目的は下表。各単位の型チェック、関連テスト、staged diff確認後にコミットする。

| SHA | 件名 | 目的 |
| --- | --- | --- |
| 656a5ac | feat(hero): explore full turns and overhead campus views | Remove the horizontal stop so users can inspect the entire scene. Use a spherical campus orbit with near-overhead elevation, retaining damping, reduced motion and terrain-safe lower limits. |
| ce7d43d | fix(hero): compose landmarks and recenter campus surroundings | Show the full Kyoto Tower from an exterior viewpoint and aim Funaokayama toward the campus. Recenter terrain and vegetation when entering or leaving campus, and cover shadows around the full viewing circle. |
| 307e558 | feat(hero): grow continuous forests with distance-based detail | Cover the entire viewing circle, retain nearby trunks and use sparse low-detail outer rings with correctly bounded spatial chunks. Sample sharper imagery and exclude measured building footprints so added canopy does not grow through roofs. |
| 829060e | feat(hero): give Kyoto Tower a detailed architectural silhouette | Add the hotel podium, recessed windows, observation-deck frames, perimeter rings and shell seams. Separate glass from ivory surfaces and restrain deck lighting so the exterior viewpoint shows a readable landmark by day and night. |
| 2c6da02 | feat(hero): map woodland coverage independently of aerial colour | Use compact OSM multipolygons with retained holes to populate winter and shaded forests, including the verified Senkoji foreground. Bake terrain coverage once on the GPU, exclude current buildings, roads and water, and ship attribution and a reproducible bounded-data generator. |
| 03b80c0 | feat(hero): model the Golden Pavilion and add its garden view | Place the pavilion at its verified building footprint, with gold upper storeys, curved eaves, dark openings and a phoenix finial. Replace only overlapping city blocks and add a dedicated nearby composition. |
| dcbd0eb | feat(hero): frame Kiyomizu with its timber hall and stage | Show the hall, eighteen supporting columns, timber stage and city together in an exterior view. |
| ed5242d | fix(hero): preserve forest clearings and bound planting work | Retain multipolygon topology and independently tagged inner woods, respect water holes, and share a one-time 2048px raster between canopy shading and constant-time tree eligibility. |
| 0a65fd0 | feat(hero): span the Katsura River with Togetsukyo | Place the crowned deck, timber rails and river piers on the OpenStreetMap bridge axis. |
| 49369f3 | feat(hero): illuminate Daimonji fire beds in the night illustration | Follow the mountain slope with three fire-bed strokes and leave their forest clearing open. Label the night bonfire as an illustration. |
| 43ece12 | feat(hero): preview photography trips at every named spot | Provide seventeen honest sample fallbacks and stable detail pages while preferring real records. Keep campus flight available inside its accessible preview. |
| bbc644c | feat(hero): distinguish rooftops and refine campus glass | Use muted roof finishes and facade contact shading, with filtered mullions, paving joints and lit rooms that stay stable at a distance. |
| fc8f76b | fix(hero): filter river ripples before they become subpixel noise | Fade fine and distant waves using the pixel footprint so rivers and ponds remain calm instead of shimmering. |
| 70957f6 | fix(hero): separate cedar foliage from its slender trunk | Use explicit bark attributes so the base of a cedar canopy no longer becomes a giant brown cone, while near trees retain actual trunks. |
| aa6816d | fix(hero): keep the Kiyomizu hall inside the composition | Aim closer to the hall and lower the sightline after GPU review showed its roof cropped at the right edge. |
| 730babf | fix(trips): preserve a single main landmark on spot pages | The shared layout already owns the main landmark; place the sample content inside a section. |
| 13aa36c | perf(hero): reuse recent forests and align canopy coverage | Keep a bounded three-view instance cache and sample the same alpha coverage on the ground as tree placement. |
| 9f80c96 | fix(hero): recenter the landscape after interrupted flights | An in-progress flight may already have replanted at its destination; starting another flight must restore the requested landscape even when the preset name is unchanged. |
| 788f11a | fix(hero): frame close landmarks across screen sizes | Centre the tower and Kiyomizu more tightly in portrait layouts, aim Arashiyama toward Togetsukyo, and align its deck above the sampled riverbanks. |
| ab5979a | feat(hero): offer an overhead campus view on touch screens | Angle buttons expose the overhead orbit without capturing the vertical swipes that must continue scrolling the page. |
| 903a9df | fix(hero): keep Daimonji flames clear of coarse terrain and crowns | Widen the representative firebreak, raise flames above the triangulated slope and use the requested red night glow. |
| 8179be1 | feat(hero): extend lightweight forest clusters to distant hills | Continue tree silhouettes to ten kilometres with sparse low-detail clusters, keeping desktop candidates below 100000 and mobile below half that population. |
| 2a3a40a | fix(hero): make shadow filtering deterministic on ANGLE | Use nine explicit depth taps instead of the loop that produced divergent-gradient warnings on the RTX 4050 Direct3D renderer. |
| b521329 | perf(hero): reserve detailed foliage for the foreground | Limit detailed crowns to 240m on desktop and 160m on mobile, use two MSAA samples, and permit a bounded resolution fallback when a scene remains slow. |
| 18e59b6 | fix(hero): keep landmark strokes and edge labels legible | Face Daimonji from the west so the fire-bed strokes read clearly, and hide pins before their full labels are clipped at portrait edges. |
