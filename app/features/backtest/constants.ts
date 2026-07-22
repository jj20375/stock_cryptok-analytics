/**
 * 【詳細繁體中文註解】：回測標的清單常數
 *
 * 加密貨幣:沿用 live 策略引擎監控的 8 個主流幣種(精度與 strategyEngine.SYMBOL_PRECISION 一致)。
 * 虛擬幣概念美股:參考 Bitget 股票市場清單挑出的加密相關標的。
 * 一般美股/台股:提供給「多空趨勢強勢追蹤」等 4 種一般選股策略使用的常見大型標的清單。
 * 使用者可直接在此檔增減標的,不需改動其他程式碼。
 */

export interface BacktestSymbolOption {
  symbol: string;
  name: string;
  market: 'CRYPTO' | 'US' | 'TW';
  /** 下單數量小數位數(倉位計算用) */
  precision: number;
}

/** 主流加密貨幣(與 live 引擎監控清單一致) */
export const CRYPTO_SYMBOLS: BacktestSymbolOption[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', market: 'CRYPTO', precision: 5 },
  { symbol: 'ETHUSDT', name: 'Ethereum', market: 'CRYPTO', precision: 4 },
  { symbol: 'SOLUSDT', name: 'Solana', market: 'CRYPTO', precision: 2 },
  { symbol: 'ADAUSDT', name: 'Cardano', market: 'CRYPTO', precision: 1 },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', market: 'CRYPTO', precision: 0 },
  { symbol: 'XRPUSDT', name: 'XRP', market: 'CRYPTO', precision: 1 },
  { symbol: 'SUIUSDT', name: 'Sui', market: 'CRYPTO', precision: 1 },
  { symbol: 'AVAXUSDT', name: 'Avalanche', market: 'CRYPTO', precision: 2 },
  { symbol: 'ICPUSDT', name: 'Internet Computer', market: 'CRYPTO', precision: 2 },
  { symbol: 'ZECUSDT', name: 'Zcash', market: 'CRYPTO', precision: 3 },
  { symbol: 'ASTERUSDT', name: 'Aster', market: 'CRYPTO', precision: 2 },
];

/**
 * 虛擬幣概念美股觀察清單(日線波段)。
 * 分類:交易所/券商(COIN/HOOD/BLSH/GEMI)、持倉股(MSTR)、礦企(MARA/RIOT/CLSK/CIFR)、
 * 穩定幣(CRCL)、資管(GLXY)、現貨 ETF(IBIT/ETHA)。
 * 美股允許小數 4 位模擬碎股下單。
 */
export const CRYPTO_STOCKS: BacktestSymbolOption[] = [
  { symbol: 'COIN', name: 'Coinbase', market: 'US', precision: 4 },
  { symbol: 'HOOD', name: 'Robinhood', market: 'US', precision: 4 },
  { symbol: 'MSTR', name: 'Strategy (MicroStrategy)', market: 'US', precision: 4 },
  { symbol: 'MARA', name: 'MARA Holdings', market: 'US', precision: 4 },
  { symbol: 'RIOT', name: 'Riot Platforms', market: 'US', precision: 4 },
  { symbol: 'CLSK', name: 'CleanSpark', market: 'US', precision: 4 },
  { symbol: 'CIFR', name: 'Cipher Mining', market: 'US', precision: 4 },
  { symbol: 'GLXY', name: 'Galaxy Digital', market: 'US', precision: 4 },
  { symbol: 'CRCL', name: 'Circle', market: 'US', precision: 4 },
  { symbol: 'BLSH', name: 'Bullish', market: 'US', precision: 4 },
  { symbol: 'GEMI', name: 'Gemini', market: 'US', precision: 4 },
  { symbol: 'IBIT', name: 'iShares Bitcoin Trust ETF', market: 'US', precision: 4 },
  { symbol: 'ETHA', name: 'iShares Ethereum Trust ETF', market: 'US', precision: 4 },
];

/**
 * 一般美股(非虛擬幣概念,供「多空趨勢強勢追蹤/連續爆量/量增未破/日線量增」等
 * 一般選股策略使用)。與 CRYPTO_STOCKS 合併後即為「美股」市場的完整標的清單。
 */
export const US_GENERAL_STOCKS: BacktestSymbolOption[] = [
  { symbol: 'AAPL', name: 'Apple', market: 'US', precision: 4 },
  { symbol: 'MSFT', name: 'Microsoft', market: 'US', precision: 4 },
  { symbol: 'GOOGL', name: 'Alphabet', market: 'US', precision: 4 },
  { symbol: 'AMZN', name: 'Amazon', market: 'US', precision: 4 },
  { symbol: 'NVDA', name: 'NVIDIA', market: 'US', precision: 4 },
  { symbol: 'META', name: 'Meta Platforms', market: 'US', precision: 4 },
  { symbol: 'TSLA', name: 'Tesla', market: 'US', precision: 4 },
  { symbol: 'JPM', name: 'JPMorgan Chase', market: 'US', precision: 4 },
  { symbol: 'V', name: 'Visa', market: 'US', precision: 4 },
  { symbol: 'NFLX', name: 'Netflix', market: 'US', precision: 4 },
  { symbol: 'AMD', name: 'AMD', market: 'US', precision: 4 },
  { symbol: 'ORCL', name: 'Oracle', market: 'US', precision: 4 },
  { symbol: 'DIS', name: 'Walt Disney', market: 'US', precision: 4 },
  { symbol: 'BA', name: 'Boeing', market: 'US', precision: 4 },
  { symbol: 'KO', name: 'Coca-Cola', market: 'US', precision: 4 },
];

/**
 * 台股常見大型權值股(代號不含 .TW 後綴,查詢歷史資料時由後端自動補上)。
 */
export const TW_STOCKS: BacktestSymbolOption[] = [
  { symbol: '2330', name: '台積電', market: 'TW', precision: 0 },
  { symbol: '2317', name: '鴻海', market: 'TW', precision: 0 },
  { symbol: '2454', name: '聯發科', market: 'TW', precision: 0 },
  { symbol: '2881', name: '富邦金', market: 'TW', precision: 0 },
  { symbol: '2303', name: '聯電', market: 'TW', precision: 0 },
  { symbol: '2603', name: '長榮', market: 'TW', precision: 0 },
  { symbol: '2382', name: '廣達', market: 'TW', precision: 0 },
  { symbol: '2308', name: '台達電', market: 'TW', precision: 0 },
  { symbol: '2882', name: '國泰金', market: 'TW', precision: 0 },
  { symbol: '3008', name: '大立光', market: 'TW', precision: 0 },
  { symbol: '2412', name: '中華電', market: 'TW', precision: 0 },
  { symbol: '2002', name: '中鋼', market: 'TW', precision: 0 },
  { symbol: '2886', name: '兆豐金', market: 'TW', precision: 0 },
  { symbol: '2884', name: '玉山金', market: 'TW', precision: 0 },
  { symbol: '1301', name: '台塑', market: 'TW', precision: 0 },
  { symbol: '1303', name: '南亞', market: 'TW', precision: 0 },
  { symbol: '2357', name: '華碩', market: 'TW', precision: 0 },
  { symbol: '2379', name: '瑞昱', market: 'TW', precision: 0 },
  { symbol: '3711', name: '日月光投控', market: 'TW', precision: 0 },
  { symbol: '2891', name: '中信金', market: 'TW', precision: 0 },
];

/**
 * 依市場取得標的清單。
 * 「美股」市場合併虛擬幣概念股與一般美股 — 兩者用同一組週期/策略機制,
 * 使用者可以自由用任何已註冊策略搭配任何美股標的回測(例如用趨勢追蹤策略測 COIN)。
 */
export const getSymbolsByMarket = (market: 'CRYPTO' | 'US' | 'TW'): BacktestSymbolOption[] => {
  if (market === 'CRYPTO') return CRYPTO_SYMBOLS;
  if (market === 'TW') return TW_STOCKS;
  return [...CRYPTO_STOCKS, ...US_GENERAL_STOCKS];
};

/**
 * 【詳細繁體中文註解】：把 Bitget 股票代幣清單(動態抓取的美股代號,如 "AAOI")
 * 併入已手動維護的清單,已存在的代號不重複加入。額外代號沒有中文/公司全名可顯示,
 * 直接以代號本身當作 name;實際歷史資料仍走 Yahoo,這裡只是擴充「可選標的」。
 */
export const mergeExtraUsTickers = (
  curated: BacktestSymbolOption[],
  extraTickers: string[]
): BacktestSymbolOption[] => {
  const existing = new Set(curated.map((s) => s.symbol));
  const extras = extraTickers
    .filter((symbol) => !existing.has(symbol))
    .map((symbol) => ({ symbol, name: symbol, market: 'US' as const, precision: 4 }));
  return [...curated, ...extras];
};

/**
 * 回測範圍快捷選項(天數)。
 * 1W/2W 主要給加密貨幣短線週期(15m/1h/4h)使用 — 日線策略在這麼短的範圍內
 * 交易日數過少,參考價值有限,但保留選項讓使用者自行判斷,不特別限制市場。
 */
export const RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: '1W', days: 7 },
  { label: '2W', days: 14 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: '2Y', days: 730 },
];
