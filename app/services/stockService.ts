import { StockDataPoint, Signal } from '../types';

const TW_STOCK_NAMES: Record<string, string> = {
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

export const getStockName = (symbol: string): string => {
  const code = symbol.replace('.TW', '').replace('.TWO', '');
  return TW_STOCK_NAMES[code] || symbol;
};

export const calculateMA = (data: number[], period: number): number[] => {
  let ma: number[] = Array(data.length).fill(null);
  if (data.length < period) return ma;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  ma[period - 1] = sum / period;

  for (let i = period; i < data.length; i++) {
    sum = sum - data[i - period] + data[i];
    ma[i] = sum / period;
  }
  return ma;
};

export const calculateKD = (data: StockDataPoint[], period: number = 9, kPeriod: number = 3, dPeriod: number = 3): { k: number[], d: number[] } => {
  let k: number[] = Array(data.length).fill(50);
  let d: number[] = Array(data.length).fill(50);
  
  if (data.length < period) return { k, d };

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const high = Math.max(...slice.map(s => s.high));
    const low = Math.min(...slice.map(s => s.low));
    const close = data[i].close;
    
    const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100;
    
    const prevK = i > 0 ? k[i - 1] : 50;
    const prevD = i > 0 ? d[i - 1] : 50;
    
    k[i] = (2 / 3) * prevK + (1 / 3) * rsv;
    d[i] = (2 / 3) * prevD + (1 / 3) * k[i];
  }
  
  return { k, d };
};

export const calculateEMA = (data: number[], period: number): number[] => {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  let ema: number[] = [];
  let prevEma = data[0];
  ema.push(prevEma);

  for (let i = 1; i < data.length; i++) {
    const currentEma = data[i] * k + prevEma * (1 - k);
    ema.push(currentEma);
    prevEma = currentEma;
  }
  return ema;
};

export const calculateMACD = (data: number[], fast: number = 12, slow: number = 26, signal: number = 9): { dif: number[], macd: number[], hist: number[] } => {
  const emaFast = calculateEMA(data, fast);
  const emaSlow = calculateEMA(data, slow);
  
  const dif: number[] = emaFast.map((f, i) => f - emaSlow[i]);
  const macd = calculateEMA(dif, signal);
  const hist = dif.map((d, i) => d - macd[i]);
  
  return { dif, macd, hist };
};

export const calculateRSI = (data: number[], period: number = 14): number[] => {
  let rsi: number[] = Array(data.length).fill(null);
  if (data.length <= period) return rsi;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < data.length; i++) {
    if (i > period) {
      const diff = data[i] - data[i - 1];
      const currentGain = diff >= 0 ? diff : 0;
      const currentLoss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = 100 - 100 / (1 + rs);
  }

  return rsi;
};

// 【詳細繁體中文註解】：封裝具備逾時機制的 fetch，避免單一 API 緩慢導致整個分析超時
export const fetchWithTimeout = async (url: string, options: any = {}, timeout: number = 8000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

export const fetchRealTimeQuote = async (symbol: string): Promise<any> => {
  try {
    const response = await fetchWithTimeout(`/api/stock/${encodeURIComponent(symbol)}?range=1d&interval=1m`, { cache: 'no-store' }, 5000);
    const result = await response.json();
    
    if (result.error || !result.chart || !result.chart.result || result.chart.result.length === 0) {
      return null;
    }

    const chartData = result.chart.result[0];
    const meta = chartData.meta;
    
    return {
      price: meta.regularMarketPrice,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume
    };
  } catch (error) {
    return null;
  }
};

export const calculateATR = (data: StockDataPoint[], period: number = 10): number[] => {
  let atr: number[] = Array(data.length).fill(0);
  if (data.length < period) return atr;

  let tr: number[] = [data[0].high - data[0].low];
  for (let i = 1; i < data.length; i++) {
    const hl = data[i].high - data[i].low;
    const hpc = Math.abs(data[i].high - data[i - 1].close);
    const lpc = Math.abs(data[i].low - data[i - 1].close);
    tr.push(Math.max(hl, hpc, lpc));
  }

  let sumTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  atr[period - 1] = sumTR / period;

  for (let i = period; i < data.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
};

export const calculateSupertrend = (data: StockDataPoint[], factor: number = 4.0, period: number = 10): { trend: number[], dir: number[] } => {
  const atr = calculateATR(data, period);
  const trend: number[] = Array(data.length).fill(0);
  const dir: number[] = Array(data.length).fill(1); 

  let upperBand = 0;
  let lowerBand = 0;

  for (let i = period; i < data.length; i++) {
    const src = (data[i].high + data[i].low) / 2;
    const currUpper = src + factor * atr[i];
    const currLower = src - factor * atr[i];

    upperBand = (currUpper < upperBand || data[i - 1].close > upperBand) ? currUpper : upperBand;
    lowerBand = (currLower > lowerBand || data[i - 1].close < lowerBand) ? currLower : lowerBand;

    if (i > 0) {
      if (dir[i - 1] === 1 && data[i].close > upperBand) {
        dir[i] = -1;
      } else if (dir[i - 1] === -1 && data[i].close < lowerBand) {
        dir[i] = 1;
      } else {
        dir[i] = dir[i - 1];
      }
    }

    trend[i] = dir[i] === -1 ? lowerBand : upperBand;
  }

  return { trend, dir };
};

export const fetchPriceFromServer = async (symbol: string): Promise<number | null> => {
  try {
    let yfSymbol = symbol;
    if (!symbol.includes('.') && /^\d{4}$/.test(symbol)) {
      yfSymbol = `${symbol}.TW`;
    }
    
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSymbol}?range=1d&interval=1m`;
    let response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    }, 5000);
    
    if (!response.ok && yfSymbol.endsWith('.TW')) {
      const fallbackUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSymbol.replace('.TW', '.TWO')}?range=1d&interval=1m`;
      const fallbackRes = await fetchWithTimeout(fallbackUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, 5000);
      if (fallbackRes.ok) response = fallbackRes;
    }

    if (!response.ok) return null;
    const result: any = await response.json();
    const meta = result.chart?.result?.[0]?.meta;
    
    if (!meta) return null;
    const price = meta.regularMarketPrice || meta.chartPreviousClose;
    if (price) return price;

    const quotes = result.chart?.result?.[0]?.indicators?.quote?.[0];
    if (quotes && quotes.close) {
      const validPrices = quotes.close.filter((p: any) => p !== null);
      if (validPrices.length > 0) {
        return validPrices[validPrices.length - 1];
      }
    }

    return null;
  } catch {
    return null;
  }
};

export const fetchStockData = async (symbol: string, days: number = 120, interval: string = '1d'): Promise<{ data: StockDataPoint[], name: string, meta?: any }> => {
  try {
    let range = '1y';
    let fetchInterval = interval;
    
    // 伺服器端與客戶端統一處理台股代號正規化
    let normalizedSymbol = symbol;
    if (!symbol.includes('.') && /^\d{4,6}$/.test(symbol)) {
      normalizedSymbol = `${symbol}.TW`;
    }
    
    if (interval === '15m') {
      range = '5d';
    } else if (interval === '60m' || interval === '4h') {
      range = '1mo';
      fetchInterval = '1h'; 
    } else if (days <= 30) {
      range = '1mo';
    } else if (days <= 90) {
      range = '3mo';
    } else if (days <= 180) {
      range = '6mo';
    } else if (days <= 365) {
      range = '1y';
    } else if (days <= 730) {
      range = '2y';
    } else {
      range = '5y';
    }

    let response;
    if (typeof window === 'undefined') {
      const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalizedSymbol)}?range=${range}&interval=${fetchInterval}`;
      response = await fetchWithTimeout(yfUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: 'no-store'
      }, 8000);

      if (!response.ok && normalizedSymbol.endsWith('.TW')) {
        const fallbackSymbol = normalizedSymbol.replace('.TW', '.TWO');
        const fallbackUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fallbackSymbol)}?range=${range}&interval=${fetchInterval}`;
        const fallbackRes = await fetchWithTimeout(fallbackUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, 8000);
        if (fallbackRes.ok) {
          response = fallbackRes;
        }
      }
    } else {
      response = await fetchWithTimeout(`/api/stock/${encodeURIComponent(normalizedSymbol)}?range=${range}&interval=${fetchInterval}`, { cache: 'no-store' }, 8000);
      if (!response.ok && normalizedSymbol.endsWith('.TW')) {
        const fallbackRes = await fetchWithTimeout(`/api/stock/${encodeURIComponent(normalizedSymbol.replace('.TW', '.TWO'))}?range=${range}&interval=${fetchInterval}`, {}, 8000);
        if (fallbackRes.ok) response = fallbackRes;
      }
    }
    
    const result = await response.json();

    if (result.error || !result.chart || !result.chart.result || result.chart.result.length === 0) {
      console.warn(`⚠️ [StockService] ${symbol} 無法取得資料:`, result.error || '空結果');
      return { data: [], name: getStockName(symbol) };
    }

    const chartData = result.chart.result[0];
    const meta = chartData.meta;
    const stockName = meta.longName || meta.shortName || getStockName(symbol);
    const timestamps = chartData.timestamp;
    const quotes = chartData.indicators.quote[0];
    
    if (!timestamps || !quotes) {
      return { data: [], name: stockName };
    }

    const isTW = symbol.includes('.TW') || symbol.includes('.TWO') || /^\d{4,6}$/.test(symbol);
    const currency = isTW ? 'TWD' : 'USD';

    let rawData: StockDataPoint[] = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.close[i] !== null && quotes.open[i] !== null) {
        const dateObj = new Date(timestamps[i] * 1000);
        const dateStr = interval === '1d' 
          ? dateObj.toISOString().split('T')[0]
          : `${dateObj.getMonth() + 1}/${dateObj.getDate()} ${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
        
        rawData.push({
          date: dateStr,
          timestamp: timestamps[i] * 1000,
          price: quotes.close[i],
          open: quotes.open[i],
          high: quotes.high[i],
          low: quotes.low[i],
          close: quotes.close[i],
          volume: quotes.volume[i] || 0,
          currency,
          isMock: false
        });
      }
    }

    let data: StockDataPoint[] = [];
    
    if (interval === '4h') {
      for (let i = 0; i < rawData.length; i += 4) {
        const chunk = rawData.slice(i, i + 4);
        if (chunk.length > 0) {
          const high = Math.max(...chunk.map(c => c.high));
          const low = Math.min(...chunk.map(c => c.low));
          data.push({
            ...chunk[chunk.length - 1],
            open: chunk[0].open,
            high,
            low,
            close: chunk[chunk.length - 1].close,
            volume: chunk.reduce((sum, c) => sum + c.volume, 0)
          });
        }
      }
    } else {
      data = rawData;
    }

    if (data.length === 0) {
      return { data: [], name: stockName };
    }

    if (interval === '1d') {
      const quote = await fetchRealTimeQuote(symbol);
      if (quote && quote.price) {
        const latest = data[data.length - 1];
        if (latest) {
          latest.price = parseFloat(quote.price);
          latest.close = parseFloat(quote.price);
          latest.high = Math.max(latest.high, parseFloat(quote.high || quote.price));
          latest.low = Math.min(latest.low, parseFloat(quote.low || quote.price));
        }
      }
    }

    const prices = data.map(d => d.close);
    const volumes = data.map(d => d.volume);
    
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const rsi14 = calculateRSI(prices, 14);
    
    const ma5 = calculateMA(prices, 5);
    const ma10 = calculateMA(prices, 10);
    const ma20 = calculateMA(prices, 20);
    const ma60 = calculateMA(prices, 60);
    const ma120 = calculateMA(prices, 120);
    const ma240 = calculateMA(prices, 240);
    
    const mv5 = calculateMA(volumes, 5);
    const mv20 = calculateMA(volumes, 20);
    
    const kd = calculateKD(data);
    const macd = calculateMACD(prices);

    return {
      data: data.map((d, i) => ({
        ...d,
        emaShort: ema12[i],
        emaLong: ema26[i],
        rsi: rsi14[i],
        ma5: ma5[i],
        ma10: ma10[i],
        ma20: ma20[i],
        ma60: ma60[i],
        ma120: ma120[i],
        ma240: ma240[i],
        mv5: mv5[i],
        mv20: mv20[i],
        k: kd.k[i],
        d: kd.d[i],
        macdDIF: macd.dif[i],
        macdSignal: macd.macd[i],
        macdHist: macd.hist[i],
      })),
      name: stockName,
      meta: meta
    };
  } catch (error: any) {
    console.error(`🔥 [StockService] ${symbol} 抓取發生異常:`, error.message);
    return { data: [], name: getStockName(symbol) };
  }
};

export const evaluateDailyVolumeSurge = async (symbol: string): Promise<{ isSurge: boolean; multiple: number; currentVolume: number; avgVolume: number }> => {
  try {
    const { data } = await fetchStockData(symbol, 10, '1d');
    if (data.length < 6) return { isSurge: false, multiple: 0, currentVolume: 0, avgVolume: 0 };

    const today = data[data.length - 1];
    const history = data.slice(data.length - 6, data.length - 1);
    
    const avgVolume5D = history.reduce((sum, d) => sum + d.volume, 0) / 5;
    const multiple = today.volume / avgVolume5D;

    return {
      isSurge: multiple >= 2,
      multiple,
      currentVolume: today.volume,
      avgVolume: avgVolume5D
    };
  } catch (error) {
    console.error(`[StockService] 評估 ${symbol} 爆量失敗:`, error);
    return { isSurge: false, multiple: 0, currentVolume: 0, avgVolume: 0 };
  }
};

export const getTradingSignal = (data: StockDataPoint[]): { signal: Signal; reason: string } => {
  if (data.length < 2) return { signal: 'HOLD', reason: 'Insufficient data' };
  
  const current = data[data.length - 1];
  const prev = data[data.length - 2];

  if (!current.emaShort || !current.emaLong || !current.rsi || !current.k || !current.d || !current.macdHist) {
    return { signal: 'HOLD', reason: 'Calculating indicators...' };
  }

  let buySignals = 0;
  let sellSignals = 0;
  let reasons: string[] = [];

  if (prev.emaShort! <= prev.emaLong! && current.emaShort! > current.emaLong!) {
    buySignals += 2;
    reasons.push('EMA 黃金交叉');
  } else if (prev.emaShort! >= prev.emaLong! && current.emaShort! < current.emaLong!) {
    sellSignals += 2;
    reasons.push('EMA 死亡交叉');
  }

  if (current.rsi < 30) {
    buySignals += 1;
    reasons.push('RSI 超賣');
  } else if (current.rsi > 70) {
    sellSignals += 1;
    reasons.push('RSI 超買');
  }

  if (prev.k! <= prev.d! && current.k! > current.d!) {
    buySignals += 1;
    reasons.push('KD 黃金交叉');
  } else if (prev.k! >= prev.d! && current.k! < current.d!) {
    sellSignals += 1;
    reasons.push('KD 死亡交叉');
  }

  if (prev.macdHist! <= 0 && current.macdHist! > 0) {
    buySignals += 1;
    reasons.push('MACD 柱狀圖轉正');
  } else if (prev.macdHist! >= 0 && current.macdHist! < 0) {
    sellSignals += 1;
    reasons.push('MACD 柱狀圖轉負');
  }

  if (buySignals >= 3) return { signal: 'BUY', reason: `強勢買入: ${reasons.join(', ')}` };
  if (buySignals >= 1) return { signal: 'BUY', reason: `建議買入: ${reasons.join(', ')}` };
  if (sellSignals >= 3) return { signal: 'SELL', reason: `強勢賣出: ${reasons.join(', ')}` };
  if (sellSignals >= 1) return { signal: 'SELL', reason: `建議賣出: ${reasons.join(', ')}` };

  return { signal: 'HOLD', reason: '目前趨勢不明確，建議觀望' };
};

/**
 * 【詳細繁體中文註解】：評估「吃大魚策略 2.0」進場訊號
 * 邏輯：
 * 1. MACD 金叉 且 價格 > EMA 200 * 0.98 (提早進場)
 * 2. 或 Supertrend 從紅翻綠 (趨勢確認)
 */
export const evaluateBigFishStrategy = async (symbol: string, interval: string = '1h'): Promise<{ isEntry: boolean; reason: string; price: number }> => {
  try {
    const { data } = await fetchStockData(symbol, 300, interval);
    if (data.length < 200) return { isEntry: false, reason: "資料量不足", price: 0 };

    const current = data[data.length - 1];
    const prev = data[data.length - 2];
    const price = current.close;

    // 指標計算
    const prices = data.map(d => d.close);
    const ema200 = calculateEMA(prices, 200);
    const currEma200 = ema200[ema200.length - 1];
    
    const { dir } = calculateSupertrend(data, 4.0, 10);
    const currDir = dir[dir.length - 1];
    const prevDir = dir[dir.length - 2];

    const macd = calculateMACD(prices);
    const currHist = macd.hist[macd.hist.length - 1];
    const prevHist = macd.hist[macd.hist.length - 2];

    // 1. 提早進場：MACD 金叉 + 價格在 EMA 200 附近
    const isMacdCrossover = prevHist <= 0 && currHist > 0;
    const earlyLong = isMacdCrossover && price > currEma200 * 0.98;

    // 2. 確認進場：Supertrend 翻綠 (dir 從 1 變 -1)
    const trendLong = currDir === -1 && prevDir === 1;

    if (earlyLong || trendLong) {
      const reason = earlyLong ? "MACD 金叉 + 站回牛熊線" : "超級趨勢翻綠 (趨勢啟動)";
      return { isEntry: true, reason, price };
    }

    return { isEntry: false, reason: "未觸發訊號", price };
  } catch (error) {
    console.error(`[Strategy] 評估 ${symbol} 失敗:`, error);
    return { isEntry: false, reason: "評估失敗", price: 0 };
  }
};

/**
 * 【詳細繁體中文註解】：評估「多頭排列強勢股」策略
 * 條件：Price > MA5 > MA10 > MA20 > MA60 且 MA60 斜率向上
 * 這種標的代表趨勢極強，適合順勢交易。
 */
export const evaluatePerfectOrder = async (symbol: string): Promise<{ isPerfect: boolean; price: number }> => {
  try {
    const { data } = await fetchStockData(symbol, 150, '1d');
    if (data.length < 60) return { isPerfect: false, price: 0 };

    const curr = data[data.length - 1];
    const prev60 = data[data.length - 60];

    // 檢查均線是否多頭排列 (短 > 中 > 長)
    const isOrdered = curr.close > curr.ma5! && 
                      curr.ma5! > curr.ma10! && 
                      curr.ma10! > curr.ma20! && 
                      curr.ma20! > curr.ma60!;
    
    // 檢查季線 (MA60) 是否向上
    const isMa60Up = curr.ma60! > prev60.ma60!;

    return { 
      isPerfect: !!isOrdered && !!isMa60Up, 
      price: curr.close 
    };
  } catch {
    return { isPerfect: false, price: 0 };
  }
};

/**
 * 【詳細繁體中文註解】：評估「量增價平」蓄勢待發策略
 * 邏輯：
 * 1. 今日成交量 > 5 日均量 2.5 倍 (量大)
 * 2. 漲跌幅在 -1.5% ~ +1.5% 之間 (價平)
 * 這種情況通常代表主力正在「吃貨」或「洗盤」，後市可能會有大動作。
 */
export const evaluateVolumeNoPriceRise = async (symbol: string): Promise<{ 
  isTriggered: boolean; 
  multiple: number; 
  price: number; 
  changePercent: number;
  weeklyComparison: {
    thisWeekVol: number;
    lastWeekVol: number;
    ratio: number;
  }
}> => {
  try {
    // 抓取足夠的數據進行週對比 (至少 10-15 日)
    const { data } = await fetchStockData(symbol, 20, '1d');
    if (data.length < 10) return { 
      isTriggered: false, multiple: 0, price: 0, changePercent: 0,
      weeklyComparison: { thisWeekVol: 0, lastWeekVol: 0, ratio: 0 }
    };

    const today = data[data.length - 1];
    const prev = data[data.length - 2];
    
    // 1. 計算傳統的「今日 vs 5日均量」
    const history5D = data.slice(data.length - 6, data.length - 1);
    const avgVolume5D = history5D.reduce((sum, d) => sum + d.volume, 0) / 5;
    const multiple = today.volume / avgVolume5D;
    
    // 2. 計算「本週 (最近 5 日)」與「上週 (再前 5 日)」的量能對比
    const thisWeek = data.slice(data.length - 5);
    const lastWeek = data.slice(data.length - 10, data.length - 5);
    
    const thisWeekTotalVol = thisWeek.reduce((sum, d) => sum + d.volume, 0);
    const lastWeekTotalVol = lastWeek.reduce((sum, d) => sum + d.volume, 0);
    const weeklyRatio = lastWeekTotalVol > 0 ? thisWeekTotalVol / lastWeekTotalVol : 0;
    
    // 計算今日漲跌幅
    const changePercent = ((today.close - prev.close) / prev.close) * 100;

    // 觸發條件優化：
    // A. 今日爆量且價平 (傳統條件)
    // B. 本週總量明顯大於上週 (例如 > 1.3 倍)，暗示連續吃貨
    const isTriggered = (multiple >= 2.2 && Math.abs(changePercent) <= 1.8) || (weeklyRatio >= 1.5);

    return {
      isTriggered,
      multiple,
      price: today.close,
      changePercent,
      weeklyComparison: {
        thisWeekVol: thisWeekTotalVol,
        lastWeekVol: lastWeekTotalVol,
        ratio: weeklyRatio
      }
    };
  } catch (error) {
    return { 
      isTriggered: false, multiple: 0, price: 0, changePercent: 0,
      weeklyComparison: { thisWeekVol: 0, lastWeekVol: 0, ratio: 0 }
    };
  }
};

/**
 * 【詳細繁體中文註解】：評估虛擬幣雙向趨勢策略 (Long/Short) - V2 短線強化版
 * 結合 Supertrend 趨勢、MACD 動能共振與 RSI 強弱分水嶺，提升短線勝率。
 */
export const evaluateCryptoStrategy = async (symbol: string, interval: string = '4h'): Promise<{ 
  signal: 'LONG' | 'SHORT' | 'HOLD'; 
  reason: string; 
  price: number;
  indicators: any;
}> => {
  try {
    const { data } = await fetchStockData(symbol, 200, interval);
    if (data.length < 50) return { signal: 'HOLD', reason: "資料量不足", price: 0, indicators: {} };

    const current = data[data.length - 1];
    const prev = data[data.length - 2];
    const price = current.close;

    // 取得基礎指標
    const prices = data.map(d => d.close);
    
    // 1. Supertrend (趨勢方向)
    const { dir } = calculateSupertrend(data, 3.0, 10);
    const currDir = dir[dir.length - 1];
    const prevDir = dir[dir.length - 2];

    // 2. MACD (動能指標)
    const macd = calculateMACD(prices);
    const currHist = macd.hist[macd.hist.length - 1];
    const prevHist = macd.hist[macd.hist.length - 2];
    const currMacd = macd.dif[macd.dif.length - 1];
    const currSignal = macd.macd[macd.macd.length - 1];

    // 3. RSI (強弱力量)
    const rsiList = calculateRSI(prices, 14);
    const currRsi = rsiList[rsiList.length - 1];

    const indicators = {
      price,
      rsi: currRsi?.toFixed(2),
      macdHist: currHist?.toFixed(4),
      trend: currDir === -1 ? 'UP' : 'DOWN',
      macdCross: currMacd > currSignal ? 'GOLDEN' : 'DEATH'
    };

    // --- 【進場策略 V2】 ---

    // A. 做多策略 (LONG)
    if (currDir === -1 && prevDir === 1 && currRsi > 45) {
      return { signal: 'LONG', reason: "【趨勢反轉】Supertrend 翻綠 + RSI 進入強勢區，多頭動能啟動", price, indicators };
    }
    if (currDir === -1 && currMacd > currSignal && prevHist < 0 && currHist > 0 && currRsi > 50) {
      return { signal: 'LONG', reason: "【多頭加倉】趨勢向上且 MACD 零軸上方二次金叉，強勢行情預期", price, indicators };
    }
    if (currRsi < 15 && currHist > prevHist) {
      return { signal: 'LONG', reason: "【超跌抄底】RSI 極度超賣且空頭動能萎縮，預期強烈反彈", price, indicators };
    }

    // B. 做空策略 (SHORT)
    if (currDir === 1 && prevDir === -1 && currRsi < 55) {
      return { signal: 'SHORT', reason: "【趨勢反轉】Supertrend 翻紅 + RSI 轉弱，空頭勢力介入", price, indicators };
    }
    if (currDir === 1 && currMacd < currSignal && prevHist > 0 && currHist < 0 && currRsi < 45) {
      return { signal: 'SHORT', reason: "【空頭加速】趨勢向上且 MACD 跌破訊號線，跌勢可能擴大", price, indicators };
    }
    if (currRsi > 85 && currHist < prevHist) {
      return { signal: 'SHORT', reason: "【超買見頂】RSI 極度過熱且多頭動能衰退，預期出現大幅回調", price, indicators };
    }

    return { signal: 'HOLD', reason: "目前訊號不明確，建議觀望等待共振點", price, indicators };
  } catch (error) {
    return { signal: 'HOLD', reason: "系統評估異常", price: 0, indicators: {} };
  }
};

/**
 * 【詳細繁體中文註解】：抓取個股基本面資料 (市值、本益比、殖利率等)
 * 透過 Yahoo Finance Quote API 取得
 */
/**
 * 【詳細繁體中文註解】：一次抓取多個股票的即時報價
 */
export const fetchStockMetaOnly = async (symbol: string): Promise<any> => {
  try {
    let normalizedSymbol = symbol;
    if (!symbol.includes('.') && /^\d{4,6}$/.test(symbol)) {
      normalizedSymbol = `${symbol}.TW`;
    }
    
    const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalizedSymbol)}?range=1d&interval=1d`;
    const response = await fetchWithTimeout(yfUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: 'no-store'
    }, 4000);

    if (!response.ok && normalizedSymbol.endsWith('.TW')) {
      const fallbackSymbol = normalizedSymbol.replace('.TW', '.TWO');
      const fallbackUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fallbackSymbol)}?range=1d&interval=1d`;
      const fallbackRes = await fetchWithTimeout(fallbackUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, 4000);
      if (fallbackRes.ok) {
        const result = await fallbackRes.json();
        return result.chart?.result?.[0]?.meta;
      }
    }

    const result = await response.json();
    return result.chart?.result?.[0]?.meta;
  } catch (error) {
    return null;
  }
};

export const fetchMultipleStockQuotes = async (symbols: string[]): Promise<any[]> => {
  if (symbols.length === 0) return [];
  try {
    // 限制在 3 個同業以確保分析不超時
    const limitedSymbols = symbols.slice(0, 3);
    const results = await Promise.all(limitedSymbols.map(async (s) => {
      const meta = await fetchStockMetaOnly(s);
      if (!meta) return null;
      return {
        symbol: s,
        shortName: meta.shortName || meta.longName,
        regularMarketPrice: meta.regularMarketPrice,
        regularMarketChangePercent: meta.previousClose ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100 : 0
      };
    }));
    
    return results.filter(r => r !== null);
  } catch (error) {
    console.error(`[StockService] 抓取多檔報價失敗 (備援模式):`, error);
    return [];
  }
};

export const fetchStockFundamentals = async (symbol: string): Promise<any> => {
  try {
    let yfSymbol = symbol;
    if (!symbol.includes('.') && /^\d{4,6}$/.test(symbol)) {
      yfSymbol = `${symbol}.TW`;
    }

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${yfSymbol}?modules=summaryDetail,defaultKeyStatistics,assetProfile`;
    let response = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 5000);
    
    // 備援機制：如果 .TW 失敗，嘗試 .TWO
    if (!response.ok && yfSymbol.endsWith('.TW')) {
      const fallbackUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${yfSymbol.replace('.TW', '.TWO')}?modules=summaryDetail,defaultKeyStatistics,assetProfile`;
      const fallbackRes = await fetchWithTimeout(fallbackUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, 5000);
      if (fallbackRes.ok) response = fallbackRes;
    }

    if (!response.ok) {
      // 備援方案：如果 quoteSummary 失敗，嘗試從更輕量的 chart API 抓取基礎 meta
      const meta = await fetchStockMetaOnly(symbol);
      if (meta) {
        return {
          name: meta.longName || meta.shortName || getStockName(symbol),
          marketCap: null,
          trailingPE: null,
          forwardPE: null,
          dividendYield: null,
          bookValue: null,
          priceToBook: null,
          fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
          currency: meta.currency
        };
      }
      return null;
    }
    const result: any = await response.json();
    const summary = result.quoteSummary?.result?.[0];
    if (!summary) return null;

    const detail = summary.summaryDetail || {};
    const stats = summary.defaultKeyStatistics || {};
    const profile = summary.assetProfile || {};

    return {
      name: profile.longName || profile.shortName || getStockName(symbol),
      marketCap: detail.marketCap?.raw,
      trailingPE: detail.trailingPE?.raw || stats.trailingPE?.raw,
      forwardPE: detail.forwardPE?.raw || stats.forwardPE?.raw,
      dividendYield: detail.dividendYield?.raw || detail.trailingAnnualDividendYield?.raw,
      bookValue: stats.bookValue?.raw,
      priceToBook: stats.priceToBook?.raw,
      fiftyTwoWeekHigh: detail.fiftyTwoWeekHigh?.raw,
      fiftyTwoWeekLow: detail.fiftyTwoWeekLow?.raw,
      currency: detail.currency
    };
  } catch (error) {
    console.error(`[StockService] 抓取 ${symbol} 基本面失敗:`, error);
    return null;
  }
};

/**
 * 【詳細繁體中文註解】：抓取個股近期相關新聞 (Yahoo Finance RSS)
 * 提供給 AI 分析時事與產業動態
 */
export const fetchStockNews = async (symbol: string): Promise<string[]> => {
  try {
    let yfSymbol = symbol;
    if (!symbol.includes('.') && /^\d{4,6}$/.test(symbol)) {
      yfSymbol = `${symbol}.TW`;
    }

    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${yfSymbol}&region=US&lang=en-US`;
    const response = await fetchWithTimeout(rssUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, 5000);
    
    if (!response.ok) return [];
    const xml = await response.text();
    
    // 簡單的 XML 解析取 title
    const titles: string[] = [];
    const regex = /<title>(.*?)<\/title>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const title = match[1].replace('<![CDATA[', '').replace(']]>', '');
      if (title && title !== 'Yahoo! Finance: RSS') {
        titles.push(title);
      }
    }
    
    return titles.slice(0, 5); // 回傳前 5 則最新新聞
  } catch (error) {
    console.error(`[StockService] 抓取 ${symbol} 新聞失敗:`, error);
    return [];
  }
};

/**
 * 【詳細繁體中文註解】：抓取同業競爭對手 (Peers)
 */
export const fetchStockPeers = async (symbol: string): Promise<string[]> => {
  try {
    let yfSymbol = symbol;
    if (!symbol.includes('.') && /^\d{4,6}$/.test(symbol)) {
      yfSymbol = `${symbol}.TW`;
    }

    const url = `https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${yfSymbol}`;
    const response = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 5000);
    
    if (!response.ok) return [];
    const result: any = await response.json();
    const recommended = result.finance?.result?.[0]?.recommendedSymbols || [];
    
    return recommended.map((r: any) => r.symbol);
  } catch (error) {
    console.error(`[StockService] 抓取 ${symbol} 同業失敗:`, error);
    return [];
  }
};

export const evaluateTrendMomentumData = (
  data: StockDataPoint[]
): {
  isTriggered: boolean;
  reasons: string[];
  score: number;
  trend: 'up' | 'down';
} => {
  if (data.length < 20) {
    return { isTriggered: false, reasons: ['數據不足'], score: 0, trend: 'down' };
  }

  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const reasons: string[] = [];
  let score = 0;

  const trend = latest.ma20 && prev.ma20
    ? latest.ma20 > prev.ma20
      ? 'up'
      : 'down'
    : latest.close >= prev.close
      ? 'up'
      : 'down';

  const isAboveMA20 = latest.ma20 ? latest.close > latest.ma20 : false;
  const isAboveEMA26 = latest.emaLong ? latest.close > latest.emaLong : false;

  if (isAboveMA20 || isAboveEMA26) {
    score += 40;
    reasons.push('中期趨勢向上');

    if (typeof latest.rsi === 'number' && latest.rsi < 55 && latest.rsi > 35) {
      score += 30;
      reasons.push('指標健康回調');
    }

    if (latest.ma20 && latest.ma20 !== 0) {
      const distToMA20 = Math.abs(latest.close - latest.ma20) / latest.ma20;
      if (distToMA20 < 0.03 && latest.close >= latest.ma20) {
        score += 30;
        reasons.push('回測均線支撐');
      }
    }
  } else if (prev.ma20 && prev.close <= prev.ma20 && latest.ma20 && latest.close > latest.ma20) {
    score += 50;
    reasons.push('強勢站上月線');
  }

  if (typeof latest.rsi === 'number' && latest.rsi < 45) {
    score += 10;
    reasons.push('RSI 仍在可布局區');
  }

  if (
    typeof latest.macdHist === 'number' &&
    typeof prev.macdHist === 'number' &&
    latest.macdHist > prev.macdHist
  ) {
    score += 15;
    reasons.push('MACD 動能轉強');
  }

  if (
    typeof latest.k === 'number' &&
    typeof latest.d === 'number' &&
    typeof prev.k === 'number' &&
    typeof prev.d === 'number' &&
    prev.k <= prev.d &&
    latest.k > latest.d
  ) {
    score += 10;
    reasons.push('KD 黃金交叉');
  }

  return {
    isTriggered: score >= 40,
    reasons: reasons.length > 0 ? reasons : ['趨勢條件不明確'],
    score,
    trend,
  };
};

export const evaluateConsecutiveVolumeData = (
  data: StockDataPoint[],
  multiplier: number = 1.5
): {
  isTriggered: boolean;
  reasons: string[];
  currentVolume: number;
  avgVolume: number;
  consecutiveDays: number;
} => {
  if (data.length < 10) {
    return { isTriggered: false, reasons: ['數據不足'], currentVolume: 0, avgVolume: 0, consecutiveDays: 0 };
  }

  let consecutiveCount = 0;
  let latestAvgVol = 0;

  for (let i = data.length - 1; i >= 5; i--) {
    const slice = data.slice(i - 5, i);
    const avgVol = slice.reduce((sum, d) => sum + d.volume, 0) / 5;

    if (i === data.length - 1) {
      latestAvgVol = avgVol;
    }

    if (data[i].volume > avgVol * multiplier) {
      consecutiveCount++;
    } else {
      break;
    }
  }

  const isTriggered = consecutiveCount >= 2;
  const reasons: string[] = [];
  if (isTriggered) {
    reasons.push(`量能連續 ${consecutiveCount} 期放大 (${multiplier} 倍以上)`);
  }

  return {
    isTriggered,
    reasons,
    currentVolume: data[data.length - 1].volume,
    avgVolume: latestAvgVol,
    consecutiveDays: consecutiveCount
  };
};

export const evaluateVolumeNoBreakoutData = (
  data: StockDataPoint[],
  multiplier: number = 1.5
): {
  isTriggered: boolean;
  reasons: string[];
  currentVolume: number;
  avgVolume: number;
  currentPrice: number;
  prevHigh: number;
} => {
  if (data.length < 6) {
    return { isTriggered: false, reasons: ['數據不足'], currentVolume: 0, avgVolume: 0, currentPrice: 0, prevHigh: 0 };
  }

  const current = data[data.length - 1];
  const prev = data[data.length - 2];
  const history5D = data.slice(data.length - 6, data.length - 1);
  const avgVolume5D = history5D.reduce((sum, d) => sum + d.volume, 0) / 5;

  const hasVolume = current.volume > avgVolume5D * multiplier;
  const noBreakout = current.high <= prev.high;
  const isTriggered = hasVolume && noBreakout;
  const reasons: string[] = [];

  if (isTriggered) {
    const volMultiple = (current.volume / avgVolume5D).toFixed(1);
    reasons.push(`爆量未過高 (量能達 ${volMultiple} 倍，但最高價 $${current.high} 未突破前高 $${prev.high})`);
  }

  return {
    isTriggered,
    reasons,
    currentVolume: current.volume,
    avgVolume: avgVolume5D,
    currentPrice: current.close,
    prevHigh: prev.high
  };
};

/**
 * 【詳細繁體中文註解】：評估「連續兩天/期以上有量能」的策略
 * 邏輯：
 * 1. 計算該 K 線週期（K-line interval）的 5 期成交量移動平均。
 * 2. 判斷最新的一期以及前一期的成交量是否皆大於 5 期均量的指定倍數（例如 1.5 倍）。
 * 3. 回傳是否觸發、量能放大倍數、以及連續放大的期數。
 * 
 * @param symbol 標的代號 (例如 2330.TW 或 BTC/USD)
 * @param interval K線週期，支援 '1d', '4h', '60m', '15m'
 * @param multiplier 成交量均量放大倍數閥值，預設為 1.5 倍
 */
export const evaluateConsecutiveVolume = async (
  symbol: string,
  interval: string = '1d',
  multiplier: number = 1.5
): Promise<{ 
  isTriggered: boolean; 
  reasons: string[]; 
  currentVolume: number; 
  avgVolume: number; 
  consecutiveDays: number;
}> => {
  try {
    const { data } = await fetchStockData(symbol, 60, interval);
    return evaluateConsecutiveVolumeData(data, multiplier);
  } catch (error) {
    console.error(`[StockService] 評估連續爆量失敗 (${symbol}):`, error);
    return { isTriggered: false, reasons: ["評估異常"], currentVolume: 0, avgVolume: 0, consecutiveDays: 0 };
  }
};

/**
 * 【詳細繁體中文註解】：評估「有量能但未突破上一個高點」的策略
 * 邏輯：
 * 1. 當前一期成交量大於 5 期成交量移動平均的指定倍數（例如 1.5 倍，代表有量能）。
 * 2. 當前一期的最高價小於或等於前一期的最高價（`current.high <= prev.high`），代表爆量但受制於阻力，未能突破高點。
 * 3. 這種情況通常暗示高檔有主力出貨壓力，或是正在進行箱型整理，蓄勢待發或即將面臨拉回。
 * 
 * @param symbol 標的代號 (例如 2330.TW 或 BTC/USD)
 * @param interval K線週期，支援 '1d', '4h', '60m', '15m'
 * @param multiplier 成交量均量放大倍數閥值，預設為 1.5 倍
 */
export const evaluateVolumeNoBreakout = async (
  symbol: string,
  interval: string = '1d',
  multiplier: number = 1.5
): Promise<{
  isTriggered: boolean;
  reasons: string[];
  currentVolume: number;
  avgVolume: number;
  currentPrice: number;
  prevHigh: number;
}> => {
  try {
    const { data } = await fetchStockData(symbol, 30, interval);
    return evaluateVolumeNoBreakoutData(data, multiplier);
  } catch (error) {
    console.error(`[StockService] 評估爆量未突破高點失敗 (${symbol}):`, error);
    return { isTriggered: false, reasons: ["評估異常"], currentVolume: 0, avgVolume: 0, currentPrice: 0, prevHigh: 0 };
  }
};
