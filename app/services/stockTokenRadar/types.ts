/** @file Bitget 美股現貨代幣雷達契約；價格皆為 USDT，訊號只供人工評估。 */
import type { Candle } from '../strategy/types';

export const HOUR_MS = 3_600_000;
/** 4h 多頭搭配 1h 突破／回踩做多；門檻是未經樣本外驗證的研究假設。 */
export const STOCK_TOKEN_RULES = {
  version: 'bitget-rtoken-1h-4h-v1',
  /** EMA50 至少暖機 80 根；突破量比較前 20 根，不包含訊號根。 */
  minBars: 80,
  minPlatformTurnover: 100_000,
  /** 買賣價差不超過 0.3%；報價產生時間最多落後兩分鐘。 */
  maxSpreadPct: 0.3,
  maxQuoteAgeMs: 120_000,
  /** 1h 收盤後只接受二十分鐘；舊訊號與週末行情不得補成即時進場。 */
  validityMs: 20 * 60_000,
  /** 每輪最多二十檔、兩個週期，保留 Worker 外部請求預算給通知再驗價。 */
  scanLimit: 20,
  breakoutVolumeRatio: 1.5,
  retestVolumeRatio: 1,
  rsiMin: 50,
  rsiMax: 72,
  /** 止損至少距訊號價 1.5 ATR14，且低於近五根低點 0.25 ATR；拒絕低於 0.5% 或大於 5% 的風險。 */
  stopAtr: 1.5,
  minRiskPct: 0.5,
  maxRiskPct: 5,
  /** 最多追高 0.25 ATR／0.5%；目標 2R，估算雙邊各 0.1% 費用後至少 1.5R。 */
  targetR: 2,
  minNetRewardRisk: 1.5,
  estimatedFeeRate: 0.001,
} as const;

export interface StockTokenInstrument { symbol: string; baseCoin: string; name: string }
export interface StockTokenQuote {
  symbol: string; bid: number; ask: number; bidSize: number; askSize: number;
  /** 一般成交額與 rToken 平台成交額分開，只有後者用於流動性篩選；單位 USDT／24h。 */
  turnover: number; platformTurnover: number; spreadPct: number; timestamp: number;
}
export interface StockTokenPlan {
  kind: 'BREAKOUT' | 'RETEST'; closedAt: number; expiresAt: number; referencePrice: number;
  entryLow: number; entryHigh: number; stopPrice: number; targetPrice: number;
  riskPct: number; netRewardRisk: number;
}
export type StockTokenStatus = 'ENTRY' | 'WAIT' | 'EXCLUDED' | 'INSUFFICIENT' | 'STALE' | 'ERROR';
export interface StockTokenCandidate extends StockTokenInstrument {
  status: StockTokenStatus; reasons: string[]; plan: StockTokenPlan | null;
  quote: StockTokenQuote | null; volumeRatio: number | null; rsi14: number | null;
}
export interface StockTokenReport {
  version: string; startedAt: number; completedAt: number; total: number; eligible: number;
  exclusions: Record<string, number>;
  selected: number; failed: number; candidates: StockTokenCandidate[]; error: string | null;
  notificationError?: string | null;
}
export type StockTokenCandles = { hourly: Candle[]; fourHourly: Candle[] };
export interface StockTokenEnv {
  DB: Parameters<typeof import('drizzle-orm/d1').drizzle>[0];
  /** 此開關只允許行情、D1 與訊號通知副作用，不授權任何下單。 */
  STOCK_TOKEN_RADAR_ENABLED?: string;
  SLACK_API_TOKEN?: string;
  /** 使用既有「美股即時進場價格」專用頻道，禁止轉送一般或虛擬幣頻道。 */
  US_STOCK_SLACK_CHANNEL_ID?: string;
}
