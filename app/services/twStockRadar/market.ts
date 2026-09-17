/** @file 證交所動態候選與 Yahoo 台股已收盤 K 線；不讀券商帳戶或交易憑證。 */
import { aggregateTwStockFourHourCandles, twStockHourlyClosedAt } from './candles';
import { TW_STOCK_RADAR_RULES, type TwStockCandle, type TwStockTicker } from './types';

export const CURATED_TW_STOCKS: Array<{ symbol: string; name: string }> = [
  { symbol: '2330.TW', name: '台積電' }, { symbol: '2317.TW', name: '鴻海' },
  { symbol: '2454.TW', name: '聯發科' }, { symbol: '2308.TW', name: '台達電' },
  { symbol: '2382.TW', name: '廣達' }, { symbol: '2303.TW', name: '聯電' },
  { symbol: '2881.TW', name: '富邦金' }, { symbol: '2882.TW', name: '國泰金' },
  { symbol: '2891.TW', name: '中信金' }, { symbol: '2603.TW', name: '長榮' },
  { symbol: '2379.TW', name: '瑞昱' }, { symbol: '3711.TW', name: '日月光投控' },
  { symbol: '2357.TW', name: '華碩' }, { symbol: '3008.TW', name: '大立光' },
  { symbol: '2412.TW', name: '中華電' }, { symbol: '2002.TW', name: '中鋼' },
  { symbol: '3105.TWO', name: '穩懋' }, { symbol: '6488.TWO', name: '環球晶' },
];

async function publicJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`公開行情回應異常 ${response.status}`);
  return response.json() as Promise<T>;
}

const numeric = (value: unknown) => Number(String(value ?? '').replaceAll(',', '').replace('--', ''));

/** 證交所整體行情只做初篩；真正量價條件仍以每檔 Yahoo 已收盤資料重算。 */
export async function fetchTwStockUniverse(): Promise<TwStockTicker[]> {
  try {
    const payload = await publicJson<any>('https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&type=ALL');
    const table = payload.tables?.find((item: any) => String(item.title ?? '').includes('每日收盤行情'));
    if (!table?.data) throw new Error('證交所每日收盤表尚未就緒');
    return table.data.flatMap((row: any[]) => {
      const code = String(row[0] ?? '').trim();
      const price = numeric(row[8]);
      const volume = numeric(row[2]);
      const turnover = numeric(row[4]);
      const change = numeric(row[10]);
      const sign = String(row[9] ?? '').includes('-') ? -1 : 1;
      const previous = price - sign * change;
      if (!/^[1-9]\d{3}$/.test(code) || ![price, volume, turnover].every(Number.isFinite) || price <= 0) return [];
      return [{ symbol: `${code}.TW`, name: String(row[1] ?? code).trim(), price,
        changePct: previous > 0 ? sign * change / previous * 100 : 0, volume,
        averageVolume3m: turnover / price } satisfies TwStockTicker];
    });
  } catch {
    /** 休市或證交所短暫失敗時仍輪替核心池；個股 Yahoo 流動性硬門檻不會被繞過。 */
    return [];
  }
}

/** 四檔漲幅、四檔成交額與核心股輪替，避免只追逐單一熱門榜。 */
export function selectTwStockCandidates(universe: TwStockTicker[], slot: number): TwStockTicker[] {
  const chosen = new Map<string, TwStockTicker>();
  for (const item of [...universe].sort((a, b) => b.changePct - a.changePct).filter(item => item.changePct > 0).slice(0, 4)) {
    chosen.set(item.symbol, item);
  }
  for (const item of [...universe].sort((a, b) => b.price * b.volume - a.price * a.volume)) {
    if (chosen.size >= 8) break;
    chosen.set(item.symbol, item);
  }
  const offset = (slot * 4) % CURATED_TW_STOCKS.length;
  for (const item of [...CURATED_TW_STOCKS.slice(offset), ...CURATED_TW_STOCKS.slice(0, offset)]) {
    if (chosen.size >= TW_STOCK_RADAR_RULES.selectionLimit) break;
    const current = universe.find(ticker => ticker.symbol === item.symbol);
    chosen.set(item.symbol, current ?? { ...item, price: 0, changePct: 0, volume: 0, averageVolume3m: 0 });
  }
  return [...chosen.values()].slice(0, TW_STOCK_RADAR_RULES.selectionLimit);
}

interface YahooChartResult {
  meta?: { shortName?: string; longName?: string; symbol?: string };
  timestamp?: number[];
  indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
}

async function fetchYahooChart(symbol: string, interval: '1h' | '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${new URLSearchParams({ range: '1y', interval, includePrePost: 'false', events: 'div,splits' })}`;
  return publicJson<any>(url);
}

/** 上市代號若 Yahoo 查無資料會嘗試 .TWO；實際採用的名稱與代號保留在 meta。 */
export async function fetchTwStockCandles(symbol: string, interval: '4h' | '1d', cutoff: number) {
  const requested = /^\d{4}$/.test(symbol) ? `${symbol}.TW` : symbol;
  const yahooInterval = interval === '4h' ? '1h' : '1d';
  let payload: any;
  let actualSymbol = requested;
  try {
    payload = await fetchYahooChart(actualSymbol, yahooInterval);
    /** Yahoo 查無代號時有時仍回 200；沒有 result 也必須改試上櫃尾碼。 */
    if (!payload?.chart?.result?.[0]?.timestamp?.length) throw new Error(`${actualSymbol} 查無行情`);
  }
  catch (error) {
    if (!requested.endsWith('.TW')) throw error;
    actualSymbol = requested.replace('.TW', '.TWO');
    payload = await fetchYahooChart(actualSymbol, yahooInterval);
  }
  const result = payload?.chart?.result?.[0] as YahooChartResult | undefined;
  if (!result?.timestamp?.length) throw new Error(`${requested} 沒有 Yahoo ${interval} 行情`);
  const quote = result.indicators?.quote?.[0] ?? {};
  const candles: TwStockCandle[] = [];
  for (let index = 0; index < result.timestamp.length; index++) {
    const openTime = result.timestamp[index] * 1000;
    const closeTime = interval === '4h' ? twStockHourlyClosedAt(openTime) : openTime + 5 * 60 * 60 * 1000;
    const open = quote.open?.[index]; const high = quote.high?.[index];
    const low = quote.low?.[index]; const close = quote.close?.[index];
    if ([open, high, low, close].some(value => value == null || !Number.isFinite(value)) || closeTime > cutoff) continue;
    if (Math.min(open!, high!, low!, close!) <= 0 || high! < Math.max(open!, close!) || low! > Math.min(open!, close!)) continue;
    candles.push({ openTime, closeTime, open: open!, high: high!, low: low!, close: close!, volume: Number(quote.volume?.[index]) || 0 });
  }
  const raw = candles.sort((a, b) => a.openTime - b.openTime)
    .filter((candle, index, values) => index === 0 || candle.openTime !== values[index - 1].openTime);
  const unique = interval === '4h' ? aggregateTwStockFourHourCandles(raw) : raw;
  const minimum = interval === '4h' ? TW_STOCK_RADAR_RULES.minFourHourBars : TW_STOCK_RADAR_RULES.minDailyBars;
  if (unique.length < minimum) throw new Error(`${actualSymbol} ${interval} 歷史不足（需要 ${minimum} 根已收盤 K 線）`);
  return { candles: unique, symbol: actualSymbol,
    name: result.meta?.shortName || result.meta?.longName || actualSymbol };
}

export function assertFreshTwStockBar(candles: TwStockCandle[], now: number) {
  const closedAt = candles.at(-1)!.closeTime!;
  if (closedAt > now || now - closedAt > 35 * 60 * 1000) throw new Error('台股目前休市或最新 4 小時行情尚未就緒');
  return candles.at(-1)!.openTime;
}
