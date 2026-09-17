/** @file 共用技術指標純函式；不抓資料、不寫入狀態，供策略與圖表一致使用。 */
import type { StockDataPoint } from '../../types';

export const calculateMA = (data: number[], period: number): number[] => {
  const ma: number[] = Array(data.length).fill(null);
  if (data.length < period) return ma;
  let sum = 0;
  for (let index = 0; index < period; index++) sum += data[index];
  ma[period - 1] = sum / period;
  for (let index = period; index < data.length; index++) {
    sum = sum - data[index - period] + data[index];
    ma[index] = sum / period;
  }
  return ma;
};

export const calculateKD = (data: StockDataPoint[], period = 9, kPeriod = 3, dPeriod = 3): { k: number[]; d: number[] } => {
  const k: number[] = Array(data.length).fill(50);
  const d: number[] = Array(data.length).fill(50);
  if (data.length < period) return { k, d };
  for (let index = period - 1; index < data.length; index++) {
    const slice = data.slice(index - period + 1, index + 1);
    const high = Math.max(...slice.map(item => item.high));
    const low = Math.min(...slice.map(item => item.low));
    const rsv = high === low ? 50 : ((data[index].close - low) / (high - low)) * 100;
    const previousK = index > 0 ? k[index - 1] : 50;
    const previousD = index > 0 ? d[index - 1] : 50;
    k[index] = ((kPeriod - 1) / kPeriod) * previousK + (1 / kPeriod) * rsv;
    d[index] = ((dPeriod - 1) / dPeriod) * previousD + (1 / dPeriod) * k[index];
  }
  return { k, d };
};

export const calculateEMA = (data: number[], period: number): number[] => {
  if (data.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const ema = [data[0]];
  for (let index = 1; index < data.length; index++) {
    ema.push(data[index] * multiplier + ema[index - 1] * (1 - multiplier));
  }
  return ema;
};

export const calculateMACD = (data: number[], fast = 12, slow = 26, signal = 9): { dif: number[]; macd: number[]; hist: number[] } => {
  const emaFast = calculateEMA(data, fast);
  const emaSlow = calculateEMA(data, slow);
  const dif = emaFast.map((value, index) => value - emaSlow[index]);
  const macd = calculateEMA(dif, signal);
  return { dif, macd, hist: dif.map((value, index) => value - macd[index]) };
};

export const calculateRSI = (data: number[], period = 14): number[] => {
  const rsi: number[] = Array(data.length).fill(null);
  if (data.length <= period) return rsi;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index++) {
    const difference = data[index] - data[index - 1];
    if (difference >= 0) gains += difference;
    else losses -= difference;
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period; index < data.length; index++) {
    if (index > period) {
      const difference = data[index] - data[index - 1];
      averageGain = (averageGain * (period - 1) + Math.max(difference, 0)) / period;
      averageLoss = (averageLoss * (period - 1) + Math.max(-difference, 0)) / period;
    }
    const relativeStrength = averageLoss === 0 ? 100 : averageGain / averageLoss;
    rsi[index] = 100 - 100 / (1 + relativeStrength);
  }
  return rsi;
};

export const calculateATR = (data: StockDataPoint[], period = 10): number[] => {
  const atr: number[] = Array(data.length).fill(0);
  if (data.length < period) return atr;
  const trueRanges = [data[0].high - data[0].low];
  for (let index = 1; index < data.length; index++) {
    const current = data[index];
    const previousClose = data[index - 1].close;
    trueRanges.push(Math.max(current.high - current.low, Math.abs(current.high - previousClose), Math.abs(current.low - previousClose)));
  }
  atr[period - 1] = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < data.length; index++) {
    atr[index] = (atr[index - 1] * (period - 1) + trueRanges[index]) / period;
  }
  return atr;
};

/** Supertrend 的 dir=-1 為多頭、1 為空頭；沿用既有策略判讀避免訊號方向改變。 */
export const calculateSupertrend = (data: StockDataPoint[], factor = 4, period = 10): { trend: number[]; dir: number[] } => {
  const atr = calculateATR(data, period);
  const trend: number[] = Array(data.length).fill(0);
  const dir: number[] = Array(data.length).fill(1);
  let upperBand = 0;
  let lowerBand = 0;
  for (let index = period; index < data.length; index++) {
    const current = data[index];
    const previous = data[index - 1];
    const midpoint = (current.high + current.low) / 2;
    const candidateUpper = midpoint + factor * atr[index];
    const candidateLower = midpoint - factor * atr[index];
    upperBand = candidateUpper < upperBand || previous.close > upperBand ? candidateUpper : upperBand;
    lowerBand = candidateLower > lowerBand || previous.close < lowerBand ? candidateLower : lowerBand;
    if (dir[index - 1] === 1 && current.close > upperBand) dir[index] = -1;
    else if (dir[index - 1] === -1 && current.close < lowerBand) dir[index] = 1;
    else dir[index] = dir[index - 1];
    trend[index] = dir[index] === -1 ? lowerBand : upperBand;
  }
  return { trend, dir };
};
