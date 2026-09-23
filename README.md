# ゆらのゆるっとゆらっとTeaTime

碓氷ゆらさんの配信企画「ゆらのゆるっとゆらっとTeaTime」（都道府県ごとにお菓子・お土産などを紹介する長期企画）を、日本地図から都道府県を選んで振り返れるファンメイドの特設サイトです。

公開サイト: https://mnkm.github.io/yura-teatime/

## 概要

- 都道府県をクリック（またはキーボード操作）すると、その回の配信動画・配信日・紹介された商品ランキング・ショップリンクが右側パネルに表示されます
- 商品情報や配信動画のURLは、公開されているGoogleスプレッドシートを都度読み込んで表示しています。スプレッドシート自体が一次情報源で、このリポジトリにデータそのものは含まれていません
- 完全に静的なサイトで、サーバーサイドの実装は持ちません（GitHub Pagesでホスティング）

## 主な機能

- **都道府県マップ**: [Geolonia Japanese Prefectures](https://github.com/geolonia/japanese-prefectures) のSVG地図を地方ごとに色分け表示。データがある県とない県を色で区別
- **配信動画・商品ランキング表示**: 選択した都道府県の配信日・YouTube動画・商品ランキング・ショップリンクをカード形式で表示
- **スプラッシュスクリーン**: データ・地図の読み込みが完了するまでの間、操作不能な白画面状態を避けるためのローディング表示
- **ショップリンクの自動疎通確認**: GitHub Actionsが定期的に全ショップURLへアクセスし、HTTP 4xxを返すリンクをサイト側で自動的に非表示にする（詳細は後述）
- **モバイル表示専用の「地図に戻る」ボタン**: 情報パネルを読んだ後、地図まで手動でスクロールし直さずに済むよう、画面最下部までスクロールした先に表示（660px以下の画面幅でのみ表示）
- **抽選モード**: 画面上部のトグルスイッチで切り替え。配信動画・商品ランキングの表示パネルを隠して地図パネルを縦横比1:1のまま拡大表示し、まだ紹介されていない（データがない）都道府県の中から1件をランダム抽選する。「抽選」ボタン押下後、10秒かけて地図上を巡回表示しながら徐々に切り替え速度を落とし、確定した都道府県を点滅させたのちモーダルウィンドウで結果を表示する。抽選モード中は通常の都道府県選択操作を無効化する

## 技術構成

- ビルドツールなしの素のHTML / CSS / JavaScript（`js/script.js` はモジュールを使わないクラシックスクリプト）
- [SheetJS (xlsx)](https://sheetjs.com/) — 公開スプレッドシートのXLSXエクスポートをブラウザ上で直接パース（結合セルやハイパーリンク情報を保持するため、CSVではなくXLSXを解析しています）
- 地図データは [Geolonia Japanese Prefectures](https://github.com/geolonia/japanese-prefectures) のSVGをリポジトリ内にベンダリング（`img/map-polygon.svg`）
- GitHub Pages（静的ホスティング）+ GitHub Actions（ショップURLの定期チェック）

## ディレクトリ構成

```
.
├── index.html                       # エントリーポイント
├── css/style.css                    # スタイル一式
├── js/script.js                     # 地図描画・スプレッドシート解析・画面制御
├── img/
│   ├── title-logo.svg               # タイトルロゴ（スプラッシュ・地図タイトルで使用）
│   ├── favicon.svg
│   ├── back-to-map.svg              # 「地図に戻る」ボタンのアイコン
│   ├── background.jpeg
│   └── map-polygon.svg              # ベンダリング済みの地図SVG
├── data/shop-status.json            # ショップURL疎通チェックの結果（CIが自動更新）
├── scripts/check-shop-urls.mjs      # ショップURLを抽出・疎通確認するNode.jsスクリプト
├── .github/workflows/
│   └── check-shop-urls.yml          # 上記スクリプトを定期実行するワークフロー
└── package.json                     # 上記スクリプト用の依存関係（サイト本体のビルドには不使用）
```

## ローカルでの確認方法

ビルド手順は不要です。任意の静的サーバーで配信して `index.html` を開いてください。

```sh
npx serve .
# もしくは
python -m http.server 8000
```

ブラウザから直接 `index.html` を開くと、`fetch` によるスプレッドシート・地図SVGの取得がブラウザのセキュリティ制限に引っかかる場合があるため、簡易サーバー経由での確認を推奨します。

## ショップURLの自動チェックについて

`scripts/check-shop-urls.mjs` は、公開スプレッドシートから全ショップURLを抽出し、それぞれにGETリクエストを送ってHTTP 4xxが返るリンクを検出します。結果は `data/shop-status.json` に書き出され、サイトはこのファイルを読み込んでリンク切れのショップ情報を自動的に非表示にします（ブラウザから直接生存確認するとCORSの制約でほぼ判定できないため、CI側で検証する構成にしています）。

`.github/workflows/check-shop-urls.yml` が毎日 JST 3:00 に自動実行し、変更があれば結果をコミットします。手動で最新化したい場合は、GitHubの Actions タブから `Check shop URLs` を `workflow_dispatch` で実行するか、ローカルで以下を実行してください。

```sh
npm install
npm run check-shop-urls
```

このスクリプトは、宛先がプライベート/ループバックアドレス（クラウドのメタデータエンドポイント含む）に解決される場合は疎通確認をスキップし、リダイレクトも遷移先ごとに再検証します。

## セキュリティ上の配慮

- 外部（`raw.githubusercontent.com`）から都度取得していた地図SVGは、実行時の改変が閲覧者のブラウザでそのまま実行されてしまうリスクを避けるためリポジトリ内へベンダリングし、DOM挿入前に`<script>`やイベントハンドラ属性を除去するサニタイズを通しています
- CDNから読み込む外部スクリプト（xlsx）にはSubresource Integrity (SRI) を設定
- Content-Security-Policyにより、スクリプト・接続先・埋め込みフレームを必要最小限のオリジンに制限
- スプレッドシート由来の値はすべて `textContent` で描画し、外部リンクは `http`/`https` のみ許可した上で検証

## クレジット

- Create: [@o2i_5](https://x.com/o2i_5)
- Data: [@Shigure_1764](https://x.com/Shigure_1764)
- Map SVG: [Geolonia Japanese Prefectures](https://github.com/geolonia/japanese-prefectures)
