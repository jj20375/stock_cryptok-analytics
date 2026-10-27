/** @file 江恩（Gann）角度線、九方圖價位與時間週期的純函式；只讀已收盤 K 線，不抓資料、不下單。 */
/**
 * 【詳細繁體中文註解】：江恩工具（研究假設，非已驗證的交易優勢）
 *
 * 江恩理論本身沒有唯一的「價格／時間比例」定義，角度線的斜率取決於使用者選的刻度，
 * 因此這裡把刻度寫成明確參數，並在研究報告中把它當成「可被數據否定的假設」逐一檢驗。
 *
 * 防前視：所有函式只讀 candles[0..index]，擺動高低點只在回看窗口內尋找。
 */
import type { Candle } from './types';

/** 回看窗口內最低低點與最高高點的位置；窗口含當根 index，不含 index 之後。 */
export interface SwingPivots { lowIndex: number; highIndex: number }

export function findSwingPivots(candles: Candle[], index: number, lookback: number): SwingPivots {
  const start = Math.max(0, index - lookback + 1);
  let lowIndex = start;
  let highIndex = start;
  for (let i = start; i <= index; i++) {
    if (candles[i].low <= candles[lowIndex].low) lowIndex = i;
    if (candles[i].high >= candles[highIndex].high) highIndex = i;
  }
  return { lowIndex, highIndex };
}

/**
 * 江恩 1x1 角度線狀態。
 * - 上升 1x1：自窗口最低點起，每根 K 上升 `unitPerBar` 價格單位。
 * - 下降 1x1：自窗口最高點起，每根 K 下降 `unitPerBar` 價格單位。
 * 價格單位 = 擺動點當根的 ATR × atrFraction（例如 0.125 代表每 8 根 K 漲 1 個 ATR）。
 * 回傳 +1：收盤同時站上兩條線（多方控盤）；-1：同時跌破兩條線（空方控盤）；0：夾在中間。
 */
export function gannAngleState(candles: Candle[], atr: number[], index: number, lookback: number, atrFraction: number): -1 | 0 | 1 {
  const { lowIndex, highIndex } = findSwingPivots(candles, index, lookback);
  const lowUnit = (atr[lowIndex] || atr[index]) * atrFraction;
  const highUnit = (atr[highIndex] || atr[index]) * atrFraction;
  if (!(lowUnit > 0) || !(highUnit > 0)) return 0;
  const risingLine = candles[lowIndex].low + lowUnit * (index - lowIndex);
  const fallingLine = candles[highIndex].high - highUnit * (index - highIndex);
  const close = candles[index].close;
  if (close > risingLine && close > fallingLine) return 1;
  if (close < risingLine && close < fallingLine) return -1;
  return 0;
}

/**
 * 九方圖（Square of Nine）價位索引。
 * 九方圖上繞一圈（360°）對應價格平方根 +2，因此 45° 一格 = 平方根 +0.25。
 * 價格先乘以 10 的次方縮放到 [100, 10000)，讓低價幣與高價幣使用同樣的格密度；
 * 縮放冪次用「當根收盤」決定，跨冪次邊界時回傳 null 避免假突破。
 */
export function squareOfNineLevel(price: number, scalePower: number, degreeStep = 45): number {
  const scaled = price * 10 ** scalePower;
  return Math.floor(Math.sqrt(scaled) / (2 * degreeStep / 360));
}

export function squareOfNineScalePower(price: number): number {
  return 2 - Math.floor(Math.log10(price));
}

/** 收盤由下而上穿越一個 45° 九方圖價位 → +1；由上而下 → -1；未穿越 → 0。 */
export function squareOfNineCross(candles: Candle[], index: number, degreeStep = 45): -1 | 0 | 1 {
  if (index < 1) return 0;
  const power = squareOfNineScalePower(candles[index].close);
  if (power !== squareOfNineScalePower(candles[index - 1].close)) return 0;
  const previous = squareOfNineLevel(candles[index - 1].close, power, degreeStep);
  const current = squareOfNineLevel(candles[index].close, power, degreeStep);
  return current > previous ? 1 : current < previous ? -1 : 0;
}

/**
 * 江恩時間週期：距離最近擺動點的 K 線根數若剛好是完全平方數（9、16、25、36、49、64）
 * 即視為「時間到」，假設行情反轉：最近擺動點是低點（之前在漲）→ -1；是高點（之前在跌）→ +1。
 */
export const GANN_TIME_SQUARES = [9, 16, 25, 36, 49, 64];

export function gannTimeReversal(candles: Candle[], index: number, lookback: number): -1 | 0 | 1 {
  const { lowIndex, highIndex } = findSwingPivots(candles, index, lookback);
  const pivotIndex = Math.max(lowIndex, highIndex);
  if (!GANN_TIME_SQUARES.includes(index - pivotIndex)) return 0;
  return pivotIndex === lowIndex ? -1 : 1;
}
