// 公開スプレッドシート(XLSX)の読み方。サイト(js/script.js)と、ショップURLの疎通チェック
// (scripts/check-shop-urls.mjs)の両方が使う。どちらも同じ読み方をするので、表示されるショップと
// チェックされるショップが食い違わない(読み方を変えるときは、このファイルだけを直す)。
//
// ブラウザではクラシックスクリプトとして、Node.js では副作用のある import として読み込まれ、
// どちらでも globalThis.TeaTimeSheet に関数をまとめて置く。SheetJS(XLSX)は呼び出し側から渡す。
(function (root) {
  const prefectureNames = {
    '01': '北海道', '02': '青森県', '03': '岩手県', '04': '宮城県', '05': '秋田県', '06': '山形県', '07': '福島県',
    '08': '茨城県', '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県', '13': '東京都', '14': '神奈川県',
    '15': '新潟県', '16': '富山県', '17': '石川県', '18': '福井県', '19': '山梨県', '20': '長野県', '21': '岐阜県',
    '22': '静岡県', '23': '愛知県', '24': '三重県', '25': '滋賀県', '26': '京都府', '27': '大阪府', '28': '兵庫県',
    '29': '奈良県', '30': '和歌山県', '31': '鳥取県', '32': '島根県', '33': '岡山県', '34': '広島県', '35': '山口県',
    '36': '徳島県', '37': '香川県', '38': '愛媛県', '39': '高知県', '40': '福岡県', '41': '佐賀県', '42': '長崎県',
    '43': '熊本県', '44': '大分県', '45': '宮崎県', '46': '鹿児島県', '47': '沖縄県'
  };

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

  // 見出し文から都道府県コードを特定する。「兵庫県編」「兵庫編」のどちらの書き方でも当てる。
  // 「東京都」の「都」も省いた形で当てる(「東京編」)。「東京都編」は「京都編」も含むが、
  // コードの小さい東京都から順に調べるので京都府にはならない。
  function codeForSpreadsheetHeading(heading) {
    return Object.entries(prefectureNames).find(([, name]) => {
      const shortName = name.replace(/[都府県]$/, '');
      return heading.includes(`${name}編`) || heading.includes(`${shortName}編`);
    })?.[0] || '';
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

  // 結合セルは各行に値が複製されないため、対象セルを含む範囲の先頭セルを参照する。
  function getMergedCell(XLSX, sheet, rowIndex, columnIndex) {
    const merge = (sheet['!merges'] || []).find((range) => (
      range.s.c <= columnIndex && range.e.c >= columnIndex
        && range.s.r <= rowIndex && range.e.r >= rowIndex
    ));

    const sourceRow = merge?.s.r ?? rowIndex;
    return sheet[XLSX.utils.encode_cell({ r: sourceRow, c: columnIndex })];
  }

  // 全シートを読み、都道府県コードごとの回(見出し・動画URL・行)にまとめる。
  // XLSXを直接解析することで、CSV変換時に失われる結合セルとリンク情報を保持する。
  function parseWorkbook(XLSX, workbook) {
    const blocks = new Map();
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      let currentBlock = null;

      rows.forEach((row, rowIndex) => {
        const firstCell = cellText(row[0]);
        const code = codeForSpreadsheetHeading(firstCell);

        if (code) {
          const headingCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 0 })];
          currentBlock = {
            title: firstCell,
            videoUrl: headingCell?.l?.Target || '',
            rows: []
          };
          blocks.set(code, currentBlock);
          return;
        }

        if (currentBlock && row.some((cell) => cellText(cell))) {
          const shopCell = getMergedCell(XLSX, sheet, rowIndex, 2);
          currentBlock.rows.push({
            cells: row,
            shopName: cellText(shopCell?.v),
            shopUrl: shopCell?.l?.Target || ''
          });
        }
      });
    });
    return blocks;
  }

  // 1回分の行を、表示する順に「見出し」と「項目」へ読み替える。
  //   { type: 'section', title }                       … カテゴリの見出し(「食べてみたいランキング」など)
  //   { type: 'item', rank, name, shopName, shopUrl }  … 商品。rank は順位(無ければ '')、shopUrl は http(s) のものだけ
  function blockEntries(block) {
    const entries = [];
    let currentSectionIsRanking = false;
    let previousRank = '';

    block.rows.forEach((rowData) => {
      const values = rowData.cells.map(cellText);
      if (!values.some(Boolean) || values[0] === '👑') return;

      const isRankedItem = isNumberedItem(values[0]);
      const isSectionHeading = !isRankedItem && Boolean(values[0]) && values.slice(1).every((value) => !value);

      if (isSectionHeading) {
        entries.push({ type: 'section', title: values[0] });
        currentSectionIsRanking = values[0].includes('ランキング');
        previousRank = '';
        return;
      }

      // 結合セルで順位が空欄になった行は、同じランキング内の直前順位を引き継ぐ。
      const inheritedRank = currentSectionIsRanking && !values[0] && previousRank;
      const rank = isRankedItem ? values[0] : (inheritedRank || '');
      if (isRankedItem) previousRank = values[0];

      const itemIndex = rank ? 1 : (values[0] ? 0 : 1);
      const shopName = values[itemIndex + 1] || rowData.shopName || '';
      entries.push({
        type: 'item',
        rank,
        name: values[itemIndex] || '',
        shopName,
        shopUrl: safeHttpUrl(rowData.shopUrl || (/^https?:\/\//i.test(shopName) ? shopName : ''))
      });
    });
    return entries;
  }

  root.TeaTimeSheet = {
    prefectureNames,
    cellText,
    normalizeCode,
    codeForSpreadsheetHeading,
    safeHttpUrl,
    parseWorkbook,
    blockEntries
  };
})(globalThis);
