/** @file 固定 Bitget v3 公開現貨 API；明確辨識美國股票／ETF rToken，不猜代號、不使用帳戶金鑰。 */
import type { Candle } from '../strategy/types';
import { HOUR_MS, STOCK_TOKEN_RULES as RULES, type StockTokenInstrument, type StockTokenQuote } from './types';

async function publicMarket(endpoint: 'instruments' | 'tickers' | 'candles', params: Record<string, string>, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`https://api.bitget.com/api/v3/market/${endpoint}?${new URLSearchParams({ category: 'SPOT', ...params })}`, {
      headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    });
  } catch {
    signal?.throwIfAborted();
    // 保留 TLS 驗證；憑證或連線異常不能以假行情、舊快照或停用驗證來繼續評分。
    throw new Error('Bitget 公開現貨行情連線或憑證驗證失敗，請確認執行器網路與 CA 設定');
  }
  if (!response.ok) throw new Error(`Bitget 公開現貨行情無法取得（HTTP ${response.status}）`);
  const payload = await response.json() as { code?: string; data?: unknown };
  if (payload.code !== '00000' || !Array.isArray(payload.data)) throw new Error('Bitget 公開現貨行情格式或回應碼錯誤');
  return payload.data;
}

export async function loadStockTokenInstruments(signal?: AbortSignal): Promise<StockTokenInstrument[]> {
  const rows = await publicMarket('instruments', {}, signal) as Array<Record<string, string>>;
  return rows.filter(row => row.category === 'SPOT' && row.quoteCoin === 'USDT' && row.status === 'online'
    && row.isReality === 'yes' && row.marketRegion === 'US' && ['stock', 'etf'].includes(row.instrumentType)
    && /^r[A-Z][A-Z0-9.]{0,14}$/.test(row.baseCoin ?? '') && /^[A-Z0-9.]{1,20}USDT$/.test(row.symbol ?? '')
    && row.symbol === `${row.baseCoin.toUpperCase()}USDT`)
    .map(row => ({ symbol: row.symbol, baseCoin: row.baseCoin, name: (row.fullName || row.baseCoin).slice(0, 120) }));
}

/** 缺平台成交額不退回一般 turnover24h，避免將不同流動性來源誤當 Bitget 實際成交。 */
export async function loadStockTokenQuotes(signal?: AbortSignal): Promise<StockTokenQuote[]> {
  const rows = await publicMarket('tickers', {}, signal) as Array<Record<string, string>>;
  return rows.flatMap(row => {
    const numericKeys = ['bid1Price', 'ask1Price', 'bid1Size', 'ask1Size', 'turnover24h', 'platformTurnover24h', 'ts'];
    if (row.category !== 'SPOT' || numericKeys.some(key => typeof row[key] !== 'string' || !row[key].trim())) return [];
    const [bid, ask, bidSize, askSize, turnover, platformTurnover, timestamp] = numericKeys.map(key => Number(row[key]));
    if (![bid, ask, bidSize, askSize, turnover, platformTurnover, timestamp].every(Number.isFinite)
      || bid <= 0 || ask < bid || bidSize <= 0 || askSize <= 0 || turnover < 0 || platformTurnover < 0 || timestamp <= 0) return [];
    return [{ symbol: row.symbol, bid, ask, bidSize, askSize, turnover, platformTurnover,
      spreadPct: (ask - bid) / ((ask + bid) / 2) * 100, timestamp }];
  });
}

export function stockTokenQuoteIssue(quote: StockTokenQuote | undefined, now: number): string | null {
  if (!quote) return '缺有效雙邊報價或平台成交額';
  if (quote.timestamp > now + 5_000 || now - quote.timestamp > RULES.maxQuoteAgeMs) return '雙邊報價已逾期';
  if (quote.platformTurnover < RULES.minPlatformTurnover) return 'Bitget 平台 24h 成交額未達 10 萬 USDT';
  if (quote.spreadPct > RULES.maxSpreadPct) return '買賣價差超過 0.3%';
  return null;
}

/** 排序、去重並排除未收盤根；數值矛盾直接拒絕，不以假行情或股票現貨填補。 */
export async function loadStockTokenCandles(symbol: string, timeframe: '1H' | '4H', now: number, signal?: AbortSignal): Promise<Candle[]> {
  if (!/^[A-Z0-9.]{1,20}USDT$/.test(symbol) || !['1H', '4H'].includes(timeframe)) throw new Error('股票代幣查詢參數無效');
  const duration = timeframe === '1H' ? HOUR_MS : 4 * HOUR_MS;
  const rows = await publicMarket('candles', { symbol, interval: timeframe, type: 'market', limit: '121',
    endTime: String(now) }, signal);
  const candles = new Map<number, Candle>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6 || row.slice(0, 6).some(value => value == null || String(value).trim() === '')) throw new Error('股票代幣 K 線格式錯誤');
    const [openTime, open, high, low, close, volume] = row.slice(0, 6).map(Number);
    if (![openTime, open, high, low, close, volume].every(Number.isFinite) || openTime % duration !== 0
      || low <= 0 || volume < 0 || low > Math.min(open, close) || high < Math.max(open, close)) throw new Error('股票代幣 K 線數值無效');
    if (openTime + duration > now) continue;
    const candle = { openTime, open, high, low, close, volume }, previous = candles.get(openTime);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candle)) throw new Error('股票代幣重複 K 線價量矛盾');
    candles.set(openTime, candle);
  }
  return [...candles.values()].sort((a, b) => a.openTime - b.openTime).slice(-120);
}
