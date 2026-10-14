/** @file 15 分線當日平倉重放；沿用策略 evaluate、成交風控與成本，只模擬每股報酬，不下單。 */
import { IndicatorCache } from '../strategy/indicatorCache';
import type { OpenPositionState, StrategyAction, StrategyModule } from '../strategy/types';
import { applySlippage, calculateFee } from '../backtest/costs';
import { resolveEntryRisk } from '../backtest/entryExecution';
import { daytradeSessions, entryWindow, sessionDay, sessionMinute } from './candles';
import { DAYTRADE_COST, DAYTRADE_RULES, isDaytradePriceEligible, type DaytradeCandle, type DaytradeMetrics, type DaytradeTrade } from './types';

export function summarizeDaytrades(trades: DaytradeTrade[]): DaytradeMetrics {
  const wins = trades.filter(trade => trade.netReturnPct > 0), count = trades.length;
  const positive = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const negative = -trades.filter(trade => trade.netReturnPct < 0).reduce((sum, trade) => sum + trade.netReturnPct, 0);
  /** Wilson 95% 下界僅作同勝率的樣本量比較；交易非獨立，因此不是未來勝率保證。 */
  const rate = count ? wins.length / count : 0, z = 1.96;
  const lower = count ? (rate + z * z / (2 * count) - z * Math.sqrt(rate * (1 - rate) / count + z * z / (4 * count * count))) / (1 + z * z / count) : null;
  return { trades: count, wins: wins.length, winRatePct: count ? rate * 100 : null,
    averageNetReturnPct: count ? trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / count : null,
    profitFactor: negative > 0 ? positive / negative : null, winRateLowerPct: lower == null ? null : lower * 100 };
}

/** 完整交易日前五日成交額，不使用當日未完成成交量或未來資料篩選歷史交易。 */
export function prepareDaytradeHistory(raw: DaytradeCandle[], now: number) {
  const sessions = daytradeSessions(raw).filter(session => session.contiguous &&
    (session.complete || sessionDay(session.bars[0].openTime) === sessionDay(now)));
  const complete = sessions.filter(session => session.complete && sessionDay(session.bars[0].openTime) < sessionDay(now));
  const turnovers: number[] = [];
  const liquidity = new Map<number, number>();
  for (const session of sessions) {
    const prior = turnovers.slice(-DAYTRADE_RULES.liquidityDays);
    liquidity.set(sessionDay(session.bars[0].openTime), prior.length === DAYTRADE_RULES.liquidityDays ? prior.reduce((sum, value) => sum + value, 0) / prior.length : 0);
    if (session.complete) turnovers.push(session.bars.reduce((sum, bar) => sum + bar.close * bar.volume, 0));
  }
  const candles = sessions.flatMap(session => session.bars);
  const validationIndex = Math.floor(complete.length * (1 - DAYTRADE_RULES.validationFraction));
  const validationStart = complete[validationIndex]?.bars[0].openTime ?? now;
  return { candles, liquidity, validationStart };
}

type EntryAction = Extract<StrategyAction, { type: 'ENTRY' }>;
type Pending = { index: number; action: EntryAction | Extract<StrategyAction, { type: 'EXIT' }> };

/** 所有做多策略都套相同量增未破排除條件，歷史與目前篩選保持一致。 */
export function replayDaytradeStrategy(candles: DaytradeCandle[], strategy: StrategyModule, riskStrategy: StrategyModule,
  indicators: IndicatorCache, liquidity: Map<number, number>) {
  const trades: DaytradeTrade[] = [];
  let position: OpenPositionState | null = null;
  let pending: Pending | null = null;
  let signal: EntryAction | null = null;
  const params = { ...strategy.defaultParams };
  const warmup = strategy.warmupBarsForParams?.(params) ?? strategy.warmupBars;
  const contextAt = (index: number, held: OpenPositionState | null, module: StrategyModule = strategy) =>
    ({ candles, index, indicators, position: held, params: module === strategy ? params : module.defaultParams });
  const riskAt = (index: number) => riskStrategy.evaluate(contextAt(index, null, riskStrategy)).type === 'ENTRY';
  const closePosition = (price: number, time: number, exitReason: string) => {
    if (!position) return;
    const exitPrice = applySlippage(price, 'SELL', DAYTRADE_COST);
    const costs = calculateFee(position.entryPrice, 1, DAYTRADE_COST, 'BUY') + calculateFee(exitPrice, 1, DAYTRADE_COST, 'SELL');
    trades.push({ entryTime: position.entryTime, exitTime: time, entryPrice: position.entryPrice, exitPrice,
      netReturnPct: (exitPrice - position.entryPrice - costs) / position.entryPrice * 100, exitReason });
    position = null;
  };
  for (let i = warmup; i < candles.length; i++) {
    const bar = candles[i], prior = candles[i - 1];
    signal = null;
    /** 跨日或資料缺根立即取消委託；不拿次日價格當成同日可成交開盤。 */
    const adjacent = prior && bar.openTime - prior.openTime === DAYTRADE_RULES.intervalMs;
    if (!adjacent) pending = null;
    if (pending?.action.type === 'EXIT' && position) closePosition(bar.open, bar.openTime, pending.action.reason);
    /** 下一根若已跳空超過 300 元就取消進場；既有持倉超出上限仍照原風控平倉，不強改歷史損益。 */
    if (pending?.action.type === 'ENTRY' && !position && entryWindow(bar.openTime) && isDaytradePriceEligible(bar.open)) {
      const action = pending.action, fillPrice = applySlippage(bar.open, 'BUY', DAYTRADE_COST);
      const risk = resolveEntryRisk('LONG', fillPrice, action.stopLossPct ?? 5, action.entryPlan, DAYTRADE_COST);
      if (!('error' in risk)) position = { side: 'LONG', entryPrice: fillPrice, quantity: 1,
        stopLossPrice: risk.stopLossPrice, entryTime: bar.openTime, entryIndex: i, entryPlan: action.entryPlan };
    }
    pending = null;
    /** 13:15 用開盤模擬平倉；該根之後的高低不能倒推成更早停損。 */
    if (sessionMinute(bar.openTime) >= DAYTRADE_RULES.flattenMinute) {
      closePosition(bar.open, bar.openTime, '13:15 當日強制平倉'); continue;
    }
    if (position && bar.low <= position.stopLossPrice!) closePosition(Math.min(bar.open, position.stopLossPrice!), bar.openTime, '停損（跳空採較差開盤）');
    const action = strategy.evaluate(contextAt(i, position));
    if (action.type === 'EXIT' && position) pending = { index: i, action };
    else if (action.type === 'ENTRY' && action.side === 'LONG' && !position && entryWindow(bar.closeTime) &&
      isDaytradePriceEligible(bar.close) && (liquidity.get(sessionDay(bar.openTime)) ?? 0) >= DAYTRADE_RULES.minAverageTurnover && !riskAt(i)) {
      pending = { index: i, action }; signal = action;
    }
  }
  return { trades, signal, position };
}
