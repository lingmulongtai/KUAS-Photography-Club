# 運営用管理画面と写真投稿

## 最初の設定

管理画面は [https://kuas-photography-club.vercel.app/admin/](https://kuas-photography-club.vercel.app/admin/) です。運営で1組のID・パスワードを共有します。個人別のアカウント作成や権限分けはありません。

1. Vercelで `kuas-photography-club` を開き、Settings → Environment Variables を選びます。
2. 次の変数を **Production** に設定します。秘密値はVercelに直接入力し、チャット、コード、GitHubのコミットには貼りません。

   | 変数 | 設定する内容 |
   | --- | --- |
   | `ADMIN_USERNAME` | 運営で決めたログインID。未設定なら `admin` |
   | `ADMIN_PASSWORD` | パスワードマネージャー等で作成した、使い回さない長いパスワード |
   | `GITHUB_TOKEN` | 下記の、このリポジトリだけに書き込めるトークン |
   | `SESSION_SECRET` | パスワードとは別の、長いランダムな秘密値。省略可能ですが設定を推奨 |

3. 本番化するコミットを確認し、再デプロイします。変数の変更だけでは既存のデプロイには反映されません。
4. 管理画面を再読み込みし、設定したID・パスワードでログインします。「投稿を公開できます。保存後、サイトへの反映を確認します。」が表示されることを確認します。

本番で `ADMIN_PASSWORD` が未設定または空の場合はログインできず、不足している設定を表示します。`GITHUB_TOKEN` が本番の実行環境に反映されていない場合も公開ボタンは無効になります。設定不足をデモの成功として扱うことはありません。

ローカルで操作だけ試す場合に限り `ADMIN_DEMO=true` を設定すると、ID `admin`・パスワード `demo` で試せます。Vercel上や本番モードではこの指定は無効です。

セッションは12時間です。ID・パスワード・署名用秘密値等の変更をデプロイすると、以前のログイン状態は無効になります。このID対応版の初回反映時も再ログインしてください。

### GitHubの保存権限

GitHubのSettings → Developer settings → Personal access tokens → Fine-grained tokensからトークンを作成します。

- Resource owner: `lingmulongtai`
- Repository access: Only select repositories → **KUAS-Photography-Clubだけ**
- Repository permissions: Contents → Read and write
- 有効期限を設定し、更新時期を運営で把握します。他のリポジトリや管理権限を追加する必要はありません。

作成したトークンをVercelの `GITHUB_TOKEN` に設定します。通常のVercelとGitHubの自動デプロイ連携とは別に、管理画面が記事と写真を保存するための権限です。普段の開発用の広い権限のトークンを流用しないでください。

保存先の既定値は `lingmulongtai/KUAS-Photography-Club` の `main` です。必要な場合のみ `GITHUB_REPO` / `GITHUB_BRANCH` で変更します。ブランチを変更する場合はVercelの公開元も確認してください。

「本番モード」の表示は必要な変数が存在することを示します。トークンの有効期限・書き込み権限・ブランチ保護との適合までは検証しないため、最初の公開時に保存とデプロイの両方を確認します。

## 撮影会レポートを追加する

1. 管理画面にログインし、「撮影会を追加」を選びます。
2. タイトル、日付、場所、ひとこと紹介、本文、URL用の名前を入力します。URL用の名前は半角英小文字・数字・ハイフンを使います。
3. 写真を選び、各写真に説明と撮影者を入力します。写真は最低1枚必要です。公開条件と撮影者の表示名を確認します。
4. 入力内容を確認し、「公開する」を押します。写真と記事をGitHubへ保存し、Vercelの更新が始まります。
5. GitHubへの保存後、画面は「保存済み・反映確認中」を表示します。同じコミットの静的ビルドが本番に反映されたことを確認して初めて「公開済み」と表示します。2分以内に確認できなければ保存済みのまま案内し、Vercelのデプロイ状況を確認します。公開ページで本文・写真・クレジットも確認してください。

既存の撮影会へ追加する場合は、「写真を追加」から対象の撮影会を選びます。新規投稿した撮影会はデプロイ完了後に管理画面を再読み込みすると選べます。

現在の投稿機能は撮影会レポートです。一般的なお知らせ記事、既存レポート全文の編集、削除の専用画面はありません。予定は管理画面内のリンクから部のGoogleカレンダーで更新します。

## 写真の保存と容量

現在は写真をVercel Blobへ保存していません。ブラウザで長辺最大2000px、品質0.86のJPEGに変換し、GitHubの `public/photos/<URL名>/` に保存します。記事は `src/content/trips/<URL名>.md` です。1回の公開で1コミットが作成され、Vercelがサイトを再ビルドします。

- 元の高画質写真やRAWは別途保管します。このサイトに保存されるのは表示用のJPEGです。
- 変換後のJPEGは1枚3.2MiBまでです。HEIC等が読み込めない場合は、先にJPEGに書き出します。
- 例として1枚500KBなら100枚で約50MB、1,000枚で約500MBです。実際のサイズは写真追加時に表示されます。
- 小さな一覧画像にも同じJPEGを使うため、枚数だけでなく、閲覧時に何枚読み込まれるかも転送量に影響します。
- Gitの履歴とVercelに残るデプロイの容量も増えます。大量の写真を継続的に掲載する場合は、画像を専用ストレージへ分け、一覧用の小さい画像を用意する構成を検討します。

2026-10-22に確認したVercelの公開仕様では、Hobbyは月100GBのFast Data Transferと1日100回のデプロイが目安となる上限です。無料枠超過は機能の一時停止につながる場合があります。これはこのプロジェクトの現在の契約・残量を示すものではありません。Vercelのチーム画面 → Usageで、転送量とDeployment Storageを確認します。

Vercel Blobへ移す場合も、Hobbyには保存量の月平均1GB、Blob転送量10GB等の別枠があります。移すだけで無制限になるわけではありません。

仕様・料金の確認先:

- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Deployment Storage](https://vercel.com/docs/deployment-storage)
- [Vercel Blobの使用量と料金](https://vercel.com/docs/vercel-blob/usage-and-pricing)
