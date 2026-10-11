// スプレッドシート内のショップURLを巡回し、HTTP 4xxを返すものを data/shop-status.json に記録する。
// GitHub Actions（.github/workflows/check-shop-urls.yml）から定期実行される。
//
// URLの抽出ルールは js/script.js の loadSpreadsheetData / renderSpreadsheetData と同じにする必要がある。
// あちらのシート解析ロジック（見出し判定・結合セル・ランキング行の判定など）を変更した場合は、
// このファイルの抽出ロジックも合わせて更新すること。

import { mkdir, writeFile } from 'node:fs/promises';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
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
// 結果ファイルはリポジトリへコミットされるため、極端に長いURL文字列を持ち込ませない。
// scripts/validate-shop-status.mjs の上限と揃えること。
const MAX_URL_LENGTH = 2048;
// 応答の遅い宛先が続いても、巡回全体がこの時間を超えたら残りは判定不能として打ち切る。
const TOTAL_DEADLINE_MS = 10 * 60 * 1000;
const SPREADSHEET_TIMEOUT_MS = 30000;
const MAX_SPREADSHEET_BYTES = 20 * 1024 * 1024;

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
  const response = await fetch(SPREADSHEET_URL, { signal: AbortSignal.timeout(SPREADSHEET_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`スプレッドシートの取得に失敗しました (status: ${response.status})`);
  }

  // 巨大なファイルでメモリや実行時間を使い切らないよう、上限を超えた時点で読み込みを打ち切る。
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_SPREADSHEET_BYTES) {
      throw new Error('スプレッドシートのサイズが上限を超えています');
    }
    chunks.push(chunk);
  }

  const workbook = XLSX.read(Buffer.concat(chunks), { type: 'buffer' });
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

// 接続を拒否するIPv4の範囲。プライベート・ループバック・リンクローカル（クラウドのメタデータ
// エンドポイント 169.254.169.254 を含む）のほか、共有アドレス空間や予約済みの範囲も対象にする。
const blockedIPv4 = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ['168.63.129.16', 32] // Azureの内部向け仮想IP（GitHub ActionsのランナーはAzure上で動く）
].forEach(([network, prefix]) => blockedIPv4.addSubnet(network, prefix, 'ipv4'));

// IPv6はグローバルユニキャスト（2000::/3）だけを許可し、その中でもIPv4を内包しうる範囲と
// 文書用の範囲は拒否する。ループバック・リンクローカル・IPv4射影アドレスなどは2000::/3の外なので通らない。
const allowedIPv6 = new net.BlockList();
allowedIPv6.addSubnet('2000::', 3, 'ipv6');
const blockedIPv6 = new net.BlockList();
[['2001::', 32], ['2001:db8::', 32], ['2002::', 16]]
  .forEach(([network, prefix]) => blockedIPv6.addSubnet(network, prefix, 'ipv6'));

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blockedIPv4.check(address, 'ipv4');
  if (family === 6) return allowedIPv6.check(address, 'ipv6') && !blockedIPv6.check(address, 'ipv6');
  return false;
}

// 名前解決の結果を検証し、検証済みのアドレスだけを接続処理へ返す。
// 検証と接続で名前解決を別々に行うと、その間に応答を差し替えるDNSリバインディングで内部向けの
// 宛先へ接続させられるため、http(s).requestのlookupとして渡し、検証したIPへそのまま接続させる。
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error);
      return;
    }
    if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) {
      callback(new Error(`blocked destination: ${hostname}`));
      return;
    }
    if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
}

// 1回分のGETリクエストを送り、ステータスコードとLocationヘッダーだけを受け取る。
// 本文は読まずに接続を破棄する（流れ続ける応答でプロセスが終了しなくなるのを防ぐ）。
function requestStatus(url) {
  return new Promise((resolve, reject) => {
    // IPアドレス直書きのURLは名前解決を通らないため、ここで直接検証する。
    const literalHost = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literalHost) && !isPublicAddress(literalHost)) {
      reject(new Error(`blocked destination: ${literalHost}`));
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      method: 'GET',
      agent: false,
      lookup: safeLookup,
      headers: { accept: '*/*', 'user-agent': 'node' }
    });

    // 名前解決・接続・応答待ちの全体に対する制限時間。
    const timer = setTimeout(() => request.destroy(new Error('timeout')), REQUEST_TIMEOUT_MS);
    request.on('response', (response) => {
      clearTimeout(timer);
      resolve({ status: response.statusCode, location: response.headers.location });
      response.destroy();
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

// URLへGETリクエストを送り、HTTP 4xxかどうかを判定する。
// リダイレクトは自動追従させず、遷移先ごとに宛先の安全性を再検証してから追う
// （検証後にプライベートアドレスへリダイレクトさせるSSRFの回避策を防ぐため）。
// タイムアウト・ネットワークエラー・危険な宛先は「判定不能」として扱い、無効リンク一覧には含めない（フェイルオープン）。
async function checkUrl(url) {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let parsedUrl;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      return 'unknown';
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) return 'unknown';

    let response;
    try {
      response = await requestStatus(parsedUrl);
    } catch {
      return 'unknown';
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location) return 'unknown';
      try {
        currentUrl = new URL(response.location, currentUrl).href;
      } catch {
        return 'unknown';
      }
      continue;
    }

    return response.status >= 400 && response.status < 500 ? 'broken' : 'ok';
  }

  return 'unknown'; // リダイレクトが多すぎる場合は判定不能として扱う
}

async function main() {
  const shopUrls = [...(await extractShopUrls())].filter((url) => url.length <= MAX_URL_LENGTH);
  const urlsToCheck = shopUrls.slice(0, MAX_URLS_PER_RUN);
  if (shopUrls.length > MAX_URLS_PER_RUN) {
    console.warn(`shop URL count (${shopUrls.length}) exceeds limit; checking only the first ${MAX_URLS_PER_RUN}`);
  }
  console.log(`checking ${urlsToCheck.length} shop URLs...`);

  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  const brokenUrls = [];
  for (const url of urlsToCheck) {
    if (Date.now() > deadline) {
      console.warn('time limit reached; remaining URLs are left unchecked');
      break;
    }
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

// 破棄しきれなかった接続が残っていても確実に終了させるため、明示的に終了コードを返す。
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
