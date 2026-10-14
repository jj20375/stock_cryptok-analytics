/**
 * @file 吃大魚 2.0 的純條件計算；輸入已驗證的收盤序列，不模擬持倉、不下單。
 * 股票雷達自行取得已收盤 4 小時 K 線並呼叫本模組，不需要 TradingView API、警報或 Webhook。
 * 函式本身不綁定市場或週期；舊虛擬幣分析可共用公式，但不會因此啟用虛擬幣排程。
 */
import { calculateEMA, calculateMACD } from '../indicators/technical';
import type { Candle } from './types';

/** 沿用使用者 Pine 參數；僅觀察做多訊號，未經樣本外驗證。 */
export const BIG_FISH_RULES = {
  /** 版本只描述條件公式；K 線週期由呼叫端以 timeframe 欄位另行標示。 */
  version: 'big-fish-2.0-v1',
  /** ATR 以十根已收盤 K 線的 True Range 作 Wilder 平滑，週期由股票呼叫端固定為 4 小時。 */
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
  /**
   * 計算所用的 K 線週期；潛力幣雷達以此判斷快取是否為新版 4 小時結果。
   * 舊快照沒有此欄，一律視為 15 分線舊結果而重新計算，不可沿用。
   */
  timeframe?: '15m' | '4h';
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
  /** ATR 單位與股價相同；首十根使用平均種子，之後以 1/10 權重平滑新波動。 */
  let atr = 0;
  let seed = 0;
  /** 遞迴上下軌沿用 Pine 對不存在前值的零值處理；方向只在 ATR 暖機完成後判讀。 */
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

/** 至少 201 根才判斷 EMA200 與前根交叉；呼叫端另負責 K 線完整性及新鮮度驗證。 */
export function analyzeBigFish(candles: Candle[]): BigFishSignal | null {
  if (candles.length < BIG_FISH_RULES.emaPeriod + 1) return null;
  const closes = candles.map(c => c.close);
  /** EMA200 以首根收盤作種子，歷史起點不同仍可能造成與 TradingView 的細微差異。 */
  const ema200 = calculateEMA(closes, BIG_FISH_RULES.emaPeriod).at(-1)!;
  /** MACD 使用 EMA12−EMA26，訊號線為差值的 EMA9，不能混用 SMA 訊號線。 */
  const { dif, macd } = calculateMACD(closes, BIG_FISH_RULES.emaFast, BIG_FISH_RULES.emaSlow, BIG_FISH_RULES.signalPeriod);
  const { line, direction } = bigFishSupertrend(candles);
  const index = candles.length - 1;
  return analyzeBigFishAt(candles, index, { ema200, dif: dif[index], previousDif: dif[index - 1],
    signal: macd[index], previousSignal: macd[index - 1], line: line[index], direction: direction[index], previousDirection: direction[index - 1] });
}

/** 雷達與逐根回測共用條件；傳入同根快取值，避免逐根重算整段指標造成平方級成本。 */
export function analyzeBigFishAt(candles: Candle[], index: number, values: {
  ema200: number; dif: number; previousDif: number; signal: number; previousSignal: number;
  line: number; direction: -1 | 1; previousDirection: -1 | 1;
}): BigFishSignal | null {
  if (index < BIG_FISH_RULES.emaPeriod || !candles[index] || !Object.values(values).every(Number.isFinite)) return null;
  /** ta.crossover 允許前根相等，但當根必須嚴格大於；持續在線上不算再次進場。 */
  const earlyLong = values.dif > values.signal && values.previousDif <= values.previousSignal &&
    candles[index].close > values.ema200 * BIG_FISH_RULES.emaTolerance;
  /** 翻綠是獨立的 OR 分支，不附加 EMA200、MACD 或較大週期限制。 */
  const trendLong = values.direction === -1 && values.previousDirection === 1;
  return {
    version: BIG_FISH_RULES.version, barTime: candles[index].openTime,
    earlyLong, trendLong, entry: earlyLong || trendLong,
    exitLong: values.direction === 1,
    flippedRed: values.direction === 1 && values.previousDirection === -1,
    direction: values.direction, supertrend: values.line, ema200: values.ema200,
    macdLine: values.dif, signalLine: values.signal,
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
