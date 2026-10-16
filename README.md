# KUAS Photography Club（京都先端科学大学 写真部）

京都先端科学大学 写真部が運営するサイトです。部員で相談しながら撮影会を企画しています。初心者・経験者、在学生・留学生の見学を受け付けています。スマートフォンでも参加できます。

- 部員数：74名（2026年10月現在）
- 定例ミーティング：毎週金曜18:00から、通常は太秦キャンパスS306
- 2026年10月23日は龍尾祭準備のため、通常の定例ミーティングは休会
- 部費：半期1,000円。撮影会の交通費・入場料等は別途各自負担
- 運営の役職：部長、副部長、会計
- 共有カメラ等の機材は整備中。利用できる機材は運営に確認してください

休会・教室変更があるため、参加前に[スケジュール](https://kuas-photography-club.vercel.app/schedule/)と運営への確認をお願いします。学外の方・卒業生・教職員等の参加・正式入部の可否は、お問い合わせください。公認年月日は情報の確認ができるまで掲載していません。

## 見学・入部・お問い合わせ

[見学・参加の連絡フォーム（Microsoft Forms）](https://forms.cloud.microsoft/r/ZGB8GdNTUC)またはInstagramのDM・メールからご連絡ください。見学申込み・正式入部・連絡用チャットへの参加は別です。LINE等への参加だけでは正式な入部手続きは完了しません。必要な手続きは運営からご案内します。活動登録・保険の手続きや適用条件も運営にご確認ください。

フォームは未ログイン時にサインインを要求します。質問内容、使用言語、許可されるアカウントの範囲は今回確認できていません。回答できない場合は、次の窓口へご相談ください。いただく情報は、見学・参加の案内とお問い合わせへの対応に使用します。

- Instagram：[@kuas_photographyclub](https://www.instagram.com/kuas_photographyclub)
- メール：[photography.club.in.kuas@gmail.com](mailto:photography.club.in.kuas@gmail.com)
- [問い合わせ](https://kuas-photography-club.vercel.app/contact/)：撮影依頼・協賛・取材は対応可否・費用・納期・写真の利用条件等を個別に相談します

部員への通常連絡はLINE等、運営が案内する連絡用チャットで行います。部員用参加リンク、名簿、学籍番号、個人連絡先、口座情報、個人別支払状況、未公開作品、提出用フォルダ等を一般公開しません。

## サイトの開発

[公開サイト](https://kuas-photography-club.vercel.app/) / [English](https://kuas-photography-club.vercel.app/en/)

Astro + Three.js。公開ページは静的で、管理APIのみVercel Functionsで動きます。既存の国土地理院・PLATEAU・OpenStreetMap等の出典表記を維持してください。

Node.js 22.12以上を使用します。

```sh
npm ci
npm run dev
npm test
npm run check
npm run build
node tools/verify-public-build.mjs
```

GitHub Actionsはテスト・型チェック・ビルド・公開出力の確認を実行します。mainへのマージで既存のVercel連携が自動デプロイします。専用ブランチとPRを使い、検証後にマージしてください。

### 更新する場所

- 基本情報・窓口：`src/data/club.ts`
- 予定：`src/content/schedule/`。開催確認済みのイベントを個別に入力します。定例ミーティングの自動生成はしません。`weeklyMeeting` / `noMeeting` は旧ファイルとの互換性のため残っていますが、公開予定を生成しません
- 撮影会記録：`src/content/trips/`。実際の記録と公開条件を確認できた写真だけを追加します
- `sample: true` / `draft: true` の記録・月別予定は、トップ・一覧・詳細ルート・3D地点・管理画面初期データを含む公開経路から除外します。開発サンプルはローカルで編集し、フラグだけを消して公開しないでください
- 日英の予定：イベントの `titleEn` / `noteEn` に翻訳を記入します。未翻訳の本文は日本語であることを表示します。数値・日時・場所・費用・参加条件の意味を変えないでください
- Instagram：`src/data/club.ts` のプロフィールURL・ハンドルを使用します。日英のトップ・写真部紹介で `src/components/InstagramSection.astro` が公式プロフィールを埋め込み表示します。API連携・トークン・投稿画像の手動追加は不要です
- 学習図解：`public/photos/samples/` のプログラムで描いた画像は学習用にのみ使います。部員の写真・活動実績として表示しません
- ガイドライン：`guidelines/club_guidelines.md` と英語版。現在は確認済みの参加案内であり、正式規程の改定承認を示す文書ではありません
- 2025年の旧規約：`guidelines/archive/`。未更新の他言語原本：`guidelines/multilingual-support/`。どちらもサイトのローダー対象外です。現行規程として公開しません
- 日本語・英語：`/` と `/en/`。ガイドライン英語版は既存の `/guidelines/en/` を維持しています。ヘッダーから切り替えられ、手動選択をブラウザ内に保存します。初回はブラウザが提示する最初の対応言語を選び、日英がなければ英語にします。言語の自動選択と保存はブラウザ内で行います

Instagramの埋め込みは画面に近づいたときに遅延読み込みし、Instagramへ直接接続します。表示する投稿・件数・ログイン案内はInstagram側の仕様とアカウント設定に依存します。表示されない場合も、埋め込み外のプロフィールリンクから開けます。プロフィールの公開・埋め込み設定を変更した場合は、ログアウトしたブラウザでも表示を確認してください。

### 管理画面

`/admin/` では撮影会・写真・予定を編集できます。未設定時はデモモード（パスワード `demo`）で、公開しません。公開時は画像の公開条件とクレジットに使う表示名の了承を確認してください。写真はブラウザで長辺2000pxのJPEGへ変換しますが、写り込んだ個人情報や権利条件は別途確認が必要です。

本番設定はVercel側で管理してください。トークン・パスワード・ローカル環境ファイルはコミットしません。

| 変数 | 用途 |
| --- | --- |
| `ADMIN_PASSWORD` | 管理画面用パスワード。設定するとデモ用パスワードは無効 |
| `GITHUB_TOKEN` | このリポジトリのみ、Contents read/writeのFine-grained token |
| `SESSION_SECRET`（任意） | セッション署名 |
| `GITHUB_REPO` / `GITHUB_BRANCH`（任意） | 既定は `lingmulongtai/KUAS-Photography-Club` / `main` |

## English

This website is operated by the Kyoto University of Advanced Science Photography Club.

- 74 members as of October 2026
- Regular meetings: Fridays from 18:00, usually S306 at Uzumasa Campus; check cancellations and room changes before visiting
- The regular meeting on October 23, 2026 is cancelled for campus festival preparations
- Dues: JPY 1,000 per semester; transport, admission and other outing expenses are paid separately by each participant
- A smartphone is enough. Shared equipment is still being prepared. Members plan outings together
- Staff, alumni and people outside KUAS should ask about participation and eligibility for formal membership

A visit request and joining a LINE or other communication chat do not complete formal membership. Organizers will explain the required procedures. Ask about activity registration and insurance conditions; automatic coverage is not guaranteed.

The Microsoft Forms page requires sign-in. Its questions, actual language and permitted account scope were not verified. If you cannot respond, use email or Instagram DM. Information provided is used to arrange visits or participation and respond to inquiries. Photography requests, sponsorship and press inquiries are discussed individually, including availability, fees, deadlines and image usage conditions.

The English website includes visit/join, about, schedule, contact, records and learning introductions. Detailed interactive lessons are available in Japanese and are labelled as such. The current Japanese and English guides cover the same information; historical regulations and unrevised translations are not published as current rules.

For development use `npm ci`, `npm test`, `npm run check`, `npm run build`, then `node tools/verify-public-build.mjs`. Sample/draft content is excluded from public routes and payloads. Do not publish placeholder content by simply removing its sample flag. Publication of real photos requires checking the photographer, depicted people and facility conditions for each intended use. Submitting a work for exhibition or sale does not authorize web publication.

The repository document licence remains under consideration. Ask the organizers about external use of club documents or photographs.
