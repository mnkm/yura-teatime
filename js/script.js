const prefectureNames = {
  '01': '北海道', '02': '青森県', '03': '岩手県', '04': '宮城県', '05': '秋田県', '06': '山形県', '07': '福島県',
  '08': '茨城県', '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県', '13': '東京都', '14': '神奈川県',
  '15': '新潟県', '16': '富山県', '17': '石川県', '18': '福井県', '19': '山梨県', '20': '長野県', '21': '岐阜県',
  '22': '静岡県', '23': '愛知県', '24': '三重県', '25': '滋賀県', '26': '京都府', '27': '大阪府', '28': '兵庫県',
  '29': '奈良県', '30': '和歌山県', '31': '鳥取県', '32': '島根県', '33': '岡山県', '34': '広島県', '35': '山口県',
  '36': '徳島県', '37': '香川県', '38': '愛媛県', '39': '高知県', '40': '福岡県', '41': '佐賀県', '42': '長崎県',
  '43': '熊本県', '44': '大分県', '45': '宮崎県', '46': '鹿児島県', '47': '沖縄県'
};

const regionNames = {
  '01': '北海道地方', '02': '東北地方', '03': '東北地方', '04': '東北地方', '05': '東北地方', '06': '東北地方', '07': '東北地方',
  '08': '関東地方', '09': '関東地方', '10': '関東地方', '11': '関東地方', '12': '関東地方', '13': '関東地方', '14': '関東地方',
  '15': '中部地方', '16': '中部地方', '17': '中部地方', '18': '中部地方', '19': '中部地方', '20': '中部地方', '21': '中部地方',
  '22': '中部地方', '23': '中部地方', '24': '近畿地方', '25': '近畿地方', '26': '近畿地方', '27': '近畿地方', '28': '近畿地方',
  '29': '近畿地方', '30': '近畿地方', '31': '中国地方', '32': '中国地方', '33': '中国地方', '34': '中国地方', '35': '中国地方',
  '36': '四国地方', '37': '四国地方', '38': '四国地方', '39': '四国地方', '40': '九州地方', '41': '九州地方', '42': '九州地方',
  '43': '九州地方', '44': '九州地方', '45': '九州地方', '46': '九州地方', '47': '九州地方'
};

const regionClasses = {
  '北海道地方': 'hokkaido',
  '東北地方': 'tohoku',
  '関東地方': 'kanto',
  '中部地方': 'chubu',
  '近畿地方': 'kinki',
  '中国地方': 'chugoku',
  '四国地方': 'shikoku',
  '九州地方': 'kyushu'
};

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
const svgNamespace = 'http://www.w3.org/2000/svg';
const spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/1TKqXbi7JbfVjlm7O1LxXh2Q-AA9V5sJN51b0eK_wCHg/export?format=xlsx';
let prefectureData = new Map();

// スプレッドシート由来の値を安全に文字列へ変換し、前後の空白を除去する。
function cellText(value) {
  return String(value ?? '').trim();
}

// 地図とスプレッドシートで異なる都道府県コード表記を2桁に統一する。
function normalizeCode(value) {
  return cellText(value).padStart(2, '0');
}

// セルの値がランキング番号として扱えるか判定する。
function isNumberedItem(value) {
  return /^\d+$/.test(value);
}

// 見出し文から都道府県コードを特定する。
function codeForSpreadsheetHeading(heading) {
  return Object.entries(prefectureNames).find(([, name]) => {
    const shortName = name.replace(/[県府]$/, '');
    return heading.includes(`${name}編`) || heading.includes(`${shortName}編`);
  })?.[0] || '';
}

// YouTubeの各種URLをiframe埋め込み用URLへ変換する。
function youtubeEmbedUrl(url) {
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
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)
      ? `https://www.youtube.com/embed/${videoId}?rel=0`
      : '';
  } catch {
    return '';
  }
}

// YouTube動画IDから、プレイヤー読み込み失敗時に使うサムネイルURLを作成する。
function youtubeThumbnailUrl(url) {
  const embedUrl = youtubeEmbedUrl(url);
  if (!embedUrl) return '';

  const videoId = embedUrl.split('/embed/')[1]?.split('?')[0];
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
}

// 外部データ由来のリンクはHTTP(S)だけを許可し、javascript:などを排除する。
function safeHttpUrl(value) {
  if (!value) return '';

  try {
    const parsedUrl = new URL(value);
    return /^https?:$/.test(parsedUrl.protocol) ? parsedUrl.href : '';
  } catch {
    return '';
  }
}

// GitHub ActionsがCI上で定期的に検証し、HTTP 4xxが確認できたショップURLを記録した静的データ。
// ブラウザからのfetchは多くの外部サイトでCORSにより検証できないため、事前チェック結果を利用する。
const shopStatusUrl = 'data/shop-status.json';
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
    const status = document.createElement('p');
    status.className = 'video-status';
    status.textContent = '都道府県を選択してください';
    videoFrame.appendChild(status);
    selectedVideo.appendChild(videoFrame);
    selectedVideo.classList.add('is-visible');
    return;
  }

  const { dateLabel, title } = data ? parseHeadingText(data.title) : {};

  if (dateLabel) {
    const date = document.createElement('p');
    date.className = 'video-date';
    date.textContent = dateLabel;
    selectedVideo.appendChild(date);
  }

  const videoFrame = document.createElement('div');
  videoFrame.className = 'video-frame';
  const embedUrl = youtubeEmbedUrl(data?.videoUrl);
  if (!embedUrl) {
    const status = document.createElement('p');
    status.className = 'video-status';
    status.textContent = 'Coming soon...';
    videoFrame.appendChild(status);
  } else {
    // プレイヤーの読み込み中・失敗時の代替表示として、まずサムネイルを背景に敷いておく。
    const thumbnailUrl = youtubeThumbnailUrl(data?.videoUrl);
    if (thumbnailUrl) {
      videoFrame.style.backgroundImage = `url("${thumbnailUrl}")`;
    }

    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.title = '都道府県紹介動画';
    iframe.loading = 'eager';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    // src自体はyoutube.com/embed/配下に限定済みだが、多層防御としてsandboxで許可範囲を明示する。
    iframe.sandbox = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';
    // プレイヤーを表示できたらサムネイルは不要になるため取り除く。
    iframe.addEventListener('load', () => {
      videoFrame.style.backgroundImage = '';
    });
    videoFrame.appendChild(iframe);
  }
  selectedVideo.appendChild(videoFrame);

  if (title) {
    const caption = document.createElement('p');
    caption.className = 'video-title';
    const videoLink = safeHttpUrl(data?.videoUrl);
    if (videoLink) {
      const link = document.createElement('a');
      link.href = videoLink;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = title;
      caption.appendChild(link);
    } else {
      caption.textContent = title;
    }
    selectedVideo.appendChild(caption);
  }
  selectedVideo.classList.add('is-visible');
}

// 結合セルは各行に値が複製されないため、対象セルを含む範囲の先頭セルを参照する。
function getMergedCell(sheet, rowIndex, columnIndex) {
  const merge = (sheet['!merges'] || []).find((range) => (
    range.s.c <= columnIndex && range.e.c >= columnIndex
      && range.s.r <= rowIndex && range.e.r >= rowIndex
  ));

  const sourceRow = merge?.s.r ?? rowIndex;
  return sheet[XLSX.utils.encode_cell({ r: sourceRow, c: columnIndex })];
}

// 公開XLSXの全シートを読み込み、都道府県単位のデータへ変換する。
async function loadSpreadsheetData() {
  const response = await fetch(spreadsheetUrl);
  if (!response.ok) {
    throw new Error('スプレッドシートを読み込めませんでした');
  }

  const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
  // XLSXを直接解析することで、CSV変換時に失われる結合セルとリンク情報を保持する。
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    let currentBlock = null;

    rows.forEach((row, rowIndex) => {
      const firstCell = cellText(row[0]);
      const code = codeForSpreadsheetHeading(firstCell);

      if (code) {
        const headingCell = sheet[`A${rowIndex + 1}`];
        currentBlock = {
          title: firstCell,
          videoUrl: headingCell?.l?.Target || '',
          rows: []
        };
        prefectureData.set(code, currentBlock);
        return;
      }

      if (currentBlock && row.some((cell) => cellText(cell))) {
        const shopCell = getMergedCell(sheet, rowIndex, 2);
        currentBlock.rows.push({
          cells: row,
          shopName: cellText(shopCell?.v),
          shopUrl: shopCell?.l?.Target || ''
        });
      }
    });
  });
}

// 選択された都道府県のカテゴリ、商品、ショップ情報をカードとして描画する。
function renderSpreadsheetData(code) {
  selectedDetails.replaceChildren();
  const data = prefectureData.get(code);

  if (!data) {
    return;
  }

  let currentSectionIsRanking = false;
  let previousRank = '';

  data.rows.forEach((rowData) => {
    const row = rowData.cells;
    const values = row.map(cellText);
    const hasValue = values.some(Boolean);
    if (!hasValue || values[0] === '👑') return;

    const isRankedItem = isNumberedItem(values[0]);
    const isSectionHeading = !isRankedItem && Boolean(values[0]) && values.slice(1).every((value) => !value);

    if (isSectionHeading) {
      const section = document.createElement('section');
      section.className = 'data-section';
      const heading = document.createElement('h3');
      heading.textContent = values[0];
      section.appendChild(heading);
      selectedDetails.appendChild(section);
      currentSectionIsRanking = values[0].includes('ランキング');
      previousRank = '';
      return;
    }

    let list = selectedDetails.lastElementChild;
    if (!list || !list.classList.contains('data-section')) {
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

    // 結合セルで順位が空欄になった行は、同じランキング内の直前順位を引き継ぐ。
    const inheritedRank = currentSectionIsRanking && !values[0] && previousRank;
    const rankValue = isRankedItem ? values[0] : inheritedRank;
    const shouldShowRank = Boolean(rankValue);
    if (isRankedItem) previousRank = values[0];

    const item = document.createElement('li');
    const itemIndex = shouldShowRank ? 1 : (values[0] ? 0 : 1);
    const itemName = values[itemIndex] || '';
    const shopName = values[itemIndex + 1] || rowData.shopName || '';
    const shopUrl = safeHttpUrl(rowData.shopUrl || (/^https?:\/\//i.test(shopName) ? shopName : ''));
    item.classList.toggle('ranked-item', shouldShowRank);
    if (shouldShowRank) {
      const rank = document.createElement('span');
      rank.className = 'card-rank';
      rank.textContent = `${rankValue}.`;
      item.appendChild(rank);
    }

    const content = document.createElement('span');
    content.className = 'card-content';
    content.textContent = itemName;
    item.appendChild(content);

    if (shopName && shopUrl && !brokenShopUrls.has(shopUrl)) {
      const shop = document.createElement('span');
      shop.className = 'shop-line';
      const link = document.createElement('a');
      link.href = shopUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = shopName;
      shop.appendChild(link);
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
  const svgUrl = 'img/map-polygon.svg';
  const response = await fetch(svgUrl);

  if (!response.ok) {
    throw new Error('地図の読み込みに失敗しました');
  }

  return response.text();
}

// 外部由来のSVGに<script>やイベントハンドラ属性が紛れ込んでいた場合に備え、挿入前に取り除く。
// DOMParserで解析したSVGはinnerHTML代入と異なりappendChildで挿入すると<script>が実行されるため、
// ベンダリング済みで現状安全なファイルであっても多層防御として必ず通す。
function sanitizeSvgElement(root) {
  root.querySelectorAll('script, foreignObject').forEach((node) => node.remove());

  // querySelectorAll('*')は起点ノード自身を含まないため、rootを明示的に含めて処理する。
  [root, ...root.querySelectorAll('*')].forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || (/^(?:xlink:href|href)$/.test(name) && /^\s*javascript:/i.test(attr.value))) {
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
    const region = regionNames[code] || '';
    prefecture.dataset.name = displayName;
    prefecture.classList.add(`region-${regionClasses[region] || 'other'}`);
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

    // クリックとキーボード操作で同じ選択処理を共有する。
    const activate = () => {
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

// 地図の読み込みに失敗した場合、タイトルロゴを保持したままエラーメッセージを添える。
function showMapError(message) {
  const status = document.createElement('p');
  status.className = 'error';
  status.textContent = message;
  mapSvgContainer.appendChild(status);
}

// スプレッドシート・ショップURLの事前チェック結果・地図SVGは互いに依存しない通信のため並行して取得し、地図を初期化する。
async function initialize() {
  const spreadsheetPromise = loadSpreadsheetData().catch((error) => {
    const status = document.createElement('p');
    status.className = 'data-status';
    status.textContent = error.message;
    selectedDetails.replaceChildren(status);
  });

  const [, , svgText] = await Promise.all([spreadsheetPromise, loadShopStatus(), fetchMapSvg()]);
  renderMap(svgText);
}

initialize()
  .catch((error) => {
    showMapError(error.message);
  })
  .finally(() => {
    hideSplashScreen();
  });
