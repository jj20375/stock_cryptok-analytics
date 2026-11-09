/**
 * @file 每日紫微預測快照的寫入、回填與讀取。副作用：寫入 D1 `metaphysics_market_forecasts`。
 * 只存規則算出的結果，不影響任何交易或羅盤資料；寫入失敗由呼叫端吞掉並記 log。
 */
import { and, eq, isNull, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { metaphysicsMarketForecasts } from '../../db/metaphysicsSchema';
import type { D1Binding } from './birthProfileStore.server';
import type { DayOutcome, ScoredRow } from './hitRate';
import type { MetaMarket } from './marketChartSpecs';
import { ZIWEI_RULE_VERSION, type ZiweiDayResult } from './types';

export type ForecastSource = 'live' | 'backtest';

/** 台股、美股只在週一至週五建立快照（休市日沒有行情可回填）；BTC 全年無休。 */
export function shouldSnapshot(market: MetaMarket, tradeDate: string): boolean {
  if (market === 'CRYPTO') return true;
  const weekday = new Date(`${tradeDate}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/** 寫入當日上線快照；同一天同版本已存在就不覆寫（保留「當時頁面顯示的內容」）。 */
export async function recordLiveForecast(db: D1Binding, result: ZiweiDayResult, now = Date.now()): Promise<void> {
  await drizzle(db).insert(metaphysicsMarketForecasts).values({
    market: result.market, tradeDate: result.tradeDate, ruleVersion: result.ruleVersion, source: 'live',
    directionScore: result.directionScore, turningStrength: result.turningStrength,
    triggersJson: JSON.stringify(result.triggers), createdAt: now,
  }).onConflictDoNothing().run();
}

/** 尚未回填實際結果、且日期早於 beforeDate 的上線快照日期。 */
export async function listPendingLiveDates(db: D1Binding, market: MetaMarket, beforeDate: string): Promise<string[]> {
  const rows = await drizzle(db).select({ tradeDate: metaphysicsMarketForecasts.tradeDate }).from(metaphysicsMarketForecasts)
    .where(and(eq(metaphysicsMarketForecasts.market, market), eq(metaphysicsMarketForecasts.source, 'live'),
      eq(metaphysicsMarketForecasts.ruleVersion, ZIWEI_RULE_VERSION), isNull(metaphysicsMarketForecasts.actualChangePct),
      lt(metaphysicsMarketForecasts.tradeDate, beforeDate))).all();
  return rows.map((row) => row.tradeDate);
}

/** 把實際結果回填到對應日期的上線快照；回傳更新筆數。 */
export async function applyOutcomes(db: D1Binding, market: MetaMarket, outcomes: DayOutcome[]): Promise<number> {
  let updated = 0;
  for (const outcome of outcomes) {
    const result = await drizzle(db).update(metaphysicsMarketForecasts)
      .set({ actualChangePct: outcome.changePct, isTurningActual: outcome.isTurning ? 1 : 0 })
      .where(and(eq(metaphysicsMarketForecasts.market, market), eq(metaphysicsMarketForecasts.tradeDate, outcome.date),
        eq(metaphysicsMarketForecasts.source, 'live'), isNull(metaphysicsMarketForecasts.actualChangePct))).run();
    updated += result.meta.changes ?? 0;
  }
  return updated;
}

/** 讀取某市場、某來源、目前規則版本的所有預測，供命中率統計。 */
export async function loadScoredRows(db: D1Binding, market: MetaMarket, source: ForecastSource): Promise<ScoredRow[]> {
  const rows = await drizzle(db).select().from(metaphysicsMarketForecasts)
    .where(and(eq(metaphysicsMarketForecasts.market, market), eq(metaphysicsMarketForecasts.source, source),
      eq(metaphysicsMarketForecasts.ruleVersion, ZIWEI_RULE_VERSION))).all();
  return rows.map((row) => ({ turningStrength: row.turningStrength, directionScore: row.directionScore,
    actualChangePct: row.actualChangePct, isTurningActual: row.isTurningActual == null ? null : row.isTurningActual === 1 }));
}
