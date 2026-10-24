// スプレッドシート内のショップURLを巡回し、HTTP 4xxを返すものを data/shop-status.json に記録する。
// GitHub Actions（.github/workflows/check-shop-urls.yml）から定期実行される。
//
// URLの抽出は、サイトと同じ読み方(js/sheet.js の parseWorkbook / blockEntries)で行うので、
// 画面に出るショップと、ここでチェックするショップは食い違わない。

import { mkdir, writeFile } from 'node:fs/promises';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import '../js/sheet.js';
import { MAX_URL_LENGTH, MAX_URLS_PER_RUN } from './shop-status-limits.mjs';

const { parseWorkbook, blockEntries } = globalThis.TeaTimeSheet;

const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1TKqXbi7JbfVjlm7O1LxXh2Q-AA9V5sJN51b0eK_wCHg/export?format=xlsx';
const OUTPUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shop-status.json');
const REQUEST_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
// 応答の遅い宛先が続いても、巡回全体がこの時間を超えたら残りは判定不能として打ち切る。
const TOTAL_DEADLINE_MS = 10 * 60 * 1000;
const SPREADSHEET_TIMEOUT_MS = 30000;
const MAX_SPREADSHEET_BYTES = 20 * 1024 * 1024;

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
  for (const block of parseWorkbook(XLSX, workbook).values()) {
    for (const entry of blockEntries(block)) {
      if (entry.type === 'item' && entry.shopUrl) shopUrls.add(entry.shopUrl);
    }
  }
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

// GitHub Actionsのランナーは、行の途中にある「##[」も旧形式のワークフローコマンドとして解釈する。
// スプレッドシートは第三者も編集しうるため、URLをログへ出す前に、フラグメントの区切り以外の「#」を
// %23 に置き換えて「#」を高々1つにし、偽の注釈やログのマスクなどのコマンドを実行させない。
// 置き換えるのはログ表示だけで、判定や結果ファイルには元のURLを使う。
function urlForLog(url) {
  const fragmentIndex = url.indexOf('#');
  if (fragmentIndex < 0) return url;
  return url.slice(0, fragmentIndex + 1) + url.slice(fragmentIndex + 1).replaceAll('#', '%23');
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
    console.log(`[${result}] ${urlForLog(url)}`);
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
