/** @file 合約 RSI2 順勢回踩研究；與已保存研究同一規則，只供歷史模擬，不授權 Demo 或正式下單。 */
import type { StrategyModule } from '../types';
import { FUTURES_WARMUP, futuresRegime } from '../futuresRegime';
import { strategyParamError } from '../parameters';

const futuresRsiPullbackResearch: StrategyModule = {
  id: 'futures_rsi_pullback_research', name: '合約 RSI2 順勢回踩（研究／僅回測）',
  description: '4H 趨勢＋1H EMA200 方向，RSI2 極值回踩；預設 2 ATR 停損、0.5R 目標、48 小時退出。與突破後回踩策略不同；研究尚未通過跨期驗證。',
  markets: ['CRYPTO'], supportedIntervals: ['1h'], warmupBars: FUTURES_WARMUP,
  futuresOnly: true, backtestOnly: true, supportsShort: true, requiresNextOpen: true,
  /** 沿用研究鎖定值，不因加入選單而再以 ADA 或 AVAX 結果調參；低 R 目標仍須支付雙邊成本。 */
  defaultParams: { threshold: 20, stopAtr: 2, targetR: 0.5, maxHoldingBars: 48 },
  paramMeta: [
    { key: 'threshold', label: 'RSI2 極值門檻', description: '多單低於此值、空單高於100減此值；需同向4H趨勢', min: 10, max: 20, step: 10 },
    { key: 'stopAtr', label: '停損 ATR', description: '訊號收盤時鎖定 ATR14 距離，進場後不放寬', min: 2, max: 3, step: 1 },
    { key: 'targetR', label: '固定目標 R', description: '0.5R 是較小目標，需要較高勝率抵銷虧損與成本', min: 0.5, max: 1, step: 0.25 },
    { key: 'maxHoldingBars', label: '最長持倉 1H 根數', description: '時間到期在下一根開盤退出', min: 24, max: 48, step: 24 },
  ],
  evaluate(ctx) {
    const { candles, index, indicators, params, position } = ctx;
    if (strategyParamError(futuresRsiPullbackResearch, params)) return { type: 'HOLD', reason: '研究策略參數無效' };
    if (position) return index - (position.entryIndex ?? index) >= params.maxHoldingBars
      ? { type: 'EXIT', reason: '研究回歸・固定持倉時間到期' } : { type: 'HOLD' };
    const state = futuresRegime(ctx), current = candles[index];
    if (['WAIT', 'SHOCK'].includes(state.phase)) return { type: 'HOLD', reason: '4H 盤勢或波動守衛未通過' };
    const rsi = indicators.rsi(2)[index], ema200 = indicators.ema(200)[index];
    const long = state.phase === 'UP' && current.close > ema200 && rsi < params.threshold;
    const short = state.phase === 'DOWN' && current.close < ema200 && rsi > 100 - params.threshold;
    if (long === short) return { type: 'HOLD', reason: '短週期回歸條件未成立' };
    const side = long ? 'LONG' : 'SHORT', distance = state.atr * params.stopAtr;
    /** 成交距離與目標鎖定在訊號根；仍由共用引擎驗證下一根跳價、費用及強平緩衝。 */
    return { type: 'ENTRY', side, reason: `RSI2 順勢回踩・${side}`, entryPlan: {
      stopDistance: distance, minStopDistance: distance, maxStopDistance: distance,
      minPrice: current.close - 0.5 * state.atr, maxPrice: current.close + 0.5 * state.atr,
      targetMultiple: params.targetR, minRewardRisk: params.targetR * 0.7,
    } };
  },
};
export default futuresRsiPullbackResearch;
