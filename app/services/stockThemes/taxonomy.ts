/**
 * @file 股票日報「產業別 ＋ AI／趨勢題材」分類字典；純資料，不含任何網路副作用。
 *
 * 【詳細繁體中文註解】：
 * 1. TWSE_INDUSTRY_CODES：證交所 OpenAPI（t187ap03_L）回傳的「產業別」只有兩碼代號，需在此翻成中文。
 * 2. US_SECTOR_ZH：Nasdaq 公開篩選器回傳英文 Sector，翻成繁體中文方便 Slack 閱讀。
 * 3. THEME_DEFINITIONS：AI 與熱門趨勢題材定義。每個題材帶有「AI 關聯等級」：
 *    - CORE（🤖 AI 核心）：營收直接來自 AI 算力，例如 AI 晶片、伺服器、HBM、先進封裝、AI 雲端。
 *    - RELATED（🔌 AI 供應鏈／受惠）：AI 擴產的間接受惠，例如散熱、PCB/CPO 高速傳輸、AI 用電、機器人。
 *    - TREND（🔥 熱門趨勢，非 AI 直接）：低軌衛星、電動車、加密貨幣、量子、減重藥、國防、資安、綠能。
 *    - NONE（🏭 傳統／非主流題材）：沒有命中任何題材的一般產業。
 * 4. 題材歸類採「人工維護名單優先、關鍵字次之、AI 推估最後」三層，名單只代表市場常見歸類，
 *    不代表該公司 AI 營收占比，也不構成投資建議；名單需隨產業變化定期人工更新。
 */

/** AI 關聯等級；數字越大代表與 AI 越直接，排序與取最大值時使用。 */
export type AiRelevance = 'NONE' | 'TREND' | 'RELATED' | 'CORE';

export const AI_RELEVANCE_RANK: Record<AiRelevance, number> = { NONE: 0, TREND: 1, RELATED: 2, CORE: 3 };

/** Slack 顯示用的等級標籤（含 emoji），所有市場共用同一套文字，避免台美股日報用語不一致。 */
export const AI_RELEVANCE_LABEL: Record<AiRelevance, string> = {
  CORE: '🤖 AI 核心',
  RELATED: '🔌 AI 供應鏈',
  TREND: '🔥 熱門趨勢',
  NONE: '🏭 傳統產業',
};

export interface ThemeDefinition {
  id: string;
  /** Slack 顯示的題材短名稱，保持 8 字內避免卡片換行過多。 */
  label: string;
  aiRelevance: AiRelevance;
  /** 台股人工名單（不含 .TW／.TWO 後綴）。 */
  twSymbols: string[];
  /** 美股人工名單（大寫代號）。 */
  usSymbols: string[];
  /** 比對「產業名稱＋公司名稱」的關鍵字；只在人工名單未命中時使用，刻意保守避免誤判。 */
  keywords: RegExp[];
}

/** 證交所上市公司產業別代號 → 中文名稱。未列出的代號會直接顯示「產業代號 XX」。 */
export const TWSE_INDUSTRY_CODES: Record<string, string> = {
  '01': '水泥工業', '02': '食品工業', '03': '塑膠工業', '04': '紡織纖維', '05': '電機機械',
  '06': '電器電纜', '08': '玻璃陶瓷', '09': '造紙工業', '10': '鋼鐵工業', '11': '橡膠工業',
  '12': '汽車工業', '14': '建材營造', '15': '航運業', '16': '觀光餐旅', '17': '金融保險',
  '18': '貿易百貨', '19': '綜合', '20': '其他業', '21': '化學工業', '22': '生技醫療',
  '23': '油電燃氣', '24': '半導體業', '25': '電腦及週邊設備', '26': '光電業', '27': '通信網路',
  '28': '電子零組件', '29': '電子通路', '30': '資訊服務', '31': '其他電子', '32': '文化創意',
  '33': '農業科技', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒',
  '38': '居家生活', '91': '存託憑證',
};

/** Nasdaq Sector 英文 → 繁體中文。 */
export const US_SECTOR_ZH: Record<string, string> = {
  Technology: '科技', 'Health Care': '醫療保健', Finance: '金融', 'Consumer Discretionary': '非必需消費',
  'Consumer Staples': '必需消費', Industrials: '工業', Energy: '能源', Utilities: '公用事業',
  'Real Estate': '不動產', Telecommunications: '電信', 'Basic Materials': '原物料', Miscellaneous: '其他',
};

export const THEME_DEFINITIONS: ThemeDefinition[] = [
  // ───────── 🤖 AI 核心 ─────────
  {
    id: 'AI_CHIP', label: 'AI 晶片/晶圓代工', aiRelevance: 'CORE',
    twSymbols: ['2330', '2454', '3661', '3443', '3035', '2303', '5274', '3529', '2379', '6643'],
    usSymbols: ['NVDA', 'AMD', 'AVGO', 'TSM', 'INTC', 'QCOM', 'ARM', 'MRVL', 'ALAB', 'CRDO', 'MPWR'],
    keywords: [],
  },
  {
    id: 'AI_SERVER', label: 'AI 伺服器', aiRelevance: 'CORE',
    twSymbols: ['2317', '2382', '3231', '6669', '2356', '2376', '2357', '2324', '4938', '3706', '8210', '2353'],
    usSymbols: ['SMCI', 'DELL', 'HPE', 'CRWV', 'NBIS'],
    keywords: [/AI\s*伺服器|AI\s*server/i],
  },
  {
    id: 'ADV_PACKAGING', label: '先進封裝/半導體設備', aiRelevance: 'CORE',
    twSymbols: ['3711', '2449', '6515', '3131', '6187', '3583', '6640', '2404', '6196', '1560', '3680'],
    usSymbols: ['ASML', 'AMAT', 'LRCX', 'KLAC', 'TER', 'ONTO', 'AMKR'],
    keywords: [],
  },
  {
    id: 'MEMORY', label: '記憶體/HBM', aiRelevance: 'CORE',
    twSymbols: ['2408', '2344', '2337', '8299', '3260', '4967'],
    usSymbols: ['MU', 'WDC', 'STX', 'SNDK'],
    keywords: [/記憶體|DRAM|NAND|Memory/i],
  },
  {
    id: 'AI_CLOUD', label: 'AI 雲端/應用軟體', aiRelevance: 'CORE',
    twSymbols: [],
    usSymbols: ['MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'ORCL', 'PLTR', 'CRM', 'NOW', 'SNOW', 'AI', 'SOUN', 'PATH', 'ADBE', 'IBM', 'BBAI', 'APP', 'TEM'],
    // 公司名稱直接帶 AI／Artificial Intelligence（例如 SoundHound AI、C3.ai）時歸入 AI 應用。
    keywords: [/\bAI\b|\.ai\b|Artificial Intelligence|人工智慧/i],
  },
  // ───────── 🔌 AI 供應鏈／受惠 ─────────
  {
    id: 'COOLING', label: 'AI 散熱', aiRelevance: 'RELATED',
    twSymbols: ['3017', '3324', '2421', '3653', '6230', '8996'],
    usSymbols: ['VRT', 'MOD'],
    keywords: [/散熱|液冷|Cooling/i],
  },
  {
    id: 'HIGH_SPEED', label: 'CPO/PCB/高速傳輸', aiRelevance: 'RELATED',
    twSymbols: ['3363', '4979', '3081', '2345', '3450', '6442', '2383', '6274', '2368', '3037', '8046', '3189', '2313', '3044', '6213', '3533', '2059', '3665'],
    usSymbols: ['ANET', 'CSCO', 'COHR', 'LITE', 'CIEN', 'GLW', 'APH', 'CLS', 'FN', 'AAOI'],
    keywords: [/矽光子|光通訊|CPO|Optical|Photonic/i],
  },
  {
    id: 'AI_POWER', label: 'AI 用電/重電核能', aiRelevance: 'RELATED',
    twSymbols: ['1519', '1503', '1513', '1514', '1605', '1609', '2308', '2301', '6409', '1504'],
    usSymbols: ['VST', 'CEG', 'NRG', 'GEV', 'ETN', 'OKLO', 'SMR', 'NNE', 'TLN', 'BE', 'CCJ', 'LEU', 'PWR'],
    keywords: [/重電|電力設備|Nuclear|Uranium|核能/i],
  },
  {
    id: 'ROBOT', label: '機器人/自駕', aiRelevance: 'RELATED',
    twSymbols: ['2049', '1590', '4583', '2359', '8374', '1597', '4576'],
    usSymbols: ['TSLA', 'ISRG', 'SYM', 'SERV', 'RR', 'MBLY', 'PONY'],
    keywords: [/機器人|Robot/i],
  },
  {
    id: 'SEMI_GENERAL', label: '半導體', aiRelevance: 'RELATED',
    twSymbols: [],
    usSymbols: ['TXN', 'ADI', 'NXPI', 'ON', 'MCHP', 'GFS', 'WOLF'],
    // 只靠產業別判定的一般半導體；未進入人工 AI 名單者僅列為 AI 間接受惠。
    keywords: [/^半導體業$|Semiconductor/i],
  },
  // ───────── 🔥 熱門趨勢（非 AI 直接） ─────────
  {
    id: 'SATELLITE', label: '低軌衛星/太空', aiRelevance: 'TREND',
    twSymbols: ['3491', '6285', '2314', '3380', '6271', '4977'],
    usSymbols: ['RKLB', 'ASTS', 'LUNR', 'PL', 'SPCE', 'IRDM', 'SATS'],
    // 刻意不比對 Aerospace，避免波音等傳統航太被誤標為低軌衛星。
    keywords: [/衛星|Satellite|Space|Rocket/i],
  },
  {
    id: 'EV', label: '電動車', aiRelevance: 'TREND',
    twSymbols: ['1536', '1533', '2201', '2207', '1522'],
    usSymbols: ['RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'BYDDY'],
    keywords: [/電動車|Electric Vehicle/i],
  },
  {
    id: 'CRYPTO', label: '加密貨幣', aiRelevance: 'TREND',
    twSymbols: [],
    usSymbols: ['COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HOOD', 'HUT', 'IREN', 'CORZ', 'CRCL', 'GLXY', 'BMNR', 'SBET', 'CIFR'],
    keywords: [/Bitcoin|Crypto|Blockchain/i],
  },
  {
    id: 'QUANTUM', label: '量子運算', aiRelevance: 'TREND',
    twSymbols: [],
    usSymbols: ['IONQ', 'RGTI', 'QBTS', 'QUBT'],
    keywords: [/Quantum|量子/i],
  },
  {
    id: 'GLP1', label: '減重/GLP-1', aiRelevance: 'TREND',
    twSymbols: ['6446', '1795', '4743', '6472'],
    usSymbols: ['LLY', 'NVO', 'HIMS', 'VKTX'],
    keywords: [/GLP-1|減重/i],
  },
  {
    id: 'DEFENSE', label: '國防/無人機', aiRelevance: 'TREND',
    twSymbols: ['2634', '8033', '2645'],
    usSymbols: ['LMT', 'RTX', 'NOC', 'GD', 'KTOS', 'AVAV', 'RCAT', 'UMAC'],
    keywords: [/無人機|Drone|Defense/i],
  },
  {
    id: 'CYBER', label: '資安', aiRelevance: 'TREND',
    twSymbols: [],
    usSymbols: ['CRWD', 'PANW', 'ZS', 'NET', 'FTNT', 'S', 'OKTA'],
    keywords: [/資安|Cybersecurity/i],
  },
  {
    id: 'GREEN', label: '綠能/儲能', aiRelevance: 'TREND',
    twSymbols: ['6806', '3576', '6443'],
    usSymbols: ['FSLR', 'ENPH', 'SEDG', 'RUN', 'NXT', 'FLNC'],
    keywords: [/^綠能環保$|Solar|Renewable|太陽能|儲能/i],
  },
];

/** 依 id 取得題材定義；AI 推估回傳的題材 id 也必須經此驗證，避免模型自創題材。 */
export const THEME_BY_ID = new Map(THEME_DEFINITIONS.map(theme => [theme.id, theme]));
