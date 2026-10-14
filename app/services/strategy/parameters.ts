/** @file 共用策略參數界線驗證；HTTP 與純策略都使用中繼資料拒絕非有限值、超界週期或錯誤步長。 */
import type { StrategyModule } from './types';
import { numericBoundsHint } from '../../utils/numericInput';

export function strategyParamError(strategy: Pick<StrategyModule, 'id' | 'paramMeta'>, params: Record<string, number>): string | null {
  for (const meta of strategy.paramMeta) {
    const value = params[meta.key];
    if (!Number.isFinite(value) || (meta.min != null && value < meta.min) || (meta.max != null && value > meta.max)) {
      return `策略參數超出允許範圍：${meta.label}（${numericBoundsHint(meta)}）`;
    }
    if (meta.step != null) {
      const steps = (value - (meta.min ?? 0)) / meta.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) return `策略參數步長不正確：${meta.label}`;
    }
  }
  if (strategy.id === 'range_mean_reversion' && params.exitAdx <= params.adxMax) return '出場 ADX 必須大於盤整 ADX 上限';
  if (params.maxStopAtr != null && params.minStopAtr != null && params.maxStopAtr < params.minStopAtr) return '最大停損 ATR 不可小於最小停損 ATR';
  return null;
}
