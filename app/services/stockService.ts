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

export const fetchRealTimeQuote = async (symbol: string): Promise<any> => {
  try {
    const response = await fetch(`/api/stock/${encodeURIComponent(symbol)}?range=1d&interval=1m`, { cache: 'no-store' });
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

export const fetchStockData = async (symbol: string, days: number = 120, interval: string = '1d'): Promise<{ data: StockDataPoint[], name: string }> => {
  try {
    let range = '1y';
    let fetchInterval = interval;
    
    // Adjust range and interval for intraday data
    if (interval === '15m') {
      range = '5d';
    } else if (interval === '60m' || interval === '4h') {
      range = '1mo';
      fetchInterval = '1h'; // Fetch 1h and aggregate for 4h
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

    const response = await fetch(`/api/stock/${encodeURIComponent(symbol)}?range=${range}&interval=${fetchInterval}`, { cache: 'no-store' });
    const result = await response.json();

    if (result.error || !result.chart || !result.chart.result || result.chart.result.length === 0) {
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

    const isTW = symbol.includes('.TW') || /^\d{4}$/.test(symbol);
    const currency = isTW ? 'TWD' : 'USD';

    let rawData: StockDataPoint[] = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.close[i] !== null && quotes.open[i] !== null) {
        const dateObj = new Date(timestamps[i] * 1000);
        // Format date: YYYY-MM-DD HH:mm for intraday, YYYY-MM-DD for daily
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
    
    // Aggregate for 4h if needed
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

    // Only fetch real-time quote for daily data to avoid mismatch in intraday
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
      name: stockName
    };
  } catch (error) {
    return { data: [], name: getStockName(symbol) };
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
