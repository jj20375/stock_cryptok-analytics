/** @file 美股 4 小時進場與日線確認雷達的資料契約；只描述公開行情觀察，不代表交易或下單。 */
import type { Candle } from '../strategy/types';
import type { BigFishSignal } from '../strategy/bigFish';

export const US_STOCK_FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
export const US_STOCK_DAY_MS = 24 * 60 * 60 * 1000;

/** 門檻是待樣本外驗證的美股多頭觀察假設；分數只供同版本排序，不是勝率。 */
export const US_STOCK_RADAR_RULES = {
  version: 'us-4h-daily-v3-session-big-fish-2.0',
  /** 合成 4 小時歷史至少 220 根，確保 EMA200 已暖機並可判斷金叉。 */
  minFourHourBars: 220,
  /** 日線至少 55 根，才能計算 EMA20／EMA50 與一個月相對強弱。 */
  minDailyBars: 55,
  /** 股價低於 2 美元容易受跳空及價差影響，暫不列為可通知候選。 */
  minPriceUsd: 2,
  /** 前 20 個交易日平均成交額至少 2,000 萬美元，降低薄量股滑價風險。 */
  minAverageDollarVolumeUsd: 20_000_000,
  /** 4 小時突破需達前 20 根平均成交額的 1.5 倍。 */
  breakoutVolumeMultiple: 1.5,
  /** 距 EMA20 超過 3 個 ATR 或當日漲逾 15% 時視為過熱，不推送進場通知。 */
  maxExtensionAtr: 3,
  maxDayChangePct: 15,
  /** 每輪十檔動態標的，另保留一檔歷史績效輪替補算。 */
  selectionLimit: 10,
} as const;

export type UsStockPhase = 'WATCH' | 'BREAKOUT' | 'RETEST' | 'EXTENDED' | 'WAIT' | 'EXCLUDED';
export const US_STOCK_PHASE_LABELS: Record<UsStockPhase, string> = {
  WATCH: '提前關注',
  BREAKOUT: '放量突破',
  RETEST: '回踩續強',
  EXTENDED: '漲幅過熱',
  WAIT: '等待條件',
  EXCLUDED: '流動性不合格',
};

export interface UsStockTicker {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  averageVolume3m: number;
}

export interface UsStockSignal {
  version: string;
  phase: UsStockPhase;
  score: number;
  parts: { trend: number; relative: number; volume: number; structure: number; momentum: number };
  /** 經典吃大魚 2.0 的 OR 條件套用在 4 小時線，並由已收盤日線確認方向。 */
  bigFish: BigFishSignal;
  barTime: number;
  closedAt: number;
  price: number;
  change4h: number;
  change1d: number;
  changeDay: number;
  change20d: number;
  spyChange20d: number;
  relative20d: number;
  volumeRatio: number;
  averageDollarVolume20d: number;
  breakout: number;
  ema20: number;
  ema50: number;
  ema200: number;
  dailyEma20: number;
  dailyEma50: number;
  rsi14: number;
  atr14: number;
  distanceEma20Atr: number;
  invalidation: number;
  dailyTrendUp: boolean;
  marketTrendUp: boolean;
  reasons: string[];
  risks: string[];
}

export interface UsStockSnapshot {
  symbol: string;
  name: string;
  checkedAt: number;
  signal: UsStockSignal | null;
  error: string | null;
}

export interface UsStockObservation {
  id: string;
  symbol: string;
  name: string;
  /** enteredAt 是訊號 K 線開盤時間，entryPrice 是該根收盤；兩者都不是實際成交紀錄。 */
  enteredAt: number;
  detectedAt: number;
  entryPrice: number;
  signal: UsStockSignal;
  checkedThrough: number;
  returns: { h4: number | null; d1: number | null; d5: number | null };
  maxRise: number;
  maxFall: number;
  complete: boolean;
  error: string | null;
}

export interface UsStockRadarRun {
  version: string;
  barTime?: number;
  startedAt: number;
  completedAt: number;
  eligible: number;
  selected: number;
  scanned: number;
  candidates: number;
  bigFishSignals: number;
  failed: number;
  skipped: boolean;
  error: string | null;
}

/** 流動性與過熱是硬風控；經典吃大魚可獨立入選，不要求額外趨勢分數。 */
export const isUsStockCandidate = (signal: UsStockSignal) =>
  signal.phase !== 'EXCLUDED' && signal.phase !== 'EXTENDED' &&
  signal.dailyTrendUp &&
  (signal.bigFish.entry || ['WATCH', 'BREAKOUT', 'RETEST'].includes(signal.phase));

export type UsStockCandle = Candle & { closeTime?: number };
