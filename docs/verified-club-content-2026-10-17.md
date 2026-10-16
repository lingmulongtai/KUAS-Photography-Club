# 公開情報整理・日英対応の検証記録

確認日：2026年10月17日（日本時間）

PR：[日英対応と公開情報の整合](https://github.com/lingmulongtai/KUAS-Photography-Club/pull/3)

## 変更と公開範囲

- `src/lib/public-content.ts`、`trips.ts`、`schedule.ts`：サンプル・下書きを公開取得時に除外。トップ、詳細ルート、フィルム、3D地点、管理画面の埋込データも対象。
- `src/content/schedule/2026-10.md`：10月23日の休会のみを確認済みのお知らせとして掲載。仮の10月・11月予定は公開しない。定例会の個別日程は自動生成しない。
- `src/data/club.ts`、紹介・入部・問い合わせ・ヘッダー・フッター：74名（2026年10月現在）、半期1,000円、金曜18:00・通常S306の案内を整合。見学申込み、正式入部、連絡用チャットを区別。
- `guidelines/`：現在の案内を日英で整理。2025年版は履歴資料として保存し、未更新9言語の公開ルートを停止。正式規程の改定承認済みとは表示しない。
- `src/pages/en/`、`src/lib/i18n.ts`、`src/scripts/language.ts`：主要本文の英語版、ヘッダー切替、初回の対応ブラウザ言語判定、手動選択の保存。保存拒否時はURLで選択を引き継ぐ。既存の英語ガイドラインURLを維持。
- 学習ページ：花火の明るさ・光跡、回折、スマホの自然なボケ、セーフライト指定条件・テスト、薬液回収を修正。簡易デモとプログラムで描いた図解の用途を明示。404ページの暗室デモにも表示。
- `tools/verify-public-build.mjs`、CI：公開HTML・リンク・日英ルート・仮データの再混入を検査。

## 実施した確認

| 確認 | 結果 |
| --- | --- |
| `npm test` | 42件成功 |
| `npm run check` | 148ファイル、エラー・警告・ヒント0 |
| ローカルVercelビルド | 同一lockfileのNode 24.19.0でFunctionsと静的資材の生成まで成功 |
| 公開出力検査 | 43 HTML、サンプル撮影会6件と旧翻訳9言語のルートなし、リンク整合 |
| Ubuntu / Node 22 CI | [実装コミット eb2e34b のCI](https://github.com/lingmulongtai/KUAS-Photography-Club/actions/runs/38954108640)で依存導入・42テスト・型チェック・ビルド・公開出力検査がすべて成功 |
| Vercelプレビュー | 実装コミット eb2e34b のデプロイ成功をGitHubのVercelチェックで確認 |
| ブラウザ | Windows上のheadless Edge。日英24ルートを確認。ページ例外0、ローカル資材のHTTP失敗0、1440px幅の横スクロールなし |
| スマホ幅 | 390×844のブラウザ表示で日英入部・英語トップ・英語ガイドライン、ヘッダー言語ボタン、メニュー開閉と移動を確認。横スクロールなし |
| 初回言語・保存 | ja-JP / en-US / fr-FR、手動切替・再読み込み後保持・ガイドライン本文タブを確認 |
| 保存拒否 | localStorageを拒否したブラウザでも切替と次ページへの日本語選択継承が成功 |
| 3D | 日英トップの描画完了、夜への切替を確認。地点の中立案内・キャンパスへの移動と戻る操作も確認 |

ブラウザ確認は生成済みのローカル静的サイトに対して実施したものです。スマホ実機での受け入れ確認とは区別します。D3Dのシェーダー最適化に関する警告はありましたが、ページ例外や描画失敗は確認していません。

システムのNode 22.20.0では、Windows上のビルドがプリレンダリング後に0xC0000409で異常終了しました。原因は未特定です。Node 24でのローカル完走と、Ubuntu/Node 22のCI成功を別々の証拠として扱います。依存バージョンや既存デプロイ設定は変更していません。

## 最終レビューと操作確認

独立した読み取りレビューで、ガイドライン本文タブの言語選択と、絞りの導入文の断定表現を指摘・修正しました。追加の具体的な公開経路の問題は見つかっていません。メニューのアニメーション完了後の390px表示も目視確認し、メニューから紹介ページへの移動、3D地点の「記録を準備中」表示、キャンパスへの移動と戻る操作を確認しました。

## フォーム・非表示・要確認事項

Microsoft Formsの共有URLは開き、未認証の質問取得リクエストはHTTP 401 / Required user loginを返しました。ログイン要求は確認済みですが、質問内容、実際の使用言語、学内限定かどうか、回答可能なアカウントの範囲は未確認です。回答は送信していません。

以下は公開を保留しています。

- 実在が確認できない仮の予定、参加人数・報告・撮影設定を含むサンプル活動記録、Instagramの仮画像。
- 公認年月日、運営メンバーの氏名・顔写真、機材の導入済み・貸出可能という説明。
- 旧規約を現在有効とする表示、未更新の他言語版。

運営による確認が必要なのは、公認年月日、氏名・顔写真等の公開了承、実活動記録と写真ごとの公開条件、正式入部の申請先・書類・活動登録・保険適用条件、学外者等の参加資格、正式規程の承認です。情報管理の保管期間・閲覧担当者等も未確認のため創作していません。

スマホ実機、認証後のフォーム質問・権限、現地での活動や全写真の権利確認は実施していません。

## アトミックコミット

各件名が独立した目的を示します。マージ時にもこの列を保持します。この検証記録自体は別のドキュメントコミットです。

| SHA | 件名・目的 |
| --- | --- |
| `ede9020` | fix(schedule): publish only confirmed dates and announce October closure |
| `c6cc473` | fix(content): exclude sample trips from all public routes |
| `8227bbb` | fix(instagram): remove placeholder post fallback |
| `31903c6` | fix(club): align public facts and remove unconfirmed history |
| `ee5b51e` | fix(join): separate visits membership and chat participation |
| `7f79b20` | fix(contact): clarify photo use requests and personal information purposes |
| `54bcd4c` | fix(guidelines): publish aligned guidance and archive historical rules |
| `157398b` | feat(i18n): define language preferences and stable page pairs |
| `9a1813c` | fix(learn): qualify exposure optics and simulation guidance |
| `68d5382` | fix(learn): clarify safelight conditions and chemical collection |
| `7846eb1` | feat(schedule): provide matching Japanese and English notices |
| `4661e09` | feat(i18n): add English pages and remember header language choices |
| `1116ca3` | fix(admin): preserve English notices when editing schedules |
| `b941f37` | fix(learn): distinguish darkroom animation from processing conditions |
| `f17675c` | docs: align public project information with confirmed club operations |
| `cf0a0d1` | fix(i18n): retain explicit choices across guideline tabs and blocked storage |
| `1714b72` | fix(learn): qualify depth of field and label shared illustrations |
| `5e43c50` | fix(i18n): advertise alternates only for translated pages |
| `28bef9e` | docs: require verified records before publishing real photography |
| `eb2e34b` | test(content): guard generated routes and language links in CI |
| `229d702` | docs: record content verification and remaining organizer confirmations |
