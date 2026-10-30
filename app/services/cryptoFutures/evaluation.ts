/** @file 合約研究報告：成本壓力、方向與時間分段；參數固定，不宣稱已完成自動最佳化或樣本外選模。 */
import { runBacktestEngine, type EngineConfig, type EngineResult } from '../backtest/engine';
import { computeMetrics } from '../backtest/metrics';
import type { Candle, StrategyModule } from '../strategy/types';
import { HOUR_MS, FUTURES_RULES_VERSION } from '../strategy/futuresRegime';
import { getStrategy } from '../strategy/registry';
import type { FuturesInstrument } from './market.server';

export function buildFuturesEvaluation(candles: Candle[], strategy: StrategyModule, params: Record<string, number>, config: EngineConfig,
  start: number, result: EngineResult, direction: string, markComplete: boolean, instrument: FuturesInstrument = 'BITGET_USDT_PERP') {
  const stats = (simulation: EngineResult) => {
    const m = computeMetrics(simulation.equityCurve, simulation.trades, config.initialCapital, 8760);
    return { ...m, profitFactor: Number.isFinite(m.profitFactor) ? m.profitFactor : 9999,
      totalFundingPnl: simulation.trades.reduce((sum, trade) => sum + (trade.fundingPnl ?? 0), 0) };
  };
  const stress = runBacktestEngine(candles, strategy, params, { ...config, captureEvents: false,
    cost: { ...config.cost, feeRate: config.cost.feeRate * 2, slippageBps: config.cost.slippageBps * 2 } }, start);
  const first = candles.findIndex(c => c.openTime >= start), count = candles.length - first;
  /** 時間分段各自從空手開始並於末端結算；完整先前歷史只做暖機，不跨段偷用未來資料。 */
  const boundaries = [first, first + Math.floor(count * 0.6), first + Math.floor(count * 0.8), candles.length];
  const segments = ['開發期 60%', '驗證期 20%', '保留期 20%'].map((label, i) => {
    const begin = boundaries[i], end = boundaries[i + 1];
    if (begin < 0 || begin >= end) return { label, insufficient: true };
    const simulation = runBacktestEngine(candles.slice(0, end), strategy, params, { ...config, captureEvents: false }, candles[begin].openTime);
    return { label, from: candles[begin].openTime, to: candles[end - 1].openTime + HOUR_MS, ...stats(simulation) };
  });
  const sides = (['LONG', 'SHORT'] as const).map(side => {
    const trades = result.trades.filter(t => t.side === side);
    const m = stats({ ...result, trades });
    return { side, totalTrades: m.totalTrades, winRatePct: m.winRatePct, expectancy: m.expectancy, profitFactor: m.profitFactor,
      netPnl: trades.reduce((sum, trade) => sum + trade.pnl, 0), fundingPnl: m.totalFundingPnl };
  });
  const baseline = getStrategy('big_fish')!;
  const baselineResult = runBacktestEngine(candles, baseline, baseline.defaultParams, { ...config, captureEvents: false }, start);
  const leverageUsed = result.trades.flatMap(trade => trade.initialMargin ? [trade.entryPrice * trade.quantity / trade.initialMargin] : []);
  const overallStats = stats(result);
  const weakSides = sides.filter(s => s.totalTrades >= 5 && (s.expectancy < 0 || s.winRatePct < 35)).map(s => s.side);
  const oosSegments = segments.slice(1).filter((seg): seg is Extract<typeof seg, { totalTrades: number }> => !('insufficient' in seg) && seg.totalTrades > 0);
  const outOfSampleConsistent = oosSegments.length > 0 && oosSegments.every(seg => seg.expectancy >= 0);
  /**
   * 【詳細繁體中文註解】：合約多空與樣本外勝率診斷
   * - 自動檢查 LONG / SHORT 是否有單邊期望值為負或勝率低於 35%，以及雙倍成本壓力測試與樣本外（驗證期／保留期）是否維持正期望值。
   */
  const winRateDiagnosis = {
    overallWinRatePct: overallStats.winRatePct,
    stressPositiveExpectancy: stats(stress).expectancy > 0,
    outOfSampleConsistent,
    weakSides,
    recommendation: weakSides.length === 1
      ? `${weakSides[0] === 'SHORT' ? '空方 (SHORT)' : '多方 (LONG)'} 樣本勝率或期望值偏弱，建議將交易方向改為僅做${weakSides[0] === 'SHORT' ? '多 (LONG)' : '空 (SHORT)'}以提升整體勝率`
      : !outOfSampleConsistent && oosSegments.length > 0
        ? '驗證期或保留期期望值轉負，建議維持觀察或收緊進場確認條件'
        : '多空方向與樣本外期望值穩定',
  };
  return { instrument, strategyName: strategy.name, strategyParams: { ...params }, backtestOnly: strategy.backtestOnly ?? false,
    direction, leverage: config.futures!.leverage, marginMode: 'ISOLATED',
    rulesVersion: FUTURES_RULES_VERSION, leveragePolicy: 'CAP', diagnostics: result.entryDiagnostics,
    leverageUsed: leverageUsed.length ? { min: Math.round(Math.min(...leverageUsed)), max: Math.round(Math.max(...leverageUsed)) } : null,
    tiersObservedAt: config.futures!.tiersObservedAt, markComplete, fundingComplete: true,
    liquidationModel: markComplete && config.futures!.tiers.length ? '目前級距＋標記價壓力估算，非歷史真實強平' : '資料不足，未驗證強平',
    totalFundingPnl: overallStats.totalFundingPnl, stress: stats(stress), segments, sides, winRateDiagnosis,
    baseline: { label: '原有吃大魚・相同合約行情與成本', ...stats(baselineResult), diagnostics: baselineResult.entryDiagnostics },
    events: result.events.slice(-5000), eventsTruncated: result.events.length > 5000,
    trades: result.trades, sampleSufficient: result.trades.length >= 30,
    assumptions: ['費率由使用者依帳戶填入，未自動驗證 VIP 費率', '同小時強平壓力優先，其次停損，再檢查目標',
      '台北日內淨虧損 1% 停止新倉；三次連虧冷卻六小時', '標記價觸發停損／目標，以同小時成交價範圍估算成交；需要細 K 線確認偏差', '級距為目前快照，沒有歷史抵扣額或 ADL 模型',
      '時間分段固定參數，各段獨立空手開始；尚未證明跨行情穩健性'] };
}
