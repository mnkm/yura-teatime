// スプレッドシート内のショップURLを巡回し、HTTP 4xxを返すものを data/shop-status.json に記録する。
// GitHub Actions（.github/workflows/check-shop-urls.yml）から定期実行される。
//
// URLの抽出ルールは js/script.js の loadSpreadsheetData / renderSpreadsheetData と同じにする必要がある。
// あちらのシート解析ロジック（見出し判定・結合セル・ランキング行の判定など）を変更した場合は、
// このファイルの抽出ロジックも合わせて更新すること。

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1TKqXbi7JbfVjlm7O1LxXh2Q-AA9V5sJN51b0eK_wCHg/export?format=xlsx';
const OUTPUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shop-status.json');
const REQUEST_TIMEOUT_MS = 10000;

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

// URLへGETリクエストを送り、HTTP 4xxかどうかを判定する。
// タイムアウトやネットワークエラーは「判定不能」として扱い、無効リンク一覧には含めない（フェイルオープン）。
async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    return response.status >= 400 && response.status < 500 ? 'broken' : 'ok';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const shopUrls = await extractShopUrls();
  console.log(`checking ${shopUrls.size} shop URLs...`);

  const brokenUrls = [];
  for (const url of shopUrls) {
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
