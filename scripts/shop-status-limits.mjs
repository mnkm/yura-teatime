// ショップURLの疎通チェックの上限。巡回(check-shop-urls.mjs)と、結果の検証(validate-shop-status.mjs)で共通。
// 依存パッケージは使わない(検証ジョブは npm ci をしないため)。

// スプレッドシートは第三者も編集しうるため、URL件数を無制限にチェックするとActionsの実行時間・
// クォータを消費させる踏み台になりうる。妥当な上限を設けて歯止めをかける。
export const MAX_URLS_PER_RUN = 300;
// 結果ファイルはリポジトリへコミットされるため、極端に長いURL文字列を持ち込ませない。
export const MAX_URL_LENGTH = 2048;
