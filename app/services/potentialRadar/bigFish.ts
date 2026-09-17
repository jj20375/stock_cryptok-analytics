/** @file 吃大魚 2.0 的純 15 分線條件計算；輸入已驗證的收盤序列，不模擬持倉、不下單。 */
import { calculateEMA, calculateMACD } from '../stockService';
import type { Candle } from '../strategy/types';

/** 沿用使用者 Pine 參數；僅觀察做多訊號，未經樣本外驗證。 */
export const BIG_FISH_RULES = {
  version: 'big-fish-2.0-15m-v1',
  atrPeriod: 10,
  /** 四倍 Wilder ATR 容忍較大波動，也意味防守線可能較遠。 */
  factor: 4,
  emaFast: 12,
  emaSlow: 26,
  signalPeriod: 9,
  emaPeriod: 200,
  /** 收盤可低於 EMA200 最多約 2%；此值不是停損百分比。 */
  emaTolerance: 0.98,
} as const;

export interface BigFishSignal {
  version: string;
  /** UTC 毫秒，對應唯一觸發根的開盤時間；下一根不沿用金叉／翻綠事件。 */
  barTime: number;
  earlyLong: boolean;
  trendLong: boolean;
  entry: boolean;
  /** 原碼在持有多單且 dir=1 時平倉；此欄僅表示條件，不代表使用者真的持倉。 */
  exitLong: boolean;
  flippedRed: boolean;
  direction: -1 | 1;
  /** 以下指標及線位皆使用呼叫端同一行情來源與計價方式。 */
  supertrend: number;
  ema200: number;
  macdLine: number;
  signalLine: number;
}

/**
 * 依 Pine 的 ATR 首十根 SMA 暖機、後續 Wilder RMA，以及上下軌遞迴計算。
 * 既有共用 Supertrend 從第十一根才初始化，因此本策略獨立處理第十根，避免改動其他交易策略。
 * 暖機前線值為 NaN，不用 0 偽裝有效防守價；方向 -1 為綠、1 為紅。
 */
export function bigFishSupertrend(candles: Candle[]) {
  const { atrPeriod, factor } = BIG_FISH_RULES;
  const line = Array<number>(candles.length).fill(NaN);
  const direction = Array<-1 | 1>(candles.length).fill(1);
  let atr = 0;
  let seed = 0;
  let upperBand = 0;
  let lowerBand = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const previousClose = i ? candles[i - 1].close : c.close;
    const trueRange = i ? Math.max(c.high - c.low, Math.abs(c.high - previousClose), Math.abs(c.low - previousClose)) : c.high - c.low;
    if (i < atrPeriod) seed += trueRange;
    if (i < atrPeriod - 1) continue;
    atr = i === atrPeriod - 1 ? seed / atrPeriod : (atr * (atrPeriod - 1) + trueRange) / atrPeriod;
    const midpoint = (c.high + c.low) / 2;
    const basicUpper = midpoint + factor * atr;
    const basicLower = midpoint - factor * atr;
    const previousUpper = upperBand;
    upperBand = basicUpper < upperBand || previousClose > upperBand ? basicUpper : upperBand;
    lowerBand = basicLower > lowerBand || previousClose < lowerBand ? basicLower : lowerBand;
    if (i > atrPeriod - 1) {
      direction[i] = line[i - 1] === previousUpper
        ? (c.close > upperBand ? -1 : 1)
        : (c.close < lowerBand ? 1 : -1);
    }
    line[i] = direction[i] === -1 ? lowerBand : upperBand;
  }
  return { line, direction };
}

/** 至少 201 根才判斷 EMA200 與前根交叉；呼叫端另負責完整 15 分線及新鮮度驗證。 */
export function analyzeBigFish(candles: Candle[]): BigFishSignal | null {
  if (candles.length < BIG_FISH_RULES.emaPeriod + 1) return null;
  const closes = candles.map(c => c.close);
  const ema200 = calculateEMA(closes, BIG_FISH_RULES.emaPeriod).at(-1)!;
  const { dif, macd } = calculateMACD(closes, BIG_FISH_RULES.emaFast, BIG_FISH_RULES.emaSlow, BIG_FISH_RULES.signalPeriod);
  const { line, direction } = bigFishSupertrend(candles);
  const index = candles.length - 1;
  /** ta.crossover 允許前根相等，但當根必須嚴格大於；持續在線上不算再次進場。 */
  const earlyLong = dif[index] > macd[index] && dif[index - 1] <= macd[index - 1] &&
    closes[index] > ema200 * BIG_FISH_RULES.emaTolerance;
  /** 翻綠是獨立的 OR 分支，不附加 EMA200、MACD 或較大週期限制。 */
  const trendLong = direction[index] === -1 && direction[index - 1] === 1;
  return {
    version: BIG_FISH_RULES.version, barTime: candles[index].openTime,
    earlyLong, trendLong, entry: earlyLong || trendLong,
    exitLong: direction[index] === 1,
    flippedRed: direction[index] === 1 && direction[index - 1] === -1,
    direction: direction[index], supertrend: line[index], ema200,
    macdLine: dif[index], signalLine: macd[index],
  };
}

/** 同時命中保留兩個原因；等待與趨勢延續不冒充新進場。 */
export function bigFishLabel(signal: BigFishSignal) {
  if (signal.earlyLong && signal.trendLong) return '吃大魚進場 · 金叉＋翻綠';
  if (signal.earlyLong) return '吃大魚進場 · MACD 提早進場';
  if (signal.trendLong) return '吃大魚進場 · Supertrend 確認';
  if (signal.flippedRed) return 'Supertrend 翻紅 · 多單出場條件';
  return signal.direction === -1 ? '綠色趨勢延續 · 無新進場' : '紅色趨勢 · 等待進場';
}
