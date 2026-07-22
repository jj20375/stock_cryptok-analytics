/**
 * 【詳細繁體中文註解】：全序列技術指標惰性快取
 *
 * 目的:回測逐根重放時,若每根 K 線都重算一次指標會變成 O(n²);
 * 本快取以「(指標名稱, 參數)」為 key 惰性記憶化,每個指標整段序列只計算一次 O(n),
 * 之後策略在任意 index 取值都是 O(1)。
 *
 * 指標實作直接 import stockService.ts 既有的純函式(calculateRSI/MA/EMA/MACD/ATR/Supertrend/KD),
 * 不複製、不修改 — stockService.ts 已超過專案 1000 行上限,依開發規範只能 import 不能再加內容。
 * 未來 stockService 拆檔時,只需改這裡的 import 路徑。
 *
 * 注意:這些指標函式皆為「逐根遞迴、無前視」的實作,
 * 序列中位置 i 的值只依賴 0..i 的資料,因此整段預先計算不會造成前視偏差。
 */

import {
  calculateMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateSupertrend,
  calculateKD,
} from '../stockService';
import type { StockDataPoint } from '../../types';
import type { Candle } from './types';

/** MACD 全序列輸出(dif=快線、macd=訊號線、hist=柱狀圖) */
export interface MacdSeries {
  dif: number[];
  macd: number[];
  hist: number[];
}

/** Supertrend 全序列輸出(trend=軌道值、dir=方向,dir=-1 為多頭、1 為空頭,沿用 stockService 慣例) */
export interface SupertrendSeries {
  trend: number[];
  dir: number[];
}

/** KD 全序列輸出 */
export interface KdSeries {
  k: number[];
  d: number[];
}

/**
 * 【詳細繁體中文註解】：將 Candle 轉為 stockService 指標函式所需的最小 StockDataPoint。
 * ATR/Supertrend/KD 只使用 high/low/close 欄位,其餘欄位以佔位值補齊。
 */
const toStockDataPoints = (candles: Candle[]): StockDataPoint[] =>
  candles.map((c) => ({
    date: '',
    timestamp: c.openTime,
    price: c.close,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    currency: '',
    isMock: false,
  }));

export class IndicatorCache {
  private readonly candles: Candle[];
  /** 收盤價序列(多數指標的輸入),建構時一次抽出 */
  private readonly closes: number[];
  /** StockDataPoint 轉換結果(ATR/Supertrend/KD 需要 OHLC),惰性建立 */
  private dataPoints: StockDataPoint[] | null = null;
  /** 各指標的記憶化快取,key 格式如 'rsi:14'、'supertrend:3:10' */
  private readonly cache = new Map<string, unknown>();

  constructor(candles: Candle[]) {
    this.candles = candles;
    this.closes = candles.map((c) => c.close);
  }

  /** 惰性取得 StockDataPoint 轉換(只轉一次) */
  private getDataPoints(): StockDataPoint[] {
    if (!this.dataPoints) {
      this.dataPoints = toStockDataPoints(this.candles);
    }
    return this.dataPoints;
  }

  /** 泛用記憶化:同 key 只計算一次 */
  private memo<T>(key: string, compute: () => T): T {
    if (!this.cache.has(key)) {
      this.cache.set(key, compute());
    }
    return this.cache.get(key) as T;
  }

  /** 簡單移動平均全序列(前 period-1 根為 null) */
  ma(period: number): number[] {
    return this.memo(`ma:${period}`, () => calculateMA(this.closes, period));
  }

  /** 指數移動平均全序列 */
  ema(period: number): number[] {
    return this.memo(`ema:${period}`, () => calculateEMA(this.closes, period));
  }

  /** RSI 全序列(前 period 根為 null) */
  rsi(period: number = 14): number[] {
    return this.memo(`rsi:${period}`, () => calculateRSI(this.closes, period));
  }

  /** MACD 全序列 */
  macd(fast: number = 12, slow: number = 26, signal: number = 9): MacdSeries {
    return this.memo(`macd:${fast}:${slow}:${signal}`, () =>
      calculateMACD(this.closes, fast, slow, signal)
    );
  }

  /** ATR 全序列 */
  atr(period: number = 10): number[] {
    return this.memo(`atr:${period}`, () => calculateATR(this.getDataPoints(), period));
  }

  /** Supertrend 全序列(factor 為 ATR 倍數) */
  supertrend(factor: number = 4.0, period: number = 10): SupertrendSeries {
    return this.memo(`supertrend:${factor}:${period}`, () =>
      calculateSupertrend(this.getDataPoints(), factor, period)
    );
  }

  /** KD 隨機指標全序列 */
  kd(period: number = 9, kPeriod: number = 3, dPeriod: number = 3): KdSeries {
    return this.memo(`kd:${period}:${kPeriod}:${dPeriod}`, () =>
      calculateKD(this.getDataPoints(), period, kPeriod, dPeriod)
    );
  }
}
