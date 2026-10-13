# KUAS Photography Club（京都先端科学大学 写真サークル）

KUAS Photography Club は、写真撮影を通じて「楽しむ」と「つながる」を大切にするサークルです。国籍や学年を問わず、写真という共通の趣味で交流しながら、来年度の「部活」昇格を目指します（現在は「まだサークル」）。

- 学友会公認: 2025/05/21
- メンバー数: 55名（2025/10/29 現在）
- ミーティング: 毎週 金曜 18:00〜（太秦キャンパス S306 教室）

## 活動目的
- 写真撮影を通して、とにかく楽しむ
- 留学生・日本人を問わず交流を広げる
- 次年度の部活昇格に向け、クラブ機材（共有カメラ）の整備を進める
  - カメラ未所持のメンバーも気軽に撮影を楽しめるよう、クラブのカメラ購入を目標にします

## 活動概要（Photo Trip）
- 月2回ほどの撮影会で、キャンパス周辺から近隣の府県まで足を運び、美しい景色やイベントを撮影します
- 例：花火大会、神社仏閣、水族館、街スナップ など
- 撮影に向けたアイデア共有・企画準備のため、毎週ミーティングを行います

## このリポジトリについて
このリポジトリは、KUAS Photography Club の運営に関するドキュメントを作成・保存・更新する場所です。今後、メンバーとともに内容を改善しながら整備していきます。

想定する主なドキュメント（予定）:
- ガイドライン（活動方針・参加ルール・安全面の注意事項）
- 撮影会の企画テンプレート（行程・持ち物・予算・リスク管理）
- 広報・告知テンプレート（フライヤー文面、SNS投稿案）
- 機材管理（共有カメラの運用方針・貸出ルール）
- 会計関連（費用分担の考え方・テンプレート）

推奨フォルダ構成（予定）:
- `guidelines/` … ガイドライン本体（サイトのガイドラインページもここから作られます）
- `src/`・`public/`・`tools/` … ウェブサイト（下の「ウェブサイト」を参照）
- `templates/` … 企画・広報・会計などのテンプレート
- `equipment/` … 機材リスト・貸出ルール
- `docs/` … 参考資料・記録 など

## ウェブサイト
このリポジトリには、サークルの公式サイト（Astro + three.js の静的サイト）も入っています。

- トップ：京都の現在時刻に合わせて空が変わる 3D の京都
- 撮影会：撮影会ごとに1本のフィルムとして写真と撮影メモを掲載
- 写真を学ぶ：シャッタースピード・絞り・焦点距離・現像を、触って試せるデモつきで解説
- サークルについて／見学・入部（フォームつき）／ガイドライン（11言語）

### 手元で動かす
Node.js 22.12 以上が必要です。

```sh
npm install
npm run dev      # http://localhost:4321 で確認
npm run check    # 型チェック
npm run build    # dist/ に書き出し
```

### よくある更新
- **ミーティングの時間・教室・メンバー数・連絡先**：`src/data/club.ts`
- **撮影会を追加**：`src/content/trips/` に Markdown を1つ追加し、写真を `public/photos/<撮影会名>/` に置く（書き方は既存のファイルを参照）。撮影者名は `by` に書くと、ガイドライン第6章のクレジットが自動で付きます
- **サンプルの差し替え**：`sample: true` の撮影会と写真はサンプルです。手順は `tools/sample-photos/README.md`
- **仮の文章**：手書き風の点線メモがついている文章は、運営で書き換えてください
- **入部フォームの送信先**：`src/data/club.ts` の `joinForm.endpoint` に Formspree などの URL を入れると、フォームの内容がそこに届きます（空のままだとメールアプリが開きます）
- **Instagram の投稿**：`src/data/instagram.ts` に載せたい投稿を追加
- **ガイドライン**：`guidelines/` の Markdown を編集すると、サイトにもそのまま反映されます

### 公開（Vercel）
1. [Vercel](https://vercel.com/) に GitHub アカウントでログインし、「Add New → Project」でこのリポジトリを選ぶ
2. Framework は自動で「Astro」になるので、そのまま Deploy
3. 以後は main ブランチに push すると自動で更新されます。プルリクエストごとにプレビュー URL も作られます

公開 URL が決まったら、`astro.config.mjs` の `site` を書き換えてください（OGP や canonical に使われます）。

## 参加・問い合わせ
- 入会・見学・撮影会の参加は、ミーティングで運営メンバーに気軽に声をかけてください
- 連絡方法：
  - Instagram: [@kuas_photographyclub](https://www.instagram.com/kuas_photographyclub)
  - Teams/メール: [2025m011@kuas.ac.jp](mailto:2025m011@kuas.ac.jp)

## 貢献のしかた（ドキュメント編集）
- 誤字修正や追記、提案があれば Issue や Pull Request で気軽にご連絡ください
- GitHub の使い方が不安な場合は、ミーティングで運営に相談してください

## ライセンス / 取り扱い
- 本リポジトリの文書のライセンスは検討中です（後日追記）
- サークル内での利用を前提として運用します。外部利用については運営までご相談ください

---
最終更新: 2025-10-29

---

# KUAS Photography Club (English)

The KUAS Photography Club is a group for students who love photography. Our main goals are to have fun, connect with others, and share our passion for taking pictures. We welcome students of all nationalities and academic years. We are currently an informal group, but we aim to become an official university club next year.

- **Official Recognition:** Approved by the Student Union on May 21, 2025
- **Members:** 55 (as of October 29, 2025)
- **Meetings:** Fridays from 18:00 in Room S306, Uzumasa Campus

## Our Goals
- To enjoy photography above all else.
- To foster a community for both international and Japanese students.
- To prepare for official club status by acquiring shared equipment, such as cameras that all members can use.
  - Our goal is to purchase club cameras so that members who don't own one can still participate freely.

## What We Do (Photo Trips)
- We organize photo outings about twice a month to capture beautiful scenery and events, both on campus and in neighboring prefectures.
- **Examples:** Fireworks festivals, temples, shrines, aquariums, and street photography.
- We hold weekly meetings to plan these trips and share ideas.

## About This Repository
This repository is where we create, store, and update documents for the KUAS Photography Club. We plan to improve these documents over time with feedback from our members.

**Planned Documents:**
- **Guidelines:** Our club's policies, rules, and safety precautions.
- **Templates:** For planning photo trips, managing budgets, and creating promotional materials.
- **Equipment:** Rules for borrowing and managing shared cameras.
- **Finances:** Policies for sharing costs and managing funds.

**Recommended Folder Structure:**
- `guidelines/`: Guideline documents (the website's guidelines pages are built from these).
- `src/`, `public/`, `tools/`: The website (see "Website" below).
- `templates/`: Templates for planning, announcements, and finances.
- `equipment/`: Equipment lists and lending rules.
- `docs/`: Reference materials and records.

## Website
This repository also holds the club website, a static Astro + three.js site: a 3D Kyoto on the top page whose sky follows the time in Kyoto, photo trip reports shown as rolls of film, hands-on lessons on shutter speed, aperture, focal length and developing, an about page, a join form and the guidelines in 11 languages.

- Develop: `npm install`, then `npm run dev` (Node.js 22.12+). `npm run check` type-checks, `npm run build` writes `dist/`.
- Club facts and the join form endpoint: `src/data/club.ts`. Trips: one Markdown file per trip in `src/content/trips/`, photos in `public/photos/`.
- Sample trips and photos are marked `sample: true`; see `tools/sample-photos/README.md` to replace them.
- Deploy: import the repository in Vercel (framework preset: Astro). Pushes to `main` deploy automatically. Update `site` in `astro.config.mjs` once the URL is final.

## Get Involved
- If you'd like to join, visit a meeting, or participate in a photo trip, just speak to one of the organizers at our weekly meetings.
- **Contact Us:**
  - **Instagram:** [@kuas_photographyclub](https://www.instagram.com/kuas_photographyclub)
  - **Teams/Email:** [2025m011@kuas.ac.jp](mailto:2025m011@kuas.ac.jp)

## How to Contribute
- If you find a typo or have a suggestion, feel free to open an Issue or a Pull Request.
- If you're not sure how to use GitHub, ask an organizer for help during a meeting.

## License & Usage
- The license for this repository is still under consideration.
- These documents are intended for internal club use. Please consult with an organizer before using them for any other purpose.

---
Last Updated: 2025-10-29