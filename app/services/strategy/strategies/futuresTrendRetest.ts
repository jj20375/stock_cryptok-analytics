/** @file 合約趨勢回踩多空策略；4H 盤勢與 1H 回測確認，沒有交易所或通知副作用。 */
import type { StrategyModule } from '../types';
import { futuresRegime, FUTURES_WARMUP } from '../futuresRegime';
import { strategyParamError } from '../parameters';

const futuresTrendRetest: StrategyModule = {
  id: 'futures_trend_retest', name: '合約趨勢回踩續行', futuresOnly: true,
  description: 'Bitget USDT 永續多空：4H 趨勢、1H 突破後六根內回測確認；結構＋ATR 停損、2R 目標與時間退出。研究規則尚未證明績效。',
  markets: ['CRYPTO'], supportedIntervals: ['1h'], warmupBars: FUTURES_WARMUP, supportsShort: true, requiresNextOpen: true,
  /** 20 根突破、六根等待與 1.5 ATR 最小停損均為待驗證起點；不隨槓桿縮短。 */
  defaultParams: { breakoutBars: 20, retestBars: 6, bufferAtr: 0.3, minStopAtr: 1.5, maxStopAtr: 4, maxExtensionAtr: 1, targetR: 2, maxHoldingBars: 12 },
  paramMeta: [
    { key: 'breakoutBars', label: '突破回看根數', description: '僅使用突破之前的高低點', min: 10, max: 60, step: 1 },
    { key: 'retestBars', label: '回踩等待根數', description: '1H 突破後等待確認的最長時間', min: 2, max: 12, step: 1 },
    { key: 'bufferAtr', label: '結構緩衝 ATR', description: '停損放在回踩極值外側', min: 0.1, max: 1, step: 0.1 },
    { key: 'minStopAtr', label: '最小停損 ATR', description: '防止因槓桿而縮短波動空間', min: 1, max: 3, step: 0.1 },
    { key: 'maxStopAtr', label: '最大停損 ATR', description: '過寬就取消，不能硬縮進結構', min: 3, max: 8, step: 0.5 },
    { key: 'maxExtensionAtr', label: '最大追價 ATR', description: '距離突破位過遠不追價', min: 0.5, max: 2, step: 0.1 },
    { key: 'targetR', label: '目標 R', description: '實際成交後以初始價格風險換算目標', min: 2, max: 4, step: 0.1 },
    { key: 'maxHoldingBars', label: '最長持倉 1H 根數', description: '時間退出不受進場濾網阻擋', min: 4, max: 48, step: 1 },
  ],
  evaluate(ctx) {
    const { candles: c, index: i, params: p, position } = ctx;
    const state = futuresRegime(ctx), current = c[i];
    if (position) {
      const level = position.entryPlan?.invalidationPrice;
      if (i - (position.entryIndex ?? i) >= p.maxHoldingBars) return { type: 'EXIT', reason: '合約趨勢・持倉時間到期' };
      if (level != null && (position.side === 'LONG' ? current.close < level : current.close > level)) return { type: 'EXIT', reason: '合約趨勢・回踩結構失效' };
      return { type: 'HOLD' };
    }
    if (strategyParamError(futuresTrendRetest, p) || p.maxStopAtr < p.minStopAtr) return { type: 'HOLD', reason: '策略參數無效' };
    if (!['UP', 'DOWN'].includes(state.phase)) return { type: 'HOLD', reason: '4H 盤勢未符合趨勢策略' };
    const side = state.phase === 'UP' ? 'LONG' : 'SHORT', sign = side === 'LONG' ? 1 : -1, atr = state.atr;
    /** 記錄最接近進場的一個未成立階段，不把同根多個候選重複算成多筆訊號。 */
    let stage = 0;
    for (let j = i - 1; j >= i - p.retestBars; j--) {
      const prior = c.slice(j - p.breakoutBars, j);
      if (prior.length !== p.breakoutBars) continue;
      const level = side === 'LONG' ? Math.max(...prior.map(bar => bar.high)) : Math.min(...prior.map(bar => bar.low));
      if (sign * (c[j].close - level) <= 0) continue;
      stage = Math.max(stage, 1);
      const retest = c.slice(j + 1, i + 1);
      /** 六根內曾回踩即可；確認根收盤須重新守住突破位，不能要求每根回踩都已確認。 */
      if (!retest.some(bar => side === 'LONG' ? bar.low <= level + atr * p.bufferAtr : bar.high >= level - atr * p.bufferAtr)) continue;
      stage = Math.max(stage, 2);
      /** 已收盤根的高／低點確認突破，收盤亦須同向推進；不用未收盤資料或未來根。 */
      if (sign * (current.close - level) < 0 || sign * (current.close - c[i - 1].close) <= 0
        || (side === 'LONG' ? current.high <= c[i - 1].high : current.low >= c[i - 1].low)) continue;
      stage = Math.max(stage, 3);
      if (sign * (current.close - level) > atr * p.maxExtensionAtr) continue;
      stage = Math.max(stage, 4);
      const extreme = side === 'LONG' ? Math.min(...retest.map(bar => bar.low)) : Math.max(...retest.map(bar => bar.high));
      const stopPrice = extreme - sign * atr * p.bufferAtr;
      const stopDistance = Math.max(sign * (current.close - stopPrice), atr * p.minStopAtr);
      if (stopDistance > atr * p.maxStopAtr) continue;
      return { type: 'ENTRY', side, entryPlan: { stopDistance, stopPrice, minStopDistance: atr * p.minStopAtr, maxStopDistance: atr * p.maxStopAtr,
        minPrice: side === 'LONG' ? level : level - atr * p.maxExtensionAtr,
        maxPrice: side === 'LONG' ? level + atr * p.maxExtensionAtr : level,
        targetMultiple: p.targetR, minRewardRisk: 1.5, invalidationPrice: level },
        reason: `${state.reason}・1H 回踩 ${level.toPrecision(6)} 後確認${side === 'LONG' ? '轉強開多' : '轉弱開空'}` };
    }
    return { type: 'HOLD', reason: ['尚無前窗口收盤突破', '突破後尚未回踩', '回踩後尚未收盤確認',
      '確認價超過追價上限', '回踩結構停損過寬'][stage] };
  },
};
export default futuresTrendRetest;
