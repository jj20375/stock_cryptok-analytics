/** @file 台股 4 小時進場與日線確認雷達契約；沿用同一組可比較的策略欄位。 */
import type { UsStockCandle, UsStockObservation, UsStockRadarRun, UsStockSignal,
  UsStockSnapshot, UsStockTicker } from '../usStockRadar/types';

export const TW_STOCK_FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
export const TW_STOCK_DAY_MS = 24 * 60 * 60 * 1000;

/** 金額門檻單位為新台幣；分數只供同版本排序，不是勝率或報酬保證。 */
export const TW_STOCK_RADAR_RULES = {
  version: 'tw-4h-daily-v1-big-fish-2.0', minFourHourBars: 220, minDailyBars: 55,
  /** 排除低價與低成交額標的，降低漲跌停、價差及無量風險。 */
  minPriceTwd: 10, minAverageTurnoverTwd: 50_000_000,
  breakoutVolumeMultiple: 1.5,
  /** 台股單日漲停約 10%；接近 9.5% 時不再推送追價型通知。 */
  maxExtensionAtr: 3, maxDayChangePct: 9.5,
  selectionLimit: 10,
} as const;

export type TwStockCandle = UsStockCandle;
export type TwStockTicker = UsStockTicker;
export type TwStockSignal = UsStockSignal;
export type TwStockSnapshot = UsStockSnapshot;
export type TwStockObservation = UsStockObservation;
export type TwStockRadarRun = UsStockRadarRun;

export const isTwStockCandidate = (signal: TwStockSignal) =>
  signal.phase !== 'EXCLUDED' && signal.phase !== 'EXTENDED' && signal.dailyTrendUp &&
  (signal.bigFish.entry || ['WATCH', 'BREAKOUT', 'RETEST'].includes(signal.phase));
