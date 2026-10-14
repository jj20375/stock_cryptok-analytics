/** @file Bitget 1H 暖機資料共用快取；每小時只補缺少根數，仍驗證最新收盤與連續性。 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { futuresAutomationCandles } from '../../db/futuresAutomationSchema';
import type { CryptoFuturesTradingEnv } from '../cryptoAutoTrading/types';
import type { Candle } from '../strategy/types';
import { HOUR_MS } from '../strategy/futuresRegime';
import { futuresCandlesPage } from './market.server';
export function validAutomationCandles(value: unknown, end: number): value is Candle[] {
  return Array.isArray(value) && value.length >= 824 && value.length <= 1000 && value.every((bar, i) => bar &&
    [bar.openTime, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) && bar.openTime % HOUR_MS === 0 &&
    bar.openTime <= end && bar.low > 0 && bar.volume >= 0 && bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close) &&
    (!i || bar.openTime === value[i - 1].openTime + HOUR_MS));
}
export async function loadAutomationCandles(env: CryptoFuturesTradingEnv, symbol: string, end: number) {
  const db = drizzle(env.DB), cached = await db.select().from(futuresAutomationCandles).where(eq(futuresAutomationCandles.symbol, symbol)).get();
  let old: Candle[] = [];
  try { const parsed = JSON.parse(cached?.candlesJson ?? '[]'); if (validAutomationCandles(parsed, end)) old = parsed; } catch { /* 損壞快取直接重建，不把未知資料送入策略。 */ }
  if (old.at(-1)?.openTime === end) return old;
  const from = Math.max(end - 999 * HOUR_MS, old.length ? old.at(-1)!.openTime + HOUR_MS : 0);
  const rows = new Map(old.map(bar => [bar.openTime, bar]));
  let cursor = end;
  for (let page = 0; page < 5 && cursor >= from; page++) {
    const bars = await futuresCandlesPage(symbol, 'TRADE', from, cursor);
    if (!bars.length) break;
    bars.forEach(bar => rows.set(bar.openTime, bar)); cursor = bars[0].openTime - HOUR_MS;
  }
  const candles = [...rows.values()].filter(bar => bar.openTime >= end - 999 * HOUR_MS).sort((a, b) => a.openTime - b.openTime);
  if (!validAutomationCandles(candles, end) || candles.at(-1)!.openTime !== end) throw new Error('最新合約收盤行情或 4H 暖機資料不足，暫停此商品');
  await db.insert(futuresAutomationCandles).values({ symbol, candlesJson: JSON.stringify(candles), updatedAt: Date.now() })
    .onConflictDoUpdate({ target: futuresAutomationCandles.symbol, set: { candlesJson: JSON.stringify(candles), updatedAt: Date.now() } }).run();
  return candles;
}
