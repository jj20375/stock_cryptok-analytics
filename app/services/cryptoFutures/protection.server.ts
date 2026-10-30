/** @file 合約策略持倉保護；新倉停用仍檢查結構與時間退出，不建立新倉或反手。 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { cryptoAutoOrders, paperTrades } from '../../db/schema';
import type { CryptoFuturesTradingEnv } from '../cryptoAutoTrading/types';
import { futuresCandlesPage } from './market.server';
import { HOUR_MS } from '../strategy/futuresRegime';
import { loadAutomationCandles } from './automationCandles.server';
import { IndicatorCache } from '../strategy/indicatorCache';

export async function futuresProtectionReason(env: CryptoFuturesTradingEnv, trade: typeof paperTrades.$inferSelect, markPrice: number) {
  const audit = await drizzle(env.DB).select().from(cryptoAutoOrders).where(and(eq(cryptoAutoOrders.userId, trade.userId),
    eq(cryptoAutoOrders.paperTradeId, trade.id), inArray(cryptoAutoOrders.action, ['BUY', 'OPEN_LONG', 'OPEN_SHORT']))).orderBy(desc(cryptoAutoOrders.createdAt)).limit(1).all();
  const snapshot = audit.map(row => row.strategySnapshotJson ? JSON.parse(row.strategySnapshotJson) : null).find(row => row?.entryPlan && row?.strategyId?.startsWith('futures_'));
  if (!snapshot) return null;
  const plan = snapshot.entryPlan, short = trade.side === 'SELL', entry = Number(trade.entryPrice), stop = Number(trade.stopLossPrice);
  /** 市價單不能保證成交名目恰為估算額；對帳確認超過授權上限時退出，不繼續擴倉。 */
  if (trade.reconciliationStatus === 'RECONCILED' && snapshot.maxNotionalUsdt != null && entry * Number(trade.amount) > Number(snapshot.maxNotionalUsdt) + 1e-8) return '實際成交名目超過自動化授權上限';
  /** 已對帳成交若越過允許價位或計畫風險，立即要求平倉，不把成交後偏差隱藏為正常績效。 */
  if (trade.reconciliationStatus === 'RECONCILED' && (plan.minPrice != null && entry < plan.minPrice || plan.maxPrice != null && entry > plan.maxPrice
    || Math.abs(entry - stop) * Number(trade.amount) > Number(snapshot.capitalBaseUsdt) * 0.0025)) return '成交偏差使結構或價格風險失效';
  if (snapshot.targetPrice != null && (short ? markPrice <= snapshot.targetPrice : markPrice >= snapshot.targetPrice)) return '合約固定目標已觸及';
  if (snapshot.strategyId === 'futures_big_fish') {
    /** 原Pine只依Supertrend紅色平多；不能沿用另一策略的6小時或固定2R出場。 */
    const end = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
    const bars = await loadAutomationCandles(env, trade.symbol, end);
    if (short) throw new Error('合約吃大魚不支援空單，請核對持倉');
    return new IndicatorCache(bars).bigFish().direction.at(-1) === 1 ? '吃大魚・1H Supertrend紅色，多單出場' : null;
  }
  const openedAt = new Date(trade.createdAt + (trade.createdAt.endsWith('Z') ? '' : 'Z')).getTime();
  const maxHours = snapshot.strategyId === 'futures_trend_retest' ? 12 : 6;
  if (Date.now() - openedAt >= maxHours * HOUR_MS) return '合約持倉時間到期';
  const end = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
  const bars = await futuresCandlesPage(trade.symbol, 'TRADE', end - 199 * HOUR_MS, end);
  const last = bars.at(-1);
  if (!last || last.openTime !== end) throw new Error('持倉保護缺最新已收盤合約行情');
  if (plan.invalidationPrice != null && (short ? last.close > plan.invalidationPrice : last.close < plan.invalidationPrice)) return '1H 收盤結構失效';
  /**
   * 1R 保本推進保護：若持倉期間已收盤 K 線曾達 breakevenTriggerR 倍初始風險，
   * 當標記價回撤跌破（空單突破）含雙邊手續費緩衝的保本價時，主動觸發保護平倉，防止獲利單變成全額停損。
   */
  const triggerR = Number(plan.breakevenTriggerR ?? 0);
  const initialRisk = Math.abs(entry - stop);
  if (triggerR > 0 && initialRisk > 0) {
    const heldBars = bars.filter(b => b.openTime >= Math.floor(openedAt / HOUR_MS) * HOUR_MS);
    const reachedTriggerR = heldBars.some(b => short ? b.low <= entry - initialRisk * triggerR : b.high >= entry + initialRisk * triggerR);
    const breakevenPrice = entry * (short ? 1 - 2 * 0.0006 : 1 + 2 * 0.0006);
    if (reachedTriggerR && (short ? markPrice >= breakevenPrice : markPrice <= breakevenPrice)) return '達到 1R 後回撤觸及保本保護';
  }
  if (snapshot.strategyId === 'futures_range_reclaim') {
    const full = bars.filter((c, i) => i >= 3 && (c.openTime + HOUR_MS) % (4 * HOUR_MS) === 0).map(c => {
      const i = bars.indexOf(c), group = bars.slice(i - 3, i + 1);
      if (!group.every((b, j) => b.openTime === c.openTime - (3 - j) * HOUR_MS)) return null;
      return { openTime: group[0].openTime, open: group[0].open, close: c.close, high: Math.max(...group.map(b => b.high)),
        low: Math.min(...group.map(b => b.low)), volume: group.reduce((sum, b) => sum + b.volume, 0) };
    }).filter(c => c != null);
    const indicators = new IndicatorCache(full), adx = indicators.adx(14).adx.at(-1);
    /** 退出比進場保守：4H ADX 升至 25 即視為區間不再可靠，無需等待 EMA200 暖機。 */
    if (adx != null && adx >= 25) return '區間轉強趨勢，退出回歸持倉';
  }
  return null;
}
