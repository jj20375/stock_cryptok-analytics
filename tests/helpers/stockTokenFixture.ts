/** @file 以規律震盪多頭與末根放量突破建立離線研究樣本；不代表真實市場績效。 */
import type { Candle } from '../../app/services/strategy/types';
import { HOUR_MS, type StockTokenInstrument, type StockTokenQuote } from '../../app/services/stockTokenRadar/types';

export const tokenNow = Date.UTC(2026, 10, 2, 16, 5);
export const tokenInstrument: StockTokenInstrument = { symbol: 'RAAPLUSDT', baseCoin: 'rAAPL', name: 'Apple' };
export const tokenInstrumentRow = { ...tokenInstrument, fullName: 'Apple', category: 'SPOT', quoteCoin: 'USDT',
  status: 'online', isReality: 'yes', instrumentType: 'stock', marketRegion: 'US' };

export function tokenFixture(now = tokenNow) {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  const make = (duration: number): Candle[] => Array.from({ length: 100 }, (_, i) => {
    const close = 100 + i * 0.03 + Math.sin(i * 0.7) * 0.7;
    return { openTime: Math.floor(end / duration) * duration - (100 - i) * duration,
      open: close - 0.1, high: close + 0.4, low: close - 0.5, close, volume: 100 };
  });
  const hourly = make(HOUR_MS), fourHourly = make(4 * HOUR_MS), latest = hourly.at(-1)!;
  latest.close = Math.max(...hourly.slice(-21, -1).map(c => c.high)) + 0.1;
  latest.high = latest.close + 0.2; latest.low = latest.close - 0.5; latest.open = latest.close - 0.2; latest.volume = 200;
  const quote: StockTokenQuote = { symbol: tokenInstrument.symbol, bid: latest.close, ask: latest.close + 0.01,
    bidSize: 10, askSize: 10, turnover: 10_000_000, platformTurnover: 1_000_000, spreadPct: 0.01, timestamp: now };
  return { hourly, fourHourly, quote };
}
export function tokenQuoteRow(quote: StockTokenQuote) {
  return { symbol: quote.symbol, category: 'SPOT', bid1Price: String(quote.bid), ask1Price: String(quote.ask),
    bid1Size: String(quote.bidSize), ask1Size: String(quote.askSize), turnover24h: String(quote.turnover),
    platformTurnover24h: String(quote.platformTurnover), ts: String(quote.timestamp) };
}
export const tokenCandleRows = (candles: Candle[]) => candles.map(c => [c.openTime, c.open, c.high, c.low, c.close, c.volume].map(String));
