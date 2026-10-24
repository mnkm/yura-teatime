// スプレッドシートの読み方は js/sheet.js(ショップURLの疎通チェックと共通)。
const { prefectureNames, normalizeCode, safeHttpUrl, parseWorkbook, blockEntries } = TeaTimeSheet;

// 地方の色分け用のクラス。都道府県コードが last 以下の最初の地方になる(コードは地方ごとに連続している)
const regions = [
  { last: 1, className: 'hokkaido' },
  { last: 7, className: 'tohoku' },
  { last: 14, className: 'kanto' },
  { last: 23, className: 'chubu' },
  { last: 30, className: 'kinki' },
  { last: 35, className: 'chugoku' },
  { last: 39, className: 'shikoku' },
  { last: 47, className: 'kyushu' }
];
const regionClassOf = (code) => regions.find((region) => Number(code) <= region.last)?.className || 'other';

// 突出部を除いた主領域の中央に合わせるための垂直方向だけのラベル補正値。
const labelVerticalOffsets = {
  // 島の突出部などで地理的中心とラベルの見た目の中心がずれる県。
  '01': -12,
  '13': -10,
  '15': 23,
  '18': 23,
  '26': 23
};

const splashScreen = document.querySelector('#splash-screen');
const mapContainer = document.querySelector('#map');
const mapSvgContainer = document.querySelector('#map-svg') || mapContainer;
const selectedHeading = document.querySelector('#selected-heading');
const selectedVideo = document.querySelector('#selected-video');
const selectedDetails = document.querySelector('#selected-details');
const backToMapButton = document.querySelector('#back-to-map-button');
const mapPanel = document.querySelector('.map-panel');
const pageElement = document.querySelector('.page');
const lotteryModeToggle = document.querySelector('#lottery-mode-toggle');
const lotteryButton = document.querySelector('#lottery-button');
const lotteryModal = document.querySelector('#lottery-result-modal');
const lotteryResultName = document.querySelector('#lottery-result-name');
const lotteryModalCloseButton = document.querySelector('#lottery-result-close');
const svgNamespace = 'http://www.w3.org/2000/svg';
const spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/1TKqXbi7JbfVjlm7O1LxXh2Q-AA9V5sJN51b0eK_wCHg/export?format=xlsx';
// 抽選アニメーションの総時間と、開始・終了時点の切り替え間隔（進むほど間隔を伸ばし収束していく見た目にする）。
const LOTTERY_DURATION_MS = 10000;
const LOTTERY_START_INTERVAL_MS = 70;
const LOTTERY_END_INTERVAL_MS = 450;
// 結果確定後、モーダル表示の前に確定した都道府県を点滅させる回数と切り替え間隔。
const LOTTERY_BLINK_TOGGLES = 8;
const LOTTERY_BLINK_INTERVAL_MS = 180;
let prefectureData = new Map();
let noDataPrefectureElements = [];
let isLotteryRunning = false;
let lotteryRunToken = 0;

// YouTubeの各種URL(watch・live・shorts・youtu.be)から動画IDを取り出す。YouTubeの動画URLでなければ ''。
function youtubeVideoId(url) {
  if (!url) return '';

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const isYouTubeHost = hostname === 'youtube.com'
      || hostname === 'www.youtube.com'
      || hostname === 'm.youtube.com'
      || hostname === 'youtu.be';
    if (!isYouTubeHost) return '';

    const liveMatch = parsedUrl.pathname.match(/^\/live\/([^/]+)/);
    const shortsMatch = parsedUrl.pathname.match(/^\/shorts\/([^/]+)/);
    const watchId = parsedUrl.searchParams.get('v');
    const shortMatch = hostname === 'youtu.be' ? parsedUrl.pathname.match(/^\/([^/]+)/) : null;
    const videoId = liveMatch?.[1] || shortsMatch?.[1] || watchId || shortMatch?.[1];
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : '';
  } catch {
    return '';
  }
}

// 指定したタグ・クラス・文字の要素を作る(文字は textContent で入れる)。
function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

// 新しいタブで開く外部リンクを作る。href は safeHttpUrl などで検証済みのものを渡す。
function externalLink(href, text) {
  const link = textElement('a', '', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

// GitHub ActionsがCI上で定期的に検証し、HTTP 4xxが確認できたショップURLを記録した静的データ。
// ブラウザからのfetchは多くの外部サイトでCORSにより検証できないため、事前チェック結果を利用する。
const shopStatusUrl = './data/shop-status.json';
let brokenShopUrls = new Set();

// 事前チェック結果を読み込む。取得できない場合は何も無効化せずフェイルオープンする。
async function loadShopStatus() {
  try {
    const response = await fetch(shopStatusUrl);
    if (!response.ok) return;
    const data = await response.json();
    brokenShopUrls = new Set(data.brokenUrls || []);
  } catch {
    // ネットワークエラー等。ショップリンクの非表示判定は行わない。
  }
}

// 見出し行から配信日と「#」以降の動画タイトルを分離する。
function parseHeadingText(heading) {
  const dateMatch = heading.match(/^(\d{2})\.(\d{1,2})\/(\d{1,2})/);
  const hashIndex = heading.indexOf('#');
  const dateLabel = dateMatch
    ? `${2000 + Number(dateMatch[1])}年${Number(dateMatch[2])}月${Number(dateMatch[3])}日 配信`
    : '';
  const title = hashIndex >= 0 ? heading.slice(hashIndex).trim() : '';

  return { dateLabel, title };
}

// 選択状態に応じて動画、配信日、タイトルリンクを情報パネルへ描画する。
function renderSelectedVideo(data, isSelected = false) {
  selectedVideo.replaceChildren();

  if (!isSelected) {
    const videoFrame = document.createElement('div');
    videoFrame.className = 'video-frame';
    videoFrame.appendChild(textElement('p', 'video-status', '都道府県を選択してください'));
    selectedVideo.appendChild(videoFrame);
    selectedVideo.classList.add('is-visible');
    return;
  }

  const { dateLabel, title } = data ? parseHeadingText(data.title) : {};

  if (dateLabel) {
    selectedVideo.appendChild(textElement('p', 'video-date', dateLabel));
  }

  const videoFrame = document.createElement('div');
  videoFrame.className = 'video-frame';
  const videoId = youtubeVideoId(data?.videoUrl);
  if (!videoId) {
    videoFrame.appendChild(textElement('p', 'video-status', 'Coming soon...'));
  } else {
    // プレイヤーの読み込み中・失敗時の代替表示として、まずサムネイルを背景に敷いておく。
    videoFrame.style.backgroundImage = `url("https://i.ytimg.com/vi/${videoId}/hqdefault.jpg")`;

    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
    iframe.title = '都道府県紹介動画';
    iframe.loading = 'eager';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    // src自体はyoutube-nocookie.com/embed/配下に限定済みだが、多層防御としてsandboxで許可範囲を明示する。
    iframe.sandbox = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';
    // プレイヤーを表示できたらサムネイルは不要になるため取り除く。
    iframe.addEventListener('load', () => {
      videoFrame.style.backgroundImage = '';
    });
    videoFrame.appendChild(iframe);
  }
  selectedVideo.appendChild(videoFrame);

  if (title) {
    // 動画欄のリンクは、YouTubeの動画URLと判定できたものだけに限る（任意サイトへの誘導に使わせない）。
    const videoLink = videoId ? safeHttpUrl(data?.videoUrl) : '';
    const caption = textElement('p', 'video-title', videoLink ? '' : title);
    if (videoLink) caption.appendChild(externalLink(videoLink, title));
    selectedVideo.appendChild(caption);
  }
  selectedVideo.classList.add('is-visible');
}

// 公開XLSXの全シートを読み込み、都道府県単位のデータへ変換する(読み方は js/sheet.js)。
async function loadSpreadsheetData() {
  const response = await fetch(spreadsheetUrl);
  if (!response.ok) {
    throw new Error('スプレッドシートを読み込めませんでした');
  }

  prefectureData = parseWorkbook(XLSX, XLSX.read(await response.arrayBuffer(), { type: 'array' }));
}

// 選択された都道府県のカテゴリ、商品、ショップ情報をカードとして描画する。
function renderSpreadsheetData(code) {
  selectedDetails.replaceChildren();
  const data = prefectureData.get(code);

  if (!data) {
    return;
  }

  let list = null;
  blockEntries(data).forEach((entry) => {
    if (entry.type === 'section') {
      list = document.createElement('section');
      list.className = 'data-section';
      list.appendChild(textElement('h3', '', entry.title));
      selectedDetails.appendChild(list);
      return;
    }

    // 見出しより前の項目は、見出しの無い節にまとめる
    if (!list) {
      list = document.createElement('section');
      list.className = 'data-section';
      selectedDetails.appendChild(list);
    }

    let items = list.querySelector('.data-list');
    if (!items) {
      items = document.createElement('ul');
      items.className = 'data-list';
      list.appendChild(items);
    }

    const item = document.createElement('li');
    item.classList.toggle('ranked-item', Boolean(entry.rank));
    if (entry.rank) {
      item.appendChild(textElement('span', 'card-rank', `${entry.rank}.`));
    }

    const content = textElement('span', 'card-content', entry.name);
    item.appendChild(content);

    if (entry.shopName && entry.shopUrl && !brokenShopUrls.has(entry.shopUrl)) {
      const shop = document.createElement('span');
      shop.className = 'shop-line';
      shop.appendChild(externalLink(entry.shopUrl, entry.shopName));
      content.appendChild(shop);
    }
    items.appendChild(item);
  });
}

// 地図上の選択状態と右側の情報パネルを選択県に同期する。
function updateSelection(prefectureElement) {
  const code = normalizeCode(prefectureElement.dataset.code);
  const name = prefectureElement.dataset.name || prefectureNames[code] || '都道府県';

  selectedHeading.textContent = name;
  renderSelectedVideo(prefectureData.get(code), true);
  renderSpreadsheetData(code);
}

// Geoloniaの地図SVGを取得する。ビルド時に img/map-polygon.svg として取り込んだものを同一オリジンから読み込む。
// 元データ: https://github.com/geolonia/japanese-prefectures （masterブランチを都度取得すると、
// 上流の改変がそのままこのサイトのDOMに実行時反映されてしまうため、意図的にベンダリングしている）。
async function fetchMapSvg() {
  const svgUrl = './img/map-polygon.svg';
  const response = await fetch(svgUrl);

  if (!response.ok) {
    throw new Error('地図の読み込みに失敗しました');
  }

  return response.text();
}

// SVGに<script>やイベントハンドラ属性が紛れ込んでいた場合に備え、挿入前に取り除く。
// DOMParserで解析したSVGはinnerHTML代入と異なりappendChildで挿入すると<script>が実行されるため、
// ベンダリング済みで現状安全なファイルであっても多層防御として必ず通す。
// 地図SVGが使わない要素・属性を落とすだけの簡易的なもので、信頼できない外部SVGを安全にする汎用の
// サニタイザーではない。外部から取得する構成に戻す場合は専用ライブラリに置き換えること。
function sanitizeSvgElement(root) {
  root.querySelectorAll('script, foreignObject, style, animate, animateMotion, animateTransform, set')
    .forEach((node) => node.remove());

  // querySelectorAll('*')は起点ノード自身を含まないため、rootを明示的に含めて処理する。
  [root, ...root.querySelectorAll('*')].forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      // リンク先は同一文書内の参照（#id）だけを残し、スキームの表記ゆれによるすり抜けを防ぐ。
      const isExternalReference = /^(?:xlink:href|href)$/.test(name) && !attr.value.trim().startsWith('#');
      // style属性はCSPのstyle-srcでインラインスタイルとして拒否されるため、あらかじめ除いておく。
      if (name.startsWith('on') || name === 'style' || isExternalReference) {
        node.removeAttribute(attr.name);
      }
    });
  });

  return root;
}

// 取得したSVG地図を描画し、色分け・ラベル・選択イベントを設定する。
function renderMap(svgText) {
  const svgDocument = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (svgDocument.getElementsByTagName('parsererror').length > 0) {
    throw new Error('地図の読み込みに失敗しました');
  }

  const svgElement = sanitizeSvgElement(svgDocument.documentElement);
  mapSvgContainer.appendChild(document.importNode(svgElement, true));

  const prefectures = mapSvgContainer.querySelectorAll('.geolonia-svg-map .prefecture');

  prefectures.forEach((prefecture) => {
    const code = normalizeCode(prefecture.dataset.code);
    const titleText = prefecture.querySelector('title')?.textContent || '';
    const displayName = prefectureNames[code] || titleText.split('/')[0]?.trim() || '都道府県';
    prefecture.dataset.name = displayName;
    prefecture.classList.add(`region-${regionClassOf(code)}`);
    prefecture.classList.toggle('no-data', !prefectureData.has(code));
    prefecture.setAttribute('tabindex', '0');

    const bounds = prefecture.getBBox();
    const verticalOffset = labelVerticalOffsets[code] || 0;
    const label = document.createElementNS(svgNamespace, 'text');
    label.setAttribute('class', 'prefecture-label');
    label.setAttribute('x', bounds.x + bounds.width / 2);
    label.setAttribute('y', bounds.y + bounds.height / 2 + verticalOffset);
    label.textContent = displayName;
    label.setAttribute('aria-hidden', 'true');
    prefecture.appendChild(label);

    // クリックとキーボード操作で同じ選択処理を共有する。抽選モード中は地図クリックによる選択自体を無効化する。
    const activate = () => {
      if (pageElement?.classList.contains('is-lottery-mode')) return;
      prefectures.forEach((item) => item.classList.remove('is-selected'));
      prefecture.classList.add('is-selected');
      updateSelection(prefecture);
    };

    // マウスクリックで都道府県を選択する。
    prefecture.addEventListener('click', activate);
    // EnterまたはSpaceで、クリックと同じ選択処理を実行する。
    prefecture.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  });

  // 抽選の対象は、スプレッドシートにまだ紹介回がない都道府県のみ。
  noDataPrefectureElements = Array.from(prefectures).filter((prefecture) => prefecture.classList.contains('no-data'));
  resetLotteryButton();

  selectedHeading.textContent = '';
  renderSelectedVideo(null);
  selectedDetails.replaceChildren();
}

// 読み込み完了後にスプラッシュスクリーンをフェードアウトさせ、操作を可能にする。
function hideSplashScreen() {
  if (!splashScreen) return;
  splashScreen.classList.add('is-hidden');
  splashScreen.addEventListener('transitionend', () => splashScreen.remove(), { once: true });
}

// モバイル表示で情報パネルを読んだ後、地図まで手動でスクロールし直さなくて済むようにする。
backToMapButton?.addEventListener('click', () => {
  mapPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// 抽選ボタンを、抽選できる(まだ紹介されていない都道府県がある)ときだけ押せるようにする。
function resetLotteryButton() {
  if (lotteryButton) lotteryButton.disabled = noDataPrefectureElements.length === 0;
}

function closeLotteryModal() {
  if (lotteryModal) lotteryModal.hidden = true;
}

// 抽選対象からハイライトを取り除く。
function clearLotteryHighlight() {
  noDataPrefectureElements.forEach((prefecture) => {
    prefecture.classList.remove('lottery-highlight', 'lottery-selected');
  });
}

// 実行中の抽選アニメーションを打ち切り、ボタン・地図の状態を初期化する。
function stopLottery() {
  lotteryRunToken += 1;
  isLotteryRunning = false;
  resetLotteryButton();
  clearLotteryHighlight();
}

// 直前と同じ都道府県が連続で光らないよう、除外指定つきでランダムに1件選ぶ。
function pickRandomPrefecture(exclude) {
  if (noDataPrefectureElements.length <= 1) return noDataPrefectureElements[0];

  let candidate;
  do {
    candidate = noDataPrefectureElements[Math.floor(Math.random() * noDataPrefectureElements.length)];
  } while (candidate === exclude);
  return candidate;
}

// 抽選結果をモーダルウィンドウへ表示する。
function showLotteryResult(prefecture) {
  if (lotteryResultName) lotteryResultName.textContent = prefecture.dataset.name || '';
  if (lotteryModal) lotteryModal.hidden = false;
  lotteryModalCloseButton?.focus();
}

// 結果が確定した都道府県を点滅表示してから、モーダルで結果を確定表示する。
function blinkLotteryResult(prefecture, token, remaining = LOTTERY_BLINK_TOGGLES, isOn = true) {
  // モード切替や再実行で無効化された古いループは、遅延タイマーが残っていても何もしない。
  if (token !== lotteryRunToken) return;

  prefecture.classList.toggle('lottery-selected', isOn);

  if (remaining <= 0) {
    prefecture.classList.add('lottery-selected');
    showLotteryResult(prefecture);
    isLotteryRunning = false;
    if (lotteryButton) lotteryButton.disabled = false;
    return;
  }

  setTimeout(() => blinkLotteryResult(prefecture, token, remaining - 1, !isOn), LOTTERY_BLINK_INTERVAL_MS);
}

// クリックのたびに切り替え間隔を徐々に伸ばしながら地図上をランダムに巡回させ、最後に結果を確定する。
function runLottery() {
  if (isLotteryRunning || noDataPrefectureElements.length === 0) return;

  isLotteryRunning = true;
  lotteryRunToken += 1;
  const token = lotteryRunToken;
  if (lotteryButton) lotteryButton.disabled = true;
  clearLotteryHighlight();

  const startTime = performance.now();
  let previous = null;

  const tick = () => {
    // モード切替や再実行で無効化された古いループは、遅延タイマーが残っていても何もしない。
    if (token !== lotteryRunToken) return;

    const progress = Math.min((performance.now() - startTime) / LOTTERY_DURATION_MS, 1);
    const eased = progress * progress;
    const interval = LOTTERY_START_INTERVAL_MS + (LOTTERY_END_INTERVAL_MS - LOTTERY_START_INTERVAL_MS) * eased;

    if (previous) previous.classList.remove('lottery-highlight');

    if (progress >= 1) {
      const winner = pickRandomPrefecture(previous);
      blinkLotteryResult(winner, token);
      return;
    }

    const candidate = pickRandomPrefecture(previous);
    candidate.classList.add('lottery-highlight');
    previous = candidate;
    setTimeout(tick, interval);
  };

  tick();
}

// トグルスイッチで抽選モードの表示を切り替える。抽選モードを抜けるときは進行中の抽選も打ち切る。
lotteryModeToggle?.addEventListener('change', () => {
  pageElement?.classList.toggle('is-lottery-mode', lotteryModeToggle.checked);
  if (!lotteryModeToggle.checked) {
    stopLottery();
    closeLotteryModal();
  }
});

lotteryButton?.addEventListener('click', runLottery);

lotteryModalCloseButton?.addEventListener('click', closeLotteryModal);

// 背景（オーバーレイ）自体のクリックでも閉じられるようにする。
lotteryModal?.addEventListener('click', (event) => {
  if (event.target === lotteryModal) closeLotteryModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeLotteryModal();
});

// 地図の読み込みに失敗した場合、タイトルロゴを保持したままエラーメッセージを添える。
function showMapError(message) {
  mapSvgContainer.appendChild(textElement('p', 'error', message));
}

// スプレッドシート・ショップURLの事前チェック結果・地図SVGは互いに依存しない通信のため並行して取得し、地図を初期化する。
// スプレッドシートを読めなかったときのメッセージは、地図の描画(情報パネルを初期状態に戻す)のあとに出す
// (先に出すと、地図の描画で消されて表示されない)。
async function initialize() {
  let spreadsheetError = null;
  const spreadsheetPromise = loadSpreadsheetData().catch((error) => {
    spreadsheetError = error;
  });

  const [, , svgText] = await Promise.all([spreadsheetPromise, loadShopStatus(), fetchMapSvg()]);
  renderMap(svgText);
  if (spreadsheetError) {
    selectedDetails.replaceChildren(textElement('p', 'data-status', spreadsheetError.message));
  }
}

initialize()
  .catch((error) => {
    showMapError(error.message);
  })
  .finally(() => {
    hideSplashScreen();
  });
