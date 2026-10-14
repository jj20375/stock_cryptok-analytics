/** @file 每檔股票七策略研究與 Top 10 排序；樣本不足、負期望、無新訊號及陳舊行情不硬湊榜。 */
import { IndicatorCache } from '../strategy/indicatorCache';
import type { StrategyModule } from '../strategy/types';
import { resolveEntryRisk } from '../backtest/entryExecution';
import { applySlippage } from '../backtest/costs';
import { isFreshDaytradeBar, sessionDay } from './candles';
import { prepareDaytradeHistory, replayDaytradeStrategy, summarizeDaytrades } from './backtest';
import { daytradeStrategies, DAYTRADE_RISK_STRATEGY_ID } from './strategies';
import { DAYTRADE_COST, DAYTRADE_RULES, isDaytradePriceEligible, type DaytradeCandle, type DaytradeRankRow, type DaytradeStockResult, type DaytradeStrategyResult } from './types';

export function analyzeDaytradeStock(symbol: string, name: string, raw: DaytradeCandle[], now: number,
  modules: StrategyModule[] = daytradeStrategies()): DaytradeStockResult {
  const { candles, liquidity, validationStart } = prepareDaytradeHistory(raw, now);
  const last = candles.at(-1);
  const latestRaw = raw.at(-1);
  if (!last || last.openTime !== latestRaw?.openTime) throw new Error('最新交易日缺少連續 15 分 K 線，無法分析');
  const indicators = new IndicatorCache(candles), riskStrategy = modules.find(module => module.id === DAYTRADE_RISK_STRATEGY_ID)!;
  if (!riskStrategy) throw new Error('缺少量增未破風控策略');
  const riskAction = riskStrategy.evaluate({ candles, index: candles.length - 1, indicators, position: null, params: riskStrategy.defaultParams });
  const riskWarning = riskAction.type === 'ENTRY' ? riskAction.reason : null;
  const strategies = modules.filter(module => module.id !== DAYTRADE_RISK_STRATEGY_ID).map(strategy => {
    const warmup = strategy.warmupBarsForParams?.(strategy.defaultParams) ?? strategy.warmupBars;
    const replay = replayDaytradeStrategy(candles, strategy, riskStrategy, indicators, liquidity);
    /** 當天結果不能參與歷史排序，避免候選在同日被自己之後的價格「驗證」。 */
    const historicalTrades = replay.trades.filter(trade => sessionDay(trade.exitTime) < sessionDay(now));
    const historical = summarizeDaytrades(historicalTrades), validation = summarizeDaytrades(historicalTrades.filter(trade => trade.entryTime >= validationStart));
    const exclusions: string[] = [];
    if (!isDaytradePriceEligible(last.close)) exclusions.push('最新股價不在 10 至 300 元範圍');
    if (candles.length <= warmup) exclusions.push(`暖機不足（需 ${warmup + 1} 根）`);
    if (historical.trades < DAYTRADE_RULES.minTrades) exclusions.push(`歷史少於 ${DAYTRADE_RULES.minTrades} 筆`);
    if (validation.trades < DAYTRADE_RULES.minValidationTrades) exclusions.push(`近期驗證少於 ${DAYTRADE_RULES.minValidationTrades} 筆`);
    if ((validation.averageNetReturnPct ?? 0) <= 0) exclusions.push('近期扣成本後平均報酬未大於零');
    if ((historical.averageNetReturnPct ?? 0) <= 0) exclusions.push('歷史扣成本後平均報酬未大於零');
    const action = replay.signal;
    const risk = action ? resolveEntryRisk('LONG', applySlippage(last.close, 'BUY', DAYTRADE_COST), action.stopLossPct ?? 5, action.entryPlan, DAYTRADE_COST) : null;
    /** 參考收盤價僅能預估停損；實際下一根開盤仍須重驗追價與報酬風險門檻。 */
    const signal = action && risk && !('error' in risk) ? { reason: action.reason, referencePrice: last.close,
      stopPrice: risk.stopLossPrice, targetPrice: action.entryPlan?.targetPrice ?? null } : null;
    return { id: strategy.id, name: strategy.name, adapted: !strategy.supportedIntervals.includes('15m'),
      historical, validation, validationStart, signal, qualified: exclusions.length === 0, exclusions } satisfies DaytradeStrategyResult;
  });
  return { symbol, name, price: last.close, bars: candles.length, startTime: candles[0].openTime, closedAt: last.closeTime,
    averageTurnover: liquidity.get(sessionDay(last.openTime)) ?? 0,
    fresh: isFreshDaytradeBar(last, now), riskWarning, strategies };
}

const compareRows = (left: DaytradeRankRow, right: DaytradeRankRow) =>
  (right.strategy.validation.winRatePct ?? -1) - (left.strategy.validation.winRatePct ?? -1) ||
  (right.strategy.validation.winRateLowerPct ?? -1) - (left.strategy.validation.winRateLowerPct ?? -1) ||
  (right.strategy.validation.averageNetReturnPct ?? -1) - (left.strategy.validation.averageNetReturnPct ?? -1) || left.stock.symbol.localeCompare(right.stock.symbol);

export function rankDaytradeStocks(stocks: DaytradeStockResult[], currentOnly: boolean): DaytradeRankRow[] {
  /** 每檔只佔一名，以符合條件的最高近期驗證勝率策略排序，其他命中策略保留供比較。 */
  return stocks.flatMap(stock => {
    if (!isDaytradePriceEligible(stock.price)) return [];
    if (currentOnly && (!stock.fresh || stock.riskWarning)) return [];
    const matches = stock.strategies.filter(strategy => strategy.qualified && (!currentOnly || strategy.signal));
    const rows = matches.map(strategy => ({ stock, strategy, matchedStrategies: matches.filter(item => item.signal).map(item => item.name) }));
    return rows.sort(compareRows).slice(0, 1);
  }).sort(compareRows).slice(0, DAYTRADE_RULES.topLimit);
}
