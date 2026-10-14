/** @file 合約區間假突破回收多空策略；固定候選邊界，下一根確認，不推論主力或清算行為。 */
import type { StrategyModule } from '../types';
import { futuresRegime, FUTURES_WARMUP } from '../futuresRegime';
import { strategyParamError } from '../parameters';

const futuresRangeReclaim: StrategyModule = {
  id: 'futures_range_reclaim', name: '合約區間假突破回收', futuresOnly: true,
  description: 'Bitget USDT 永續多空：4H 弱趨勢、1H 假突破收回後再等一根確認；固定區間中點目標、極值＋ATR 停損與六根時間退出。',
  markets: ['CRYPTO'], supportedIntervals: ['1h'], warmupBars: FUTURES_WARMUP, supportsShort: true, requiresNextOpen: true,
  defaultParams: { rangeBars: 24, bufferAtr: 0.3, minStopAtr: 1, maxStopAtr: 3, maxExtensionAtr: 0.5, minRewardRisk: 1.5, maxHoldingBars: 6 },
  paramMeta: [
    { key: 'rangeBars', label: '區間回看 1H 根數', description: '假突破之前的固定高低點', min: 12, max: 72, step: 1 },
    { key: 'bufferAtr', label: '極值外緩衝 ATR', description: '假突破極值外預留空間', min: 0.1, max: 1, step: 0.1 },
    { key: 'minStopAtr', label: '最小停損 ATR', description: '不因極值過近產生過量部位', min: 0.5, max: 2, step: 0.1 },
    { key: 'maxStopAtr', label: '最大停損 ATR', description: '過寬取消，保留結構風險', min: 2, max: 6, step: 0.5 },
    { key: 'maxExtensionAtr', label: '成交偏離上限 ATR', description: '下一根跳空不能照舊進場', min: 0.1, max: 1, step: 0.1 },
    { key: 'minRewardRisk', label: '最低淨報酬風險比', description: '以成本後獲利與成本後虧損比較', min: 1.5, max: 3, step: 0.1 },
    { key: 'maxHoldingBars', label: '最長持倉 1H 根數', description: '未回歸也須時間退出', min: 3, max: 24, step: 1 },
  ],
  evaluate(ctx) {
    const { candles: c, index: i, params: p, position } = ctx;
    const state = futuresRegime(ctx), current = c[i];
    if (position) {
      const boundary = position.entryPlan?.invalidationPrice;
      if (boundary != null && (position.side === 'LONG' ? current.close < boundary : current.close > boundary)) return { type: 'EXIT', reason: '區間回收・再次失守邊界' };
      if (['UP', 'DOWN'].includes(state.phase)) return { type: 'EXIT', reason: '區間回收・盤勢轉為趨勢' };
      if (i - (position.entryIndex ?? i) >= p.maxHoldingBars) return { type: 'EXIT', reason: '區間回收・持倉時間到期' };
      return { type: 'HOLD' };
    }
    if (strategyParamError(futuresRangeReclaim, p) || p.maxStopAtr < p.minStopAtr) return { type: 'HOLD', reason: '策略參數無效' };
    if (state.phase !== 'RANGE') return { type: 'HOLD', reason: '4H 盤勢未符合區間策略' };
    const history = c.slice(i - 1 - p.rangeBars, i - 1), reclaim = c[i - 1], atr = state.atr;
    const floor = Math.min(...history.map(bar => bar.low)), ceiling = Math.max(...history.map(bar => bar.high)), targetPrice = (floor + ceiling) / 2;
    /** 收回與下一根確認是兩階段；已收盤根突破前根極值且收盤同向推進，保留中點目標空間。 */
    const longSetup = reclaim.low < floor && reclaim.close > floor && reclaim.close < ceiling;
    const shortSetup = reclaim.high > ceiling && reclaim.close < ceiling && reclaim.close > floor;
    if (!longSetup && !shortSetup) return { type: 'HOLD', reason: '尚無假突破收回區間' };
    const long = longSetup && current.high > reclaim.high && current.close > reclaim.close;
    const short = shortSetup && current.low < reclaim.low && current.close < reclaim.close;
    if (long === short || current.close <= floor || current.close >= ceiling) return { type: 'HOLD', reason: '收回後尚未收盤確認' };
    const side = long ? 'LONG' : 'SHORT', sign = long ? 1 : -1;
    const stopPrice = (long ? reclaim.low : reclaim.high) - sign * atr * p.bufferAtr;
    const stopDistance = Math.max(sign * (current.close - stopPrice), atr * p.minStopAtr);
    if (stopDistance > atr * p.maxStopAtr) return { type: 'HOLD', reason: '假突破結構停損過寬' };
    if (sign * (targetPrice - current.close) <= 0) return { type: 'HOLD', reason: '確認時價格已到區間中點' };
    return { type: 'ENTRY', side, entryPlan: { stopDistance, stopPrice, minStopDistance: atr * p.minStopAtr, maxStopDistance: atr * p.maxStopAtr,
      minPrice: Math.max(floor, current.close - atr * p.maxExtensionAtr), maxPrice: Math.min(ceiling, current.close + atr * p.maxExtensionAtr),
      targetPrice, minRewardRisk: p.minRewardRisk, invalidationPrice: long ? floor : ceiling },
      reason: `${state.reason}・假突破收回並確認${long ? '開多' : '開空'}・固定區間目標 ${targetPrice.toPrecision(6)}` };
  },
};
export default futuresRangeReclaim;
