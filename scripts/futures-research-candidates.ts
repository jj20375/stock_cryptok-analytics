/** @file 預先列定的合約候選集合；RSI2規則重用網站的僅回測模組，不啟用自動下單。 */
import type { StrategyModule } from '../app/services/strategy/types';
import { FUTURES_WARMUP, futuresRegime } from '../app/services/strategy/futuresRegime';
import registeredRsiPullback from '../app/services/strategy/strategies/futuresRsiPullbackResearch';

export interface ResearchCandidate { key: string; strategy: StrategyModule; params: Record<string, number> }
/** 使用既有閉合 4H 盤勢與衝擊守衛；兩類候選只改進場與固定獲利目標，不取消風控。 */
const strategy: StrategyModule = {
  id: 'research_futures_reversion', name: '合約短週期回歸（研究）', description: '候選研究，未宣稱達標',
  markets: ['CRYPTO'], supportedIntervals: ['1h'], warmupBars: FUTURES_WARMUP, futuresOnly: true,
  supportsShort: true, requiresNextOpen: true, defaultParams: {}, paramMeta: [],
  evaluate(ctx) {
    /** 網站與研究使用同一模組，保留原候選集的 family 參數供歷史結果重跑。 */
    if (ctx.params.family === 0) return registeredRsiPullback.evaluate(ctx);
    const { candles: c, index: i, indicators, params: p, position } = ctx;
    const current = c[i], previous = c[i - 1];
    if (position) return i - (position.entryIndex ?? i) >= p.maxHoldingBars
      ? { type: 'EXIT', reason: '研究回歸・固定持倉時間到期' } : { type: 'HOLD' };
    const state = futuresRegime(ctx), atr = state.atr;
    if (['WAIT', 'SHOCK'].includes(state.phase)) return { type: 'HOLD', reason: '4H 盤勢或波動守衛未通過' };
    const rsi = indicators.rsi(14), bb = indicators.bollinger();
    /** 已收盤根收回 BB20 兩倍標準差，RSI14 30／40；只在 RANGE，避免趨勢中逆向接刀。 */
    const long = state.phase === 'RANGE' && previous.low < bb.lower[i - 1] && current.close > bb.lower[i]
        && current.close > previous.close && rsi[i - 1] < p.threshold;
    const short = state.phase === 'RANGE' && previous.high > bb.upper[i - 1] && current.close < bb.upper[i]
        && current.close < previous.close && rsi[i - 1] > 100 - p.threshold;
    if (long === short) return { type: 'HOLD', reason: '短週期回歸條件未成立' };
    const side = long ? 'LONG' : 'SHORT';
    /** 停損事前固定為 2／3 ATR，目標 0.5／0.75／1R；低 R 本身可能無法彌補成本，照實淘汰。 */
    return { type: 'ENTRY', side, reason: `BB 區間收回・${side}`,
      entryPlan: { stopDistance: atr * p.stopAtr, minStopDistance: atr * p.stopAtr, maxStopDistance: atr * p.stopAtr,
        minPrice: current.close - 0.5 * atr, maxPrice: current.close + 0.5 * atr,
        targetMultiple: p.targetR, minRewardRisk: p.targetR * 0.7 } };
  },
};

/** 固定研究候選；AVAX 在本次結果後才被挑出，不註冊正式策略，不能當作已通過驗證或啟用下單。 */
export const futuresRsiPullbackResearch: StrategyModule = {
  ...registeredRsiPullback,
  defaultParams: { family: 0, threshold: 20, stopAtr: 2, targetR: 0.5, maxHoldingBars: 48 },
};

export function researchCandidates(): ResearchCandidate[] {
  const result: ResearchCandidate[] = [];
  for (const family of [0, 1]) for (const threshold of family === 0 ? [10, 20] : [30, 40]) {
    for (const stopAtr of [2, 3]) for (const targetR of [0.5, 0.75, 1]) for (const maxHoldingBars of [24, 48]) {
      const params = { family, threshold, stopAtr, targetR, maxHoldingBars };
      result.push({ key: Object.values(params).join('-'), strategy, params });
    }
  }
  return result;
}
