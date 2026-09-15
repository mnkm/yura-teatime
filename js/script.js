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

const mapContainer = document.querySelector('#map');
const selectedHeading = document.querySelector('#selected-heading');
const selectedVideo = document.querySelector('#selected-video');
const selectedDetails = document.querySelector('#selected-details');
const svgNamespace = 'http://www.w3.org/2000/svg';
const spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/1TKqXbi7JbfVjlm7O1LxXh2Q-AA9V5sJN51b0eK_wCHg/export?format=xlsx';
let prefectureData = new Map();

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function codeForSpreadsheetHeading(heading) {
  return Object.entries(prefectureNames).find(([, name]) => {
    const shortName = name.replace(/[県府]$/, '');
    return heading.includes(`${name}編`) || heading.includes(`${shortName}編`);
  })?.[0] || '';
}

function youtubeEmbedUrl(url) {
  if (!url) return '';

  try {
    const parsedUrl = new URL(url);
    const liveMatch = parsedUrl.pathname.match(/^\/live\/([^/]+)/);
    const watchId = parsedUrl.searchParams.get('v');
    const shortMatch = parsedUrl.hostname === 'youtu.be' ? parsedUrl.pathname.match(/^\/([^/]+)/) : null;
    const videoId = liveMatch?.[1] || watchId || shortMatch?.[1];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : '';
  } catch {
    return '';
  }
}

function parseHeadingText(heading) {
  const dateMatch = heading.match(/^(\d{2})\.(\d{1,2})\/(\d{1,2})/);
  const hashIndex = heading.indexOf('#');
  const dateLabel = dateMatch
    ? `${2000 + Number(dateMatch[1])}年${Number(dateMatch[2])}月${Number(dateMatch[3])}日 配信`
    : '';
  const title = hashIndex >= 0 ? heading.slice(hashIndex).trim() : '';

  return { dateLabel, title };
}

function renderSelectedVideo(data) {
  selectedVideo.replaceChildren();
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
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.title = '都道府県紹介動画';
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    videoFrame.appendChild(iframe);
  }
  selectedVideo.appendChild(videoFrame);

  if (title) {
    const caption = document.createElement('p');
    caption.className = 'video-title';
      if (data?.videoUrl) {
        const link = document.createElement('a');
        link.href = data.videoUrl;
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

async function loadSpreadsheetData() {
  const response = await fetch(spreadsheetUrl);
  if (!response.ok) {
    throw new Error('スプレッドシートを読み込めませんでした');
  }

  const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    let currentBlock = null;

    rows.forEach((row, rowIndex) => {
      const firstCell = String(row[0] ?? '').trim();
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

      if (currentBlock && row.some((cell) => String(cell ?? '').trim())) {
        const shopMerge = (sheet['!merges'] || []).find((merge) => (
          merge.s.c <= 2 && merge.e.c >= 2 && merge.s.r <= rowIndex && merge.e.r >= rowIndex
        ));
        const shopRowIndex = shopMerge?.s.r ?? rowIndex;
        const shopCell = sheet[XLSX.utils.encode_cell({ r: shopRowIndex, c: 2 })];
        currentBlock.rows.push({
          cells: row,
          shopName: String(shopCell?.v ?? '').trim(),
          shopUrl: shopCell?.l?.Target || ''
        });
      }
    });
  });
}

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
    const values = row.map((cell) => String(cell ?? '').trim());
    const hasValue = values.some(Boolean);
    if (!hasValue || values[0] === '👑') return;

    const isRankedItem = /^\d+$/.test(values[0]);
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

    const inheritedRank = currentSectionIsRanking && !values[0] && previousRank;
    const rankValue = isRankedItem ? values[0] : inheritedRank;
    const shouldShowRank = Boolean(rankValue);
    if (isRankedItem) previousRank = values[0];

    const item = document.createElement('li');
    const itemIndex = shouldShowRank ? 1 : (values[0] ? 0 : 1);
    const itemName = values[itemIndex] || '';
    const shopName = values[itemIndex + 1] || rowData.shopName || '';
    const shopUrl = rowData.shopUrl || (/^https?:\/\//i.test(shopName) ? shopName : '');
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

    if (shopName) {
      const shop = document.createElement('span');
      shop.className = 'shop-line';
      if (shopUrl) {
        const link = document.createElement('a');
        link.href = shopUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = shopName;
        shop.appendChild(link);
      } else {
        shop.textContent = shopName;
      }
      content.appendChild(shop);
    }
    items.appendChild(item);
  });
}

function updateSelection(prefectureElement) {
  const code = (prefectureElement.dataset.code || '').padStart(2, '0');
  const name = prefectureElement.dataset.name || prefectureNames[code] || '都道府県';

  selectedHeading.textContent = name;
  renderSelectedVideo(prefectureData.get(code));
  renderSpreadsheetData(code);
}

async function loadMap() {
  const svgUrl = 'https://raw.githubusercontent.com/geolonia/japanese-prefectures/master/map-polygon.svg';
  const response = await fetch(svgUrl);

  if (!response.ok) {
    throw new Error('地図の読み込みに失敗しました');
  }

  const svgText = await response.text();
  mapContainer.innerHTML = svgText;

  const prefectures = mapContainer.querySelectorAll('.geolonia-svg-map .prefecture');

  prefectures.forEach((prefecture) => {
    const code = (prefecture.dataset.code || '').padStart(2, '0');
    const titleText = prefecture.querySelector('title')?.textContent || '';
    const displayName = prefectureNames[code] || titleText.split('/')[0]?.trim() || '都道府県';
    const region = regionNames[code] || '';
    prefecture.dataset.name = displayName;
    prefecture.classList.add(`region-${regionClasses[region] || 'other'}`);
    prefecture.classList.toggle('no-data', !prefectureData.has(code));
    prefecture.setAttribute('tabindex', '0');

    const bounds = prefecture.getBBox();
    const label = document.createElementNS(svgNamespace, 'text');
    label.setAttribute('class', 'prefecture-label');
    label.setAttribute('x', bounds.x + bounds.width / 2);
    label.setAttribute('y', bounds.y + bounds.height / 2);
    label.textContent = displayName;
    label.setAttribute('aria-hidden', 'true');
    prefecture.appendChild(label);

    const activate = () => {
      prefectures.forEach((item) => item.classList.remove('is-selected'));
      prefecture.classList.add('is-selected');
      updateSelection(prefecture);
    };

    prefecture.addEventListener('click', activate);
    prefecture.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  });

  const defaultPref = [...prefectures].find((prefecture) => prefecture.dataset.code === '13');
  if (defaultPref) {
    defaultPref.classList.add('is-selected');
    updateSelection(defaultPref);
  }
}

async function initialize() {
  try {
    await loadSpreadsheetData();
  } catch (error) {
    const status = document.createElement('p');
    status.className = 'data-status';
    status.textContent = error.message;
    selectedDetails.replaceChildren(status);
  }

  await loadMap();
}

initialize().catch((error) => {
  mapContainer.innerHTML = `<p class="error">${error.message}</p>`;
});
