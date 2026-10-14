/** @file 布林帶、Wilder ADX 與收斂狀態的純序列計算；每根只使用當根及歷史，不讀行情或產生交易副作用。 */
import type { Candle } from './types';

/** 收斂以各標的自身 120 根帶寬的低 20% 定義，連續三根後觀察五根；皆為未經績效驗證的研究預設。 */
export const SQUEEZE_DEFAULTS = { widthLookback: 120, widthPercentile: 20, compressionBars: 3, setupExpiryBars: 5 };

export function calculateBollinger(closes: number[], period = 20, multiplier = 2) {
  const basis = closes.map(() => NaN), upper = [...basis], lower = [...basis], width = [...basis];
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance) * multiplier;
    basis[i] = mean; upper[i] = mean + deviation; lower[i] = mean - deviation;
    width[i] = mean > 0 ? (upper[i] - lower[i]) / mean : NaN;
  }
  return { basis, upper, lower, width };
}

/** +DI／−DI 判斷方向，ADX 只判斷強度；首個 ADX 在 2×period−1，避免以暖機零值冒充盤整。 */
export function calculateAdx(candles: Candle[], period = 14) {
  const adx = candles.map(() => NaN), plusDi = [...adx], minusDi = [...adx];
  /** TR 與方向移動先累積 period 根，再使用 Wilder 平滑；dxSum 為首批 ADX 強度種子，不是價格。 */
  let trSum = 0, plusSum = 0, minusSum = 0, dxSum = 0;
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i], previous = candles[i - 1];
    const up = current.high - previous.high, down = previous.low - current.low;
    const tr = Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
    const plus = up > down && up > 0 ? up : 0, minus = down > up && down > 0 ? down : 0;
    if (i <= period) { trSum += tr; plusSum += plus; minusSum += minus; }
    else { trSum = trSum - trSum / period + tr; plusSum = plusSum - plusSum / period + plus; minusSum = minusSum - minusSum / period + minus; }
    if (i < period) continue;
    plusDi[i] = trSum > 0 ? 100 * plusSum / trSum : 0;
    minusDi[i] = trSum > 0 ? 100 * minusSum / trSum : 0;
    const totalDi = plusDi[i] + minusDi[i];
    const dx = totalDi > 0 ? 100 * Math.abs(plusDi[i] - minusDi[i]) / totalDi : 0;
    if (i < 2 * period) dxSum += dx;
    if (i === 2 * period - 1) adx[i] = dxSum / period;
    else if (i >= 2 * period) adx[i] = (adx[i - 1] * (period - 1) + dx) / period;
  }
  return { adx, plusDi, minusDi };
}

/** 維護排序窗口，避免每根重排全部歷史；百分位母體排除當根，防止突破本身改寫收斂門檻。 */
export function calculateWidthThreshold(width: number[], lookback: number, percentile: number) {
  const threshold = width.map(() => NaN), sorted: number[] = [];
  for (let i = 1; i < width.length; i++) {
    const incoming = width[i - 1];
    if (Number.isFinite(incoming)) {
      const insertion = sorted.findIndex(value => value >= incoming);
      sorted.splice(insertion < 0 ? sorted.length : insertion, 0, incoming);
    }
    if (i > lookback && Number.isFinite(width[i - lookback - 1])) {
      sorted.splice(sorted.indexOf(width[i - lookback - 1]), 1);
    }
    if (sorted.length !== lookback) continue;
    const rank = (lookback - 1) * percentile / 100, low = Math.floor(rank), fraction = rank - low;
    threshold[i] = sorted[low] + ((sorted[low + 1] ?? sorted[low]) - sorted[low]) * fraction;
  }
  return threshold;
}

export function calculateSqueeze(width: number[], lookback: number, percentile: number, compressionBars: number, expiryBars: number) {
  const threshold = calculateWidthThreshold(width, lookback, percentile);
  const setupIndex = width.map(() => -1), active = width.map(() => false);
  /** 連續收斂計數與最近已確認根索引；行情持續收斂可更新觀察，但不能引用尚未出現的突破。 */
  let streak = 0, latestSetup = -1;
  for (let i = 0; i < width.length; i++) {
    streak = Number.isFinite(threshold[i]) && width[i] <= threshold[i] ? streak + 1 : 0;
    if (streak >= compressionBars) latestSetup = i;
    setupIndex[i] = latestSetup;
    active[i] = latestSetup >= 0 && i - latestSetup <= expiryBars;
  }
  return { threshold, setupIndex, active };
}
