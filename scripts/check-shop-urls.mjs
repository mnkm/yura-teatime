// スプレッドシート内のショップURLを巡回し、HTTP 4xxを返すものを data/shop-status.json に記録する。
// GitHub Actions（.github/workflows/check-shop-urls.yml）から定期実行される。
//
// URLの抽出ルールは js/script.js の loadSpreadsheetData / renderSpreadsheetData と同じにする必要がある。
// あちらのシート解析ロジック（見出し判定・結合セル・ランキング行の判定など）を変更した場合は、
// このファイルの抽出ロジックも合わせて更新すること。

import { mkdir, writeFile } from 'node:fs/promises';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1TKqXbi7JbfVjlm7O1LxXh2Q-AA9V5sJN51b0eK_wCHg/export?format=xlsx';
const OUTPUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shop-status.json');
const REQUEST_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
// スプレッドシートは第三者も編集しうるため、URL件数を無制限にチェックするとActionsの実行時間・
// クォータを消費させる踏み台になりうる。妥当な上限を設けて歯止めをかける。
const MAX_URLS_PER_RUN = 300;

const prefectureNames = {
  '01': '北海道', '02': '青森県', '03': '岩手県', '04': '宮城県', '05': '秋田県', '06': '山形県', '07': '福島県',
  '08': '茨城県', '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県', '13': '東京都', '14': '神奈川県',
  '15': '新潟県', '16': '富山県', '17': '石川県', '18': '福井県', '19': '山梨県', '20': '長野県', '21': '岐阜県',
  '22': '静岡県', '23': '愛知県', '24': '三重県', '25': '滋賀県', '26': '京都府', '27': '大阪府', '28': '兵庫県',
  '29': '奈良県', '30': '和歌山県', '31': '鳥取県', '32': '島根県', '33': '岡山県', '34': '広島県', '35': '山口県',
  '36': '徳島県', '37': '香川県', '38': '愛媛県', '39': '高知県', '40': '福岡県', '41': '佐賀県', '42': '長崎県',
  '43': '熊本県', '44': '大分県', '45': '宮崎県', '46': '鹿児島県', '47': '沖縄県'
};

function cellText(value) {
  return String(value ?? '').trim();
}

function isNumberedItem(value) {
  return /^\d+$/.test(value);
}

function codeForSpreadsheetHeading(heading) {
  return Object.entries(prefectureNames).find(([, name]) => {
    const shortName = name.replace(/[県府]$/, '');
    return heading.includes(`${name}編`) || heading.includes(`${shortName}編`);
  })?.[0] || '';
}

function getMergedCell(sheet, rowIndex, columnIndex) {
  const merge = (sheet['!merges'] || []).find((range) => (
    range.s.c <= columnIndex && range.e.c >= columnIndex
      && range.s.r <= rowIndex && range.e.r >= rowIndex
  ));

  const sourceRow = merge?.s.r ?? rowIndex;
  return sheet[XLSX.utils.encode_cell({ r: sourceRow, c: columnIndex })];
}

// js/script.js の safeHttpUrl と同じ判定（http/https以外は無効）。
function safeHttpUrl(value) {
  if (!value) return '';

  try {
    const parsedUrl = new URL(value);
    return /^https?:$/.test(parsedUrl.protocol) ? parsedUrl.href : '';
  } catch {
    return '';
  }
}

// 公開XLSXから、実際に画面へ表示されるショップURLの集合を抽出する。
async function extractShopUrls() {
  const response = await fetch(SPREADSHEET_URL);
  if (!response.ok) {
    throw new Error(`スプレッドシートの取得に失敗しました (status: ${response.status})`);
  }

  const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
  const shopUrls = new Set();

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    let inBlock = false;
    let currentSectionIsRanking = false;
    let previousRank = '';

    rows.forEach((row, rowIndex) => {
      const firstCell = cellText(row[0]);

      if (codeForSpreadsheetHeading(firstCell)) {
        inBlock = true;
        currentSectionIsRanking = false;
        previousRank = '';
        return;
      }

      if (!inBlock || !row.some((cell) => cellText(cell))) return;

      const values = row.map(cellText);
      if (values[0] === '👑') return;

      const isRankedItem = isNumberedItem(values[0]);
      const isSectionHeading = !isRankedItem && Boolean(values[0]) && values.slice(1).every((value) => !value);

      if (isSectionHeading) {
        currentSectionIsRanking = values[0].includes('ランキング');
        previousRank = '';
        return;
      }

      const shopCell = getMergedCell(sheet, rowIndex, 2);
      const rowShopName = cellText(shopCell?.v);
      const rowShopUrl = shopCell?.l?.Target || '';

      const inheritedRank = currentSectionIsRanking && !values[0] && previousRank;
      const rankValue = isRankedItem ? values[0] : inheritedRank;
      const shouldShowRank = Boolean(rankValue);
      if (isRankedItem) previousRank = values[0];

      const itemIndex = shouldShowRank ? 1 : (values[0] ? 0 : 1);
      const shopName = values[itemIndex + 1] || rowShopName || '';
      const shopUrl = safeHttpUrl(rowShopUrl || (/^https?:\/\//i.test(shopName) ? shopName : ''));

      if (shopUrl) shopUrls.add(shopUrl);
    });
  });

  return shopUrls;
}

// プライベート/ループバック/リンクローカルなIPv4アドレスか判定する（クラウドのメタデータエンドポイント
// 169.254.169.254 を含む）。
function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
  );
}

// プライベート/ループバック/リンクローカルなIPv6アドレスか判定する。
function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true; // リンクローカル
  if (/^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/.test(normalized)) return true; // ユニークローカル fc00::/7
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIPv4(mapped[1]) : false;
}

// 名前解決した実IPが社内/クラウド内部などプライベートな宛先でないことを確認する。
// DNSの結果はTOCTOUの余地があり完全な保証ではないが、GitHub Actionsという低権限・使い捨ての
// 実行環境における多層防御として、明らかな内部向け・メタデータ向けアクセスを弾く。
async function isSafePublicHost(hostname) {
  if (hostname === 'localhost') return false;

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return false;
  }

  return addresses.length > 0 && addresses.every(({ address, family }) => (
    family === 4 ? !isPrivateIPv4(address) : !isPrivateIPv6(address)
  ));
}

// URLへGETリクエストを送り、HTTP 4xxかどうかを判定する。
// リダイレクトは自動追従させず、遷移先ごとに宛先の安全性を再検証してから追う
// （検証後にプライベートアドレスへリダイレクトさせるSSRFの回避策を防ぐため）。
// タイムアウト・ネットワークエラー・危険な宛先は「判定不能」として扱い、無効リンク一覧には含めない（フェイルオープン）。
async function checkUrl(url) {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const parsedUrl = new URL(currentUrl);
    if (!(await isSafePublicHost(parsedUrl.hostname))) return 'unknown';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(currentUrl, { method: 'GET', redirect: 'manual', signal: controller.signal });
    } catch {
      return 'unknown';
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return 'unknown';
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    return response.status >= 400 && response.status < 500 ? 'broken' : 'ok';
  }

  return 'unknown'; // リダイレクトが多すぎる場合は判定不能として扱う
}

async function main() {
  const shopUrls = await extractShopUrls();
  const urlsToCheck = [...shopUrls].slice(0, MAX_URLS_PER_RUN);
  if (shopUrls.size > MAX_URLS_PER_RUN) {
    console.warn(`shop URL count (${shopUrls.size}) exceeds limit; checking only the first ${MAX_URLS_PER_RUN}`);
  }
  console.log(`checking ${urlsToCheck.length} shop URLs...`);

  const brokenUrls = [];
  for (const url of urlsToCheck) {
    const result = await checkUrl(url);
    console.log(`[${result}] ${url}`);
    if (result === 'broken') brokenUrls.push(url);
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), brokenUrls: brokenUrls.sort() }, null, 2)}\n`
  );
  console.log(`wrote ${OUTPUT_PATH} (${brokenUrls.length} broken URLs)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
