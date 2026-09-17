/** @file Yahoo 研究工具共用的台股名稱、逾時控制與基本面資料讀取。 */

const twStockNames: Record<string, string> = {
  '2330': '台積電',
  '2317': '鴻海',
  '2454': '聯發科',
  '2881': '富邦金',
  '2303': '聯電',
  '2603': '長榮',
  '2382': '廣達',
  '2308': '台達電',
  '4919': '新唐',
  '2609': '陽明',
  '2615': '萬海',
  '2357': '華碩',
  '3008': '大立光',
  '2301': '光寶科',
  '2882': '國泰金',
  '3105': '穩懋',
  '2379': '瑞昱',
  '2886': '兆豐金',
  '2884': '玉山金',
  '2891': '中信金',
  '2002': '中鋼',
  '2412': '中華電',
  '2880': '華南金',
  '2885': '元大金',
  '2883': '開發金',
  '2887': '台新金',
  '2890': '永豐金',
  '2892': '第一金',
  '5880': '合庫金',
  '2353': '宏碁',
  '2324': '仁寶',
  '3231': '緯創',
  '2356': '英業達',
  '2376': '技嘉',
  '2377': '微星',
  '2408': '南亞科',
  '2409': '友達',
  '3481': '群創',
  '3711': '日月光投控',
  '2610': '華航',
  '2618': '長榮航',
  '2105': '正新',
  '2201': '裕隆',
  '2204': '中華',
  '2206': '三陽工業',
  '2912': '統一超',
  '1216': '統一',
  '1301': '台塑',
  '1303': '南亞',
  '1326': '台化',
  '6505': '台塑化',
  '4714': '永捷',
};

export const getStockName = (symbol: string): string => twStockNames[symbol.replace('.TW', '').replace('.TWO', '')] || symbol;

/** 對外行情與研究請求都設逾時，避免單一來源卡住整個頁面或排程。 */
export const fetchWithTimeout = async (url: string, options: any = {}, timeout = 8_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const normalizeTaiwanSymbol = (symbol: string) => !symbol.includes('.') && /^\d{4,6}$/.test(symbol) ? `${symbol}.TW` : symbol;

export const fetchStockMetaOnly = async (symbol: string): Promise<any> => {
  try {
    const normalizedSymbol = normalizeTaiwanSymbol(symbol);
    const fetchMeta = (target: string) => fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(target)}?range=1d&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }, 4_000);
    let response = await fetchMeta(normalizedSymbol);
    if (!response.ok && normalizedSymbol.endsWith('.TW')) response = await fetchMeta(normalizedSymbol.replace('.TW', '.TWO'));
    if (!response.ok) return null;
    const result = await response.json();
    return result.chart?.result?.[0]?.meta ?? null;
  } catch {
    return null;
  }
};

export const fetchMultipleStockQuotes = async (symbols: string[]): Promise<any[]> => {
  try {
    const quotes = await Promise.all(symbols.slice(0, 3).map(async symbol => {
      const meta = await fetchStockMetaOnly(symbol);
      if (!meta) return null;
      return { symbol, shortName: meta.shortName || meta.longName, regularMarketPrice: meta.regularMarketPrice, regularMarketChangePercent: meta.previousClose ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100 : 0 };
    }));
    return quotes.filter(Boolean);
  } catch {
    return [];
  }
};

export const fetchStockFundamentals = async (symbol: string): Promise<any> => {
  try {
    let yahooSymbol = normalizeTaiwanSymbol(symbol);
    const fetchSummary = (target: string) => fetchWithTimeout(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${target}?modules=summaryDetail,defaultKeyStatistics,assetProfile`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 5_000);
    let response = await fetchSummary(yahooSymbol);
    if (!response.ok && yahooSymbol.endsWith('.TW')) {
      yahooSymbol = yahooSymbol.replace('.TW', '.TWO');
      response = await fetchSummary(yahooSymbol);
    }
    if (!response.ok) {
      const meta = await fetchStockMetaOnly(symbol);
      return meta ? { name: meta.longName || meta.shortName || getStockName(symbol), marketCap: null, trailingPE: null, forwardPE: null, dividendYield: null, bookValue: null, priceToBook: null, fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh, fiftyTwoWeekLow: meta.fiftyTwoWeekLow, currency: meta.currency } : null;
    }
    const result = await response.json();
    const summary = result.quoteSummary?.result?.[0];
    if (!summary) return null;
    const detail = summary.summaryDetail || {};
    const statistics = summary.defaultKeyStatistics || {};
    const profile = summary.assetProfile || {};
    return { name: profile.longName || profile.shortName || getStockName(symbol), marketCap: detail.marketCap?.raw, trailingPE: detail.trailingPE?.raw || statistics.trailingPE?.raw, forwardPE: detail.forwardPE?.raw || statistics.forwardPE?.raw, dividendYield: detail.dividendYield?.raw || detail.trailingAnnualDividendYield?.raw, bookValue: statistics.bookValue?.raw, priceToBook: statistics.priceToBook?.raw, fiftyTwoWeekHigh: detail.fiftyTwoWeekHigh?.raw, fiftyTwoWeekLow: detail.fiftyTwoWeekLow?.raw, currency: detail.currency };
  } catch (error) {
    console.error(`[StockService] 抓取 ${symbol} 基本面失敗:`, error);
    return null;
  }
};

export const fetchStockNews = async (symbol: string): Promise<string[]> => {
  try {
    const response = await fetchWithTimeout(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${normalizeTaiwanSymbol(symbol)}&region=US&lang=en-US`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 5_000);
    if (!response.ok) return [];
    const titles: string[] = [];
    const titlePattern = /<title>(.*?)<\/title>/g;
    for (let match = titlePattern.exec(await response.text()); match; match = titlePattern.exec(match.input)) {
      const title = match[1].replace('<![CDATA[', '').replace(']]>', '');
      if (title && title !== 'Yahoo! Finance: RSS') titles.push(title);
    }
    return titles.slice(0, 5);
  } catch (error) {
    console.error(`[StockService] 抓取 ${symbol} 新聞失敗:`, error);
    return [];
  }
};

export const fetchStockPeers = async (symbol: string): Promise<string[]> => {
  try {
    const response = await fetchWithTimeout(`https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${normalizeTaiwanSymbol(symbol)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 5_000);
    if (!response.ok) return [];
    const result = await response.json();
    return (result.finance?.result?.[0]?.recommendedSymbols || []).map((item: any) => item.symbol);
  } catch (error) {
    console.error(`[StockService] 抓取 ${symbol} 同業失敗:`, error);
    return [];
  }
};
