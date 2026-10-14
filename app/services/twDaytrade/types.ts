/** @file 台股 15 分線只做多研究契約；歷史勝率不代表未來成交機率。 */
import type { Candle } from '../strategy/types';

/** 門檻為固定研究起點，不做參數最佳化；金額為新台幣，時間為台北交易時間。 */
export const DAYTRADE_RULES = {
  intervalMs: 15 * 60_000, poolLimit: 36, topLimit: 10,
  /** 保留低價風控 10 元；依使用者預算只找報價不超過 300 元的股票，包含剛好 300 元。 */
  minPrice: 10, maxPrice: 300, minAverageTurnover: 50_000_000,
  /** 至少五個完整交易日估流動性；總樣本十筆、近期驗證五筆仍只能視為初步研究。 */
  liquidityDays: 5, minTrades: 10, minValidationTrades: 5, validationFraction: 0.3,
  /** 13:00 後不開新倉，13:15 開盤模擬強制平倉，避免依賴收盤集合競價成交。 */
  lastEntryMinute: 13 * 60, flattenMinute: 13 * 60 + 15,
  /** Yahoo 可能延遲；超過二十分鐘、不同交易日或缺根均不得列為當前候選。 */
  maxAgeMs: 20 * 60_000,
} as const;

/** 每股模擬成本：雙邊未折扣手續費 0.1425%、各邊滑價 5 bps；股票當沖賣出稅 0.15%。 */
export const DAYTRADE_COST = { feeRate: 0.001425, slippageBps: 5, sellTaxRate: 0.0015 };
export const isDaytradePriceEligible = (price: number) => Number.isFinite(price) && price >= DAYTRADE_RULES.minPrice && price <= DAYTRADE_RULES.maxPrice;
export type DaytradeCandle = Candle & { closeTime: number };
export interface DaytradeTrade { entryTime: number; exitTime: number; entryPrice: number; exitPrice: number; netReturnPct: number; exitReason: string }
export interface DaytradeMetrics { trades: number; wins: number; winRatePct: number | null; averageNetReturnPct: number | null; profitFactor: number | null; winRateLowerPct: number | null }
export interface DaytradeStrategyResult {
  id: string; name: string; adapted: boolean;
  historical: DaytradeMetrics; validation: DaytradeMetrics; validationStart: number;
  signal: { reason: string; referencePrice: number; stopPrice: number; targetPrice: number | null } | null;
  qualified: boolean; exclusions: string[];
}
export interface DaytradeStockResult {
  symbol: string; name: string; price: number; bars: number; startTime: number; closedAt: number;
  averageTurnover: number; fresh: boolean; riskWarning: string | null;
  strategies: DaytradeStrategyResult[];
}
export interface DaytradeRankRow { stock: DaytradeStockResult; strategy: DaytradeStrategyResult; matchedStrategies: string[] }
export interface DaytradeScan {
  scannedAt: number; completedAt: number; selected: number; scanned: number; priceExcluded: number; universeSource: string;
  candidates: DaytradeRankRow[]; research: DaytradeRankRow[]; stocks: DaytradeStockResult[];
  errors: Array<{ symbol: string; message: string }>;
}
