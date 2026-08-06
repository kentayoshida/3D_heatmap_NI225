// UI string tables (ja / en) and the Nikkei sector JA→EN map for the language
// toggle. Stock/period/index labels that are already latin (1D, NIKKEI, …) are
// not translated. US sectors are GICS English already, so they pass through.

export const LANGS = ['ja', 'en'];

export const UI = {
  ja: {
    langLabel: '日本語',
    asOf: 'データ基準日', sample: 'サンプル', jst: 'JST', et: 'ET', ist: 'IST',
    legHeight: '<b>高さ</b> = 騰落率（0%基準・{dir}）',
    dirUp: '上=プラス/下=マイナス', dirDown: '上=マイナス/下=プラス',
    legArea: '<b>面積</b> = 比率（ウェイト）',
    legVolume: '<b>体積</b> = 寄与度（比率 × 騰落率）',
    down: '下落', up: '上昇',
    hint: 'ドラッグで回転・ホイールで拡大縮小',
    transparency: '透明度', direction: '向き', xray: 'X線',
    invertOff: 'プラス上 / マイナス下', invertOn: 'プラス下 / マイナス上',
    ttChange: '騰落率', ttWeight: '比率', ttContribution: '寄与度',
    // snapshot & share
    shareOpen: 'スクリーンショットを共有', shareImage: '画像を保存 / 共有',
    shareX: 'X', shareLine: 'LINE', shareCopy: 'リンク',
    shareCta: '3Dで動く株価指数ヒートマップ。ぜひ体験してみてください。',
    shareHashtag: '#3Dヒートマップ', shareBrand: '3D株価指数ヒートマップ',
    shareFooterCta: 'ブラウザで回して見る 3D ヒートマップ',
    toastShared: '共有しました', toastSaved: '画像を保存しました',
    toastSavedAttach: '画像を保存しました。投稿画面で添付してください',
    toastCopied: 'リンクをコピーしました', toastFailed: '共有に失敗しました',
    // timeline animation
    tlLabel: '直近5営業日', tlPlay: '再生', tlPause: '一時停止', tlDay: '日次',
    // loading overlay
    loading: '読み込み中', hyperLoading: 'ハイパースペース航行中', loadingHint: '初回はデータ取得に時間がかかる場合があります', sec: '秒',
  },
  en: {
    langLabel: 'EN',
    asOf: 'As of', sample: 'sample', jst: 'JST', et: 'ET', ist: 'IST',
    legHeight: '<b>Height</b> = Change % (0% base · {dir})',
    dirUp: 'up = gain / down = loss', dirDown: 'up = loss / down = gain',
    legArea: '<b>Area</b> = Index weight',
    legVolume: '<b>Volume</b> = Contribution (weight × change)',
    down: 'Loss', up: 'Gain',
    hint: 'Drag to rotate · scroll to zoom',
    transparency: 'Transparency', direction: 'Direction', xray: 'X-ray',
    invertOff: 'Gain up / Loss down', invertOn: 'Gain down / Loss up',
    ttChange: 'Change', ttWeight: 'Weight', ttContribution: 'Contribution',
    // snapshot & share
    shareOpen: 'Share a screenshot', shareImage: 'Save / share image',
    shareX: 'X', shareLine: 'LINE', shareCopy: 'Link',
    shareCta: 'An interactive 3D stock-index heatmap — take a look.',
    shareHashtag: '#3DHeatmap', shareBrand: '3D Stock-Index Heatmap',
    shareFooterCta: 'Spin it in your browser — a 3D heatmap',
    toastShared: 'Shared', toastSaved: 'Image saved',
    toastSavedAttach: 'Image saved — attach it in the compose window',
    toastCopied: 'Link copied', toastFailed: 'Share failed',
    // timeline animation
    tlLabel: 'Last 5 sessions', tlPlay: 'Play', tlPause: 'Pause', tlDay: 'Daily',
    // loading overlay
    loading: 'Loading', hyperLoading: 'Jumping to lightspeed', loadingHint: 'The first load can take a moment to fetch data', sec: 's',
  },
};

// TSE 33-sector classification, Japanese → English (official-style names).
// Variants used in the data (e.g. 証券業) are included alongside the full names.
export const SECTOR_EN = {
  '水産・農林業': 'Fishery, Agriculture & Forestry',
  '鉱業': 'Mining',
  '建設業': 'Construction',
  '食料品': 'Foods',
  '繊維製品': 'Textiles & Apparels',
  'パルプ・紙': 'Pulp & Paper',
  '化学': 'Chemicals',
  '医薬品': 'Pharmaceuticals',
  '石油・石炭製品': 'Oil & Coal Products',
  'ゴム製品': 'Rubber Products',
  'ガラス・土石製品': 'Glass & Ceramics Products',
  '鉄鋼': 'Iron & Steel',
  '非鉄金属': 'Nonferrous Metals',
  '金属製品': 'Metal Products',
  '機械': 'Machinery',
  '電気機器': 'Electric Appliances',
  '輸送用機器': 'Transportation Equipment',
  '精密機器': 'Precision Instruments',
  'その他製品': 'Other Products',
  '電気・ガス業': 'Electric Power & Gas',
  '陸運業': 'Land Transportation',
  '海運業': 'Marine Transportation',
  '空運業': 'Air Transportation',
  '倉庫・運輸関連業': 'Warehousing & Harbor Transportation',
  '情報・通信業': 'Information & Communication',
  '卸売業': 'Wholesale Trade',
  '小売業': 'Retail Trade',
  '銀行業': 'Banks',
  '証券・商品先物取引業': 'Securities & Commodity Futures',
  '証券業': 'Securities',
  'その他金融業': 'Other Financing Business',
  '保険業': 'Insurance',
  '不動産業': 'Real Estate',
  'サービス業': 'Services',
  '未分類': 'Unclassified',
};

// Sector display: translate Nikkei JA sectors in EN mode; pass others through
// (US GICS sectors are already English).
export function sectorLabel(sector, lang) {
  if (lang !== 'en') return sector;
  return SECTOR_EN[sector] || sector;
}
