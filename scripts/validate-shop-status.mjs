// 巡回ジョブが出力した shop-status.json を、リポジトリへコミットする前に検証する。
// 巡回ジョブは外部のスプレッドシートやサイトの応答を扱うため、その出力をそのまま信用せず、
// 書き込み権限を持つコミットジョブ側で形式を確かめる。依存パッケージは使わない。
//
// 上限値は scripts/check-shop-urls.mjs の MAX_URLS_PER_RUN / MAX_URL_LENGTH と揃えること。

import { readFile } from 'node:fs/promises';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_URLS = 300;
const MAX_URL_LENGTH = 2048;

function validate(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return 'トップレベルがオブジェクトではありません';

  const keys = Object.keys(data).sort().join(',');
  if (keys !== 'brokenUrls,checkedAt') return `想定外のキー構成です: ${keys}`;

  const { checkedAt, brokenUrls } = data;
  if (typeof checkedAt !== 'string' || Number.isNaN(Date.parse(checkedAt)) || new Date(checkedAt).toISOString() !== checkedAt) {
    return 'checkedAt がISO 8601形式の日時ではありません';
  }

  if (!Array.isArray(brokenUrls)) return 'brokenUrls が配列ではありません';
  if (brokenUrls.length > MAX_URLS) return `brokenUrls の件数が上限（${MAX_URLS}）を超えています`;

  for (const url of brokenUrls) {
    if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return 'brokenUrls に文字列でない値、または長すぎる値があります';
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return 'brokenUrls にURLとして解釈できない値があります';
    }
    if (!/^https?:$/.test(parsedUrl.protocol) || parsedUrl.href !== url) {
      return 'brokenUrls にhttp(s)以外、または正規化されていないURLがあります';
    }
  }

  return '';
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('usage: node scripts/validate-shop-status.mjs <path>');
  process.exit(2);
}

const content = await readFile(filePath);
let problem = content.byteLength > MAX_FILE_BYTES ? 'ファイルサイズが上限を超えています' : '';
if (!problem) {
  try {
    problem = validate(JSON.parse(content.toString('utf8')));
  } catch {
    problem = 'JSONとして解釈できません';
  }
}

if (problem) {
  console.error(`invalid shop status: ${problem}`);
  process.exit(1);
}
console.log('shop status is valid');
