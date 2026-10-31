# ゆらのゆるっとゆらっとTeaTime

碓氷ゆらさんの配信企画「ゆらのゆるっとゆらっとTeaTime」(都道府県ごとにお菓子やお土産を紹介する企画)を、日本地図から振り返れるファンメイドのサイトです。

公開 URL: https://mnkm.page/yura-teatime/

## 主な機能

- 地図で都道府県を選ぶと、その回の配信日・配信の動画・紹介した商品のランキング・ショップのリンクを表示します。キーボードでも選べます。
- 地図は地方ごとに色分けし、紹介済みの県とまだの県を色で区別します。
- データと地図を読み込む間は、読み込み中の画面を表示します。
- 抽選モード: 画面上のスイッチで切り替えます。地図を大きく表示し、まだ紹介されていない都道府県から 1 つを抽選します。「抽選」を押すと、10 秒かけて地図の上で候補を順に光らせながら速度を落とし、決まった県を点滅させてから結果を表示します。抽選モードの間は、都道府県を選ぶ操作はできません。
- 幅 660px 以下の画面では、ページのいちばん下に「地図に戻る」ボタンを表示します。
- リンク切れのショップのリンクは表示しません(下の「ショップの URL の確認」)。

## データ

商品と配信の動画のデータは、公開している Google スプレッドシートから、ページを開くたびに読み込みます。データはこのリポジトリには入っていません。結合したセルとハイパーリンクを読むため、CSV ではなく XLSX の書き出しを [SheetJS](https://sheetjs.com/) で読みます。

## 構成

HTML・CSS・JavaScript だけで作っており、ビルドツールは使いません。Cloudflare Pages で配信し、Cloudflare Workers を通して `mnkm.page` のパスで公開しています。旧 URL(`https://mnkm.github.io/yura-teatime/`)へのアクセスは、公開 URL へ転送されます。

```
.
├── index.html                       # ページ
├── _headers                         # Cloudflare Pages が返す HTTP ヘッダー
├── css/
│   ├── style.css                    # スタイル
│   └── fonts.css                    # Noto Sans JP の @font-face
├── fonts/noto-sans-jp/              # Noto Sans JP のフォントのファイルとライセンス
├── js/
│   ├── sheet.js                     # スプレッドシートの読み方(サイトとショップの URL の確認で共通)
│   └── script.js                    # 地図の描画と画面の操作
├── img/                             # ロゴ、アイコン、背景、地図の SVG(map-polygon.svg)
├── data/shop-status.json            # ショップの URL の確認結果(ワークフローが更新)
├── scripts/
│   ├── check-shop-urls.mjs          # ショップの URL を取り出して確認する
│   ├── validate-shop-status.mjs     # 確認結果のファイルをコミットの前に検証する
│   └── shop-status-limits.mjs       # 上の 2 つで共通の、URL の件数と長さの上限
├── .github/workflows/
│   └── check-shop-urls.yml          # ショップの URL の確認を毎日実行する
└── package.json                     # 上のスクリプト用(サイトのビルドには使わない)
```

## ローカルでの確認

静的なファイルを配信するサーバーで `index.html` を開きます。ファイルを直接ブラウザで開くと、ブラウザの制限でスプレッドシートと地図を読み込めないことがあります。

```sh
npx serve .
```

## ショップの URL の確認

`scripts/check-shop-urls.mjs` は、スプレッドシートからショップの URL をサイトと同じ方法(`js/sheet.js`)で取り出し、GET でアクセスして HTTP 4xx を返す URL を見つけます。結果は `data/shop-status.json` に書き、サイトはこのファイルを読んで、リンク切れのショップのリンクを表示しません。ブラウザからは CORS の制限で確認できないので、GitHub Actions で確認しています。

`.github/workflows/check-shop-urls.yml` が毎日 3:00(JST)に実行し、結果が変わったら `main` にコミットします。すぐに確認したいときは、Actions タブで「Check shop URLs」を手動で実行するか、次のコマンドを実行します。

```sh
npm install
npm run check-shop-urls
```

- 内部向けのアドレス(プライベート・ループバック・クラウドのメタデータのアドレスなど)に解決される URL にはアクセスしません。転送された先も同じように確かめます。名前解決の結果を確かめたあと、その IP アドレスに直接接続するので、確かめたあとで解決先を変える手口(DNS リバインディング)でも、内部向けのアドレスには接続しません。
- 1 回の実行で確認する URL の件数・長さと、全体の実行時間に上限があります。
- ワークフローは 2 つのジョブに分かれています。スプレッドシートを読んで URL を確認するジョブはリポジトリを読むだけの権限で動き、結果を `scripts/validate-shop-status.mjs` で検証してコミットするジョブだけが書き込みの権限を持ちます。

## セキュリティ

- 地図の SVG はリポジトリに入れて配信します。外部から読み込むと、書き換えられた SVG を閲覧者のブラウザで実行してしまうおそれがあるためです。ページに入れる前に `<script>` やイベントハンドラーの属性を取り除きますが、これは地図の SVG のための簡単な処理で、信頼できない SVG を安全にするものではありません。
- CDN から読み込むスクリプト(SheetJS)には Subresource Integrity(SRI)を設定しています。
- `_headers` で、他のサイトのフレームへの埋め込みを禁止するヘッダー(`frame-ancestors 'none'` など)を返します。Cloudflare Pages で配信したときだけ有効です。
- Content-Security-Policy で、スクリプト・通信先・埋め込みのフレームの読み込み元を必要なものに限っています。
- 閲覧者の情報が他のサービスへ送られないよう、フォント(Noto Sans JP)はこのサイトから配信し、YouTube の埋め込みには再生するまで Cookie を保存しない `youtube-nocookie.com` を使います。
- スプレッドシートの値はすべて `textContent` で表示します。外部のリンクは `http` と `https` だけを許可し、動画のリンクは YouTube の動画の URL だけにします。ショップのリンクの行き先のドメインは制限していないので、スプレッドシートを編集できる人を限っておく必要があります。

## クレジット

- Create: [@o2i_5](https://x.com/o2i_5)
- Data: [@Shigure_1764](https://x.com/Shigure_1764)
- Icon: [MingCute Icons](https://github.com/mingcute-design/mingcute-icons)（Apache License 2.0、`THIRD_PARTY_NOTICES.md`）
- Map SVG: [Geolonia Japanese Prefectures](https://github.com/geolonia/japanese-prefectures)
- Font: [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP)（SIL Open Font License 1.1、`fonts/noto-sans-jp/OFL.txt`）
