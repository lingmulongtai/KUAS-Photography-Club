# A〜J 実装・検証記録（2026-10-14）

対象は `lingmulongtai/KUAS-Photography-Club` の `main`。開始時に `git pull --ff-only` で `84626e77dd97735fff7800e125eb673c8f5337cf` へ更新した。作業開始時の未コミット変更はなし。同じフォルダにある旧 `Photography-Club-Website` は変更していない。

## 実装

| 項目 | 結果 |
| --- | --- |
| A | 道路の距離場を水面にも共有し、橋の道路・車が水に隠れる箇所を抜いた。夜の反射光を18%上げ、発光・露出は維持。影とブルームのループは明示的なLODで読み、逆順のsmoothstepを修正。 |
| B | マウスドラッグ・横スワイプ、左右±75°・上下−25°〜12°、減衰する慣性、キャンパスの周回、視点変更時のリセット。6px未満のタップ、縦スクロール、ピン操作を保持。流れ星の方角を実際のカメラから算出。 |
| C | 国土地理院の航空写真を追加（4096×3687、2,902,028 bytes）。PCは高解像度、軽量モードは既存2048px。森の色と都市範囲外の木の色取得を改善。地形・建物・道路データは維持。 |
| D | 大悲閣千光寺から東、船岡山から南の視点。座標はOSMのnode 4323065493 / 6611051734を確認。既存の影範囲・植樹・ピン遮蔽の調整経路を利用。 |
| E | 自然な流れ星の間隔を長くし、尾・光・きらめきを抑えた。空のタップを保持し、powの入力をclamp。 |
| F | 任意のspot、認識済みIDの検証、管理画面の選択とピンだけの保存。写真だけの追加時は既存ピンを保持。地名ピンに最新3件までの写真・クレジット・撮影会リンクを表示。 |
| G | トップの最近の撮影会を、既存トークンとティール色に合わせた写真カードへ。PCは3列、狭い画面は1列。サンプル表示・撮影者クレジットを保持。 |
| H | 本サイト自身の呼称を写真部に統一。将来の昇格目標を除き、沿革は保持。規約本文は変更せず、11言語の確認事項を別紙に記録。 |
| I | 提供されたKPCロゴの髪・白い服・手持ちカメラを手続き的な3Dキャラクターにした。元の石膏像も選択可能で、必要時に読み込み・ライセンス表示。障子／奥行きのある森／夜の街・玉ボケを選択可能。 |
| J | シャッター・絞り・ISO・ピント・焦点距離に標準段のダイヤルとLCD表示。ドラッグ、ホイール、矢印/Home/Endキー、role=sliderとaria-valuetext。自動設定・プリセットも同期。絞り比較時は自動ピントを停止。 |

## 検証

- `npm test`: 8件成功。回転範囲・フレームレートに依存しない慣性・reduced motion、外側でのマウス解放、タップ／横ドラッグ／縦スクロール、ピンの追加／保持／変更／解除／不正ID、標準段とプリセットを確認。
- `npm run check`: 104ファイル、errors/warnings/hintsすべて0。
- `npm run build`: Vercel出力の静的ページと管理APIのバンドルまで成功。新しい本番用HTMLに3件のspot関連づけがあることを確認。
- Pythonの写真生成処理を実行し、WebPの寸法と3MiB上限を確認。追加画像は約2.77MiB。新たなnpm依存の追加なし。
- Windowsの元の日本語OneDriveパスでは、変更前もAstroビルドがネイティブ終了コード0xC0000409で終了した。環境変数ファイルを含めずASCIIの一時フォルダへコピーし、同じソース・lockfileで上記ビルドを通した。
- 開発サーバーのコンテンツキャッシュでspotが欠落する状態を確認したため `astro sync --force` を実行。本番用出力を別途配信し、以下のピン導線を検証した。生成物・キャッシュはコミットしていない。
- PCのChromeで、NVIDIA GeForce RTX 4050 Laptop GPU / ANGLE D3D11とWebGLエラー0を確認。修正後の新しい検証ページではWebGL警告なし。京都タワー昼／夜、各視点、ドラッグによる向きの変化、reduced motionでの視点切替を確認。
- 京都タワー昼景の短いrequestAnimationFrame計測：44間隔、中央値24.3ms、95パーセンタイル36.5ms。測定時のPCと負荷に限る参考値。
- 河原町のピン→サムネイル・サンプル／クレジット→撮影会ページの遷移、Escapeで閉じる動作を確認。非表示ピンはinert・tabIndex=-1。
- ローカル管理画面のデモで、ログイン→既存撮影会→写真0枚・spot=gion→公開されないプレビューの成功→ログアウトを確認。本番の管理画面への書き込みは行っていない。
- 石膏像の実際の読み込み、提供ロゴを元にしたキャラクター、森・夜の背景、85mmプリセット、焦点距離の矢印操作、ボケのホイール操作と手動ピント保持を確認。
- 露出ダイヤルのドラッグでISO100→800、ISO自動合わせで100・適正露出へ戻ることを確認。キーボード操作とaria-valuetext／内部input値の同期も確認。
- 390px幅で撮影会カードは幅343pxの1列、クレジット3件を保持し横にはみ出さない。学習ページのダイヤルと選択肢も存在。これはPCブラウザの幅検証。
- **スマホ実機:** ユーザーから「スマホ実機で問題なく動いた」との報告を受領。こちらから端末機種・FPSを測定したものではない。
- 連続したページ遷移中にChromeの `AbortError: Transition was skipped` を1件記録した。既存のCSS view transitionに関するもので、遷移先・3D表示は成功。WebGLエラーとは区別する。
- 全diff・コミット列を確認。スケジュール関連ファイル・規約本文・認証処理・連絡先・入部先は変更していない。一時デバッグフックをソースと検証用コピーから除去。secret・環境変数・キャッシュ・ビルド出力は含まない。

## コミット列

各変更の最小関連チェックを行ってから、対象だけをstageしstaged diffを確認してコミットした。最終共通チェックは上記のtest / check / build。規約確認事項は [guideline-wording-review.md](./guideline-wording-review.md)。

| SHA | 件名 | 目的 |
| --- | --- | --- |
| 6a363b9 | fix(hero): keep bridge roads visible across water | 橋で道路と車が水面に隠れる問題を解消 |
| 193b259 | fix(hero): lift reflected night light gently | 夜の発光を増やさず未照明面を読みやすく |
| 4e29a51 | feat(hero): look around with drag and horizontal swipe | 見回しとタップ・スクロールの共存 |
| f3368cd | build(kyoto): bound mountain imagery downloads | 写真だけを再生成し追加容量を制限 |
| 6930d01 | feat(kyoto): add sharper aerial imagery for the basin | 山を含む盆地の高解像度写真 |
| f378c1f | fix(hero): sample shadow depth without implicit gradients | 影のフィルタで未定義の微分を回避 |
| ced4239 | feat(hero): show clearer and warmer mountain terrain | PC画質と軽量モードを両立 |
| 73a6bc7 | feat(hero): view Kyoto from Arashiyama and Funaokayama | 西・北からの眺め |
| 09ed847 | fix(hero): make shooting stars more restrained | 自然な頻度と控えめな光 |
| 5ffe34c | feat(trips): validate and retain optional place pins | ピンの保存契約と互換性 |
| 6ff12d5 | feat(admin): choose and update trip place pins | 管理画面での場所選択 |
| ef3e524 | feat(hero): open trip previews from place pins | 地名から撮影会への導線 |
| 3ba77e2 | feat(home): align recent trips with the teal site design | 最新撮影会のブランド統一 |
| db0fbdb | docs(club): use the current photography club status | 写真部の現状に呼称を統一 |
| ecb4667 | feat(learn): choose a sculpted photographer or plaster bust | ロゴを元にした被写体と石膏像の選択 |
| 11204af | feat(learn): compare depth against forest and night backgrounds | 圧縮効果を奥行きのある背景で比較 |
| 9397123 | fix(admin): preserve pins during photo-only saves | 古い画面からの写真追加でピンを上書きしない |
| 7dda9a1 | fix(hero): end short mouse gestures outside the stage | 画面外での解放後にドラッグが残る問題を解消 |
| cda8184 | fix(hero): hide offscreen pins from assistive navigation | 隠れたピンにキーボードで移動しない |
| 4fe355f | feat(learn): adjust exposure with camera-style dials | 露出3要素をダイヤルで操作 |
| ef25f0f | feat(learn): turn focus and aperture with lens dials | ピント・絞り・焦点距離を標準段で操作 |
| 4e6604c | fix(learn): hold focus while comparing apertures | 絞り比較中のピントを固定 |
| aa78dbe | feat(learn): read exposure on a camera-style LCD meter | 露出計のLCD表示 |
| 1814c2e | fix(hero): make postprocessing shader sampling deterministic | ブルームと周辺減光の未定義挙動を回避 |

## 残る確認範囲

PCの観測とユーザーのスマホ報告は、すべてのGPU・端末でちらつきが起きない保証ではない。長時間の描画やスマホ機種ごとのFPS、すべての交差点・橋の画質は網羅していない。本番管理APIのGitHub書き込みは、実コンテンツを変更するため未実行。規約の呼称・昇格表現はオーナーの文書判断を待つ。
