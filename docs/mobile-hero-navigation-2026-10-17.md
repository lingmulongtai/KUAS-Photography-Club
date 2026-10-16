# ホームの3D操作・地点移動の改善

## 操作

- 横ドラッグ／横スワイプで360°操作。縦スワイプは従来どおりページをスクロールする。
- 将軍塚・大文字山・嵐山の大悲閣・愛宕山は、観測位置を動かさず景色を見回す展望ビュー。船岡山は愛宕山に置き換えた。
- 地図のラベルを短くタップすると、その地点に移動。ラベル上から横スワイプを始めても回転でき、スワイプ終了時には地点移動を発火させない。
- 地図のスポットは、選んだ構造物／場所を中心とする周回カメラ。太秦キャンパスの既存カメラも維持する。愛宕山は展望ビュー、嵐山の地図ピンは渡月橋に対応する。
- ラベルが重なる／画面外にある場合も「スポットへ移動」から全18地点を選べる。移動後に活動記録を開ける。英語ページでは英語の記録一覧へ案内する。
- 「展望へ戻る」、キャンパスの戻るボタン、Escapeで直前の展望に戻る。戻り先のVIEWボタンへフォーカスも戻す。

VIEWには展望地点だけを並べる。京都タワー・清水寺・金閣寺はスポット側へ整理した。平安神宮のカメラは既存の大鳥居モデル、京都御所は紫宸殿、龍安寺は方丈を中心にする。

## スワイプが小さく止まった原因

タッチでは子canvasに暗黙のpointer captureが入る。最初の移動で外側のstageへcaptureを移すと、canvasの `lostpointercapture` がstageへバブルした。その通知でstage自身のドラッグまで終了していた。

子要素からのcapture喪失を終了扱いしないようにした。390px幅の実ブラウザで230pxを10段階に分けてスワイプすると、修正前は最初の23px分の約10.615°、修正後は全230px分の約106.154°を反映した。感度を上げて症状を隠す変更はしていない。

入力の符号はカメラの種類に応じて決める。見回しは右ドラッグで方位角を減らし、周回は増やす。これによりPCの見回しとスマホの周回の向きを修正し、PCの周回・スマホの見回しの方向は保った。

## 地点と描画

- `src/data/spots.ts` が地点ID・ラベル・緯度経度の共有元。
- `src/scripts/hero/views.ts` が展望・周回のカメラ定義と地図からの対応付け。
- `src/scripts/hero/pin-layout.ts` は文字ラベルと44pxタップ領域を含む衝突判定。キャンパスの大きなラベルで別地点のタップを遮らない。
- 地形の先読みは展望地点に限定。未訪問の全スポットを起動直後に生成しない。同一サイズの地形は既存のGPU属性を更新して使う。

京都御所の主要建物は既存の建物データに含まれていなかったため、紫宸殿の簡略モデルを補った。位置・約43×35mの外形は[OSM way 554905814](https://www.openstreetmap.org/way/554905814)、正面九間などの建物の特徴は[宮内庁の紫宸殿解説](https://kyoto-gosho.kunaicho.go.jp/building/2A1)を確認した。高さ・屋根・細部は表現上の近似であり、測量モデルや御所全体の精密再現ではない。

龍安寺はユーザーに名称を確認済み。[OSM way 374564926](https://www.openstreetmap.org/way/374564926)の方丈位置を使う。既存の地形・航空写真・建物データと出典表記は維持している。

## 検証

- `npm test`：51件成功。
- `npm run check`：152ファイル、エラー・警告・ヒント0件。
- Astroビルド完了、`node tools/verify-public-build.mjs`：44 HTMLファイル、全地点の記録ページ・日英の展望ボタンと地点選択を確認。サンプル活動記録の非公開も維持。
- ローカルのビルド実行環境はNode 24。既存CIのNode 22による検証もPRで実行する。
- Headless Edgeの実WebGLカメラ行列で、PCの230px右ドラッグを確認。1440px幅の見回しは約−28.75°、周回は約＋28.75°。見回しでは観測位置が変わらない。
- CDPのネイティブtouch入力、390px幅で230pxスワイプを4回。見回しは約＋424.615°、京都タワー・キャンパスの周回は約−424.615°。一周を超えて継続できる。縦スワイプではページが259pxスクロールした。
- 京都タワーの実際の地図ラベルをクリックして移動し、元の展望とキーボードフォーカスに戻れることを確認。390px幅では祇園のラベルをネイティブtouchでタップして移動できた。
- 18地点への移動、移動中の地点選び直し、日英の記録リンクを確認。京都タワー・京都御所・龍安寺では実カメラ行列を読み、斜め／真上の切り替えと地点中心への向きを確認。
- 18地点を巡っても地形用の約4.93MBのGPUバッファ新規確保は1回。地点変更では同じ属性を更新する。
- 1440px／390px／320px幅を確認。390px日本語・320px英語に横方向のページあふれなし。検証したページの実行時エラー0件。WebGL非対応時は操作UIを隠し、通常の案内リンクを使える。

ブラウザのタッチ入力検証はスマホ実機での検証ではない。iOS Safari・Android端末の操作感、発熱、端末固有の性能は未検証。モデルは既存サイトと同じく簡略表現で、現地の見通しや立入可能位置の保証には使わない。

## 実装コミット

| SHA | 件名 | 目的 |
| --- | --- | --- |
| `1b66298` | fix(hero): keep touch swipes active across pointer capture transfers | 最初の移動でスワイプが切れる原因を修正 |
| `803ed9e` | fix(hero): match drag direction to viewpoint and orbit cameras | カメラの種類ごとに操作方向を修正 |
| `05f2e01` | refactor(hero): share camera destinations with navigation and tests | カメラ定義をUI・検証と共有 |
| `049e984` | feat(hero): replace Funaokayama with an Atago panorama | 船岡山を愛宕山の展望へ置換 |
| `f85e0fb` | feat(hero): define centred camera destinations for every map spot | 全地点の周回カメラと龍安寺を追加 |
| `392425a` | feat(hero): fly to map spots and separate scenic viewpoint controls | 地図タップ・選択メニュー・戻る操作を統合 |
| `d98bb4f` | feat(hero): give the palace destination a Shishinden landmark | 平面だった御所の中心に主要建物を補完 |
| `44808e0` | fix(hero): keep map labels clear of other tap targets | 重なるラベルによる誤タップを防止 |
| `59cb6b6` | fix(hero): preserve the palace hall's nine front bays | 正面九間の形状を修正 |
| `f0dbdc9` | fix(hero): let map pin swipes rotate without triggering navigation | ラベル上のスワイプと短いタップを分離 |
| `5c1cc62` | perf(hero): reuse terrain buffers and defer unvisited map meshes | スポット移動時のGPU資源増加・先読み負荷を抑制 |
