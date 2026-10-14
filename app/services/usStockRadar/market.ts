/** @file Yahoo 美股動態名單與已收盤 K 線；不使用券商帳戶、報價金鑰或盤中未定版資料。 */
import type { UsStockCandle, UsStockTicker } from './types';
import { US_STOCK_RADAR_RULES } from './types';
import { aggregateUsStockFourHourCandles, usStockHourlyClosedAt } from './candles';

/** 固定輪替池補足 Yahoo 熱門榜未涵蓋的核心股；TSLL 保留供使用者既有部位觀察。 */
export const CURATED_US_STOCKS: Array<{ symbol: string; name: string }> = [
  { symbol: 'AAPL', name: 'Apple' }, { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' }, { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta Platforms' }, { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'TSLA', name: 'Tesla' }, { symbol: 'TSLL', name: 'Direxion Daily TSLA Bull 2X' },
  { symbol: 'AMD', name: 'AMD' }, { symbol: 'NFLX', name: 'Netflix' },
  { symbol: 'COIN', name: 'Coinbase' }, { symbol: 'HOOD', name: 'Robinhood' },
  { symbol: 'MSTR', name: 'Strategy' }, { symbol: 'IBIT', name: 'iShares Bitcoin Trust ETF' },
  { symbol: 'JPM', name: 'JPMorgan Chase' }, { symbol: 'V', name: 'Visa' },
];

async function yahooJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!response.ok) throw new Error(`Yahoo Finance 回應異常 ${response.status}`);
  return response.json() as Promise<T>;
}

/** Yahoo 熱門榜只負責動態初篩；真正流動性仍由每檔已收盤日線重新計算。 */
export async function fetchUsStockUniverse(): Promise<UsStockTicker[]> {
  const endpoint = (id: string) => `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?${new URLSearchParams({ formatted: 'false', scrIds: id, count: '40' })}`;
  const responses = await Promise.allSettled([
    yahooJson<any>(endpoint('most_actives')),
    yahooJson<any>(endpoint('day_gainers')),
  ]);
  const quotes = responses.flatMap(result => result.status === 'fulfilled'
    ? result.value?.finance?.result?.[0]?.quotes ?? [] : []);
  const merged = new Map<string, UsStockTicker>();
  for (const quote of quotes) {
    const symbol = String(quote.symbol ?? '').toUpperCase();
    const price = Number(quote.regularMarketPrice);
    const volume = Number(quote.regularMarketVolume);
    const averageVolume3m = Number(quote.averageDailyVolume3Month ?? volume);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || !['EQUITY', 'ETF'].includes(quote.quoteType) ||
      ![price, volume, averageVolume3m].every(Number.isFinite) || price < US_STOCK_RADAR_RULES.minPriceUsd ||
      price * Math.max(volume, averageVolume3m) < US_STOCK_RADAR_RULES.minAverageDollarVolumeUsd) continue;
    merged.set(symbol, { symbol, name: quote.shortName || quote.longName || symbol, price,
      changePct: Number(quote.regularMarketChangePercent) || 0, volume, averageVolume3m });
  }
  /** 兩個榜單同時失敗時改掃固定輪替池；這是覆蓋率 fallback，不會假造行情或流動性。 */
  return [...merged.values()];
}

/** 三檔漲幅、三檔成交活躍、四檔固定輪替，兼顧當日主流與未起漲核心股。 */
export function selectUsStockCandidates(universe: UsStockTicker[], slot: number): UsStockTicker[] {
  const chosen = new Map<string, UsStockTicker>();
  const gainers = [...universe].sort((a, b) => b.changePct - a.changePct || a.symbol.localeCompare(b.symbol));
  const active = [...universe].sort((a, b) => b.price * b.volume - a.price * a.volume || a.symbol.localeCompare(b.symbol));
  for (const item of gainers.filter(item => item.changePct > 0).slice(0, 3)) chosen.set(item.symbol, item);
  for (const item of active.filter(item => !chosen.has(item.symbol)).slice(0, 3)) chosen.set(item.symbol, item);
  const offset = CURATED_US_STOCKS.length ? (slot * 4) % CURATED_US_STOCKS.length : 0;
  const rotated = [...CURATED_US_STOCKS.slice(offset), ...CURATED_US_STOCKS.slice(0, offset)];
  for (const item of rotated) {
    if (chosen.size >= US_STOCK_RADAR_RULES.selectionLimit) break;
    const market = universe.find(ticker => ticker.symbol === item.symbol);
    chosen.set(item.symbol, market ?? { ...item, price: 0, changePct: 0, volume: 0, averageVolume3m: 0 });
  }
  return [...chosen.values()].slice(0, US_STOCK_RADAR_RULES.selectionLimit);
}

interface YahooChartResult {
  meta?: { shortName?: string; longName?: string };
  timestamp?: number[];
  indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
}

/** 4h 由 Yahoo 1h 正常交易時段合成；日線保留已收盤資料，兩者都排除盤前盤後。 */
export async function fetchUsStockCandles(symbol: string, interval: '4h' | '1d', cutoff: number) {
  const yahooInterval = interval === '4h' ? '1h' : '1d';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${new URLSearchParams({ range: '1y', interval: yahooInterval, includePrePost: 'false', events: 'div,splits' })}`;
  const payload = await yahooJson<any>(url);
  const result = payload?.chart?.result?.[0] as YahooChartResult | undefined;
  if (!result?.timestamp?.length) throw new Error(`${symbol} 沒有 Yahoo ${interval} 行情`);
  const quote = result.indicators?.quote?.[0] ?? {};
  const candles: UsStockCandle[] = [];
  for (let index = 0; index < result.timestamp.length; index++) {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];
    const openTime = result.timestamp[index] * 1000;
    /** 日線以正常交易時段 16:00 收盤確認；排程於收盤後七分鐘才抓取，避免額外延後半小時。 */
    const closeTime = interval === '4h' ? usStockHourlyClosedAt(openTime) : openTime + 6.5 * 60 * 60 * 1000;
    if ([open, high, low, close].some(value => value == null || !Number.isFinite(value)) || closeTime > cutoff) continue;
    if (Math.min(open!, high!, low!, close!) <= 0 || high! < Math.max(open!, close!) || low! > Math.min(open!, close!)) continue;
    candles.push({ openTime, closeTime, open: open!, high: high!, low: low!, close: close!, volume: Number(volume) || 0 });
  }
  candles.sort((left, right) => left.openTime - right.openTime);
  const raw = candles.filter((candle, index) => index === 0 || candle.openTime !== candles[index - 1].openTime);
  const unique = interval === '4h' ? aggregateUsStockFourHourCandles(raw) : raw;
  const minimum = interval === '4h' ? US_STOCK_RADAR_RULES.minFourHourBars : US_STOCK_RADAR_RULES.minDailyBars;
  if (unique.length < minimum) throw new Error(`${symbol} ${interval} 歷史不足（需要 ${minimum} 根已收盤 K 線）`);
  return { candles: unique, name: result.meta?.shortName || result.meta?.longName || symbol };
}

/** 只有最新 4 小時／收盤段 K 在 35 分鐘內才完整掃描；其餘排程只做輕量新鮮度檢查。 */
export function assertFreshUsStockBar(candles: UsStockCandle[], now: number) {
  const closedAt = candles.at(-1)!.closeTime!;
  if (closedAt > now || now - closedAt > 35 * 60 * 1000) throw new Error('美股目前休市或最新 4 小時行情尚未就緒');
  return candles.at(-1)!.openTime;
}
