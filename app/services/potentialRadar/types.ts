/** @file 潛力幣雷達共用資料契約；現貨價格與成交額鎖定單一交易所，衍生品只作風險確認，時間為 UTC 毫秒。 */
import type { Candle } from '../strategy/types';
import type { BigFishSignal } from './bigFish';

/** 量價分析只看已收盤 15 分線；所有量價週期都從同一來源聚合，避免跨所量能混用。 */
export const QUARTER_MS = 15 * 60 * 1000;
/** 吃大魚改看 4 小時線：由 bigFishJob 另抓同一現貨來源的 4 小時 K 線計算，與 15 分量價分析分開。 */
export const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** 以下門檻是未經樣本外驗證的現貨做多觀察假設，不代表上漲機率。 */
export const RADAR_RULES = {
  /** 吃大魚改為 4 小時線後升版，讓舊 15 分吃大魚快照與通知事件 ID 不會被沿用。 */
  version: '15m-v5-big-fish-4h',
  /** 吃大魚通知只在 4 小時收盤後一小時內發送，避免輪替晚算的標的以過時進場價推播。 */
  bigFishNoticeWindowMs: 60 * 60 * 1000,
  /** 排除單一交易所近 24 小時成交額低於 500 萬 USDT 的薄量標的。 */
  minTurnover: 5_000_000,
  /** 百分比單位；價差超過 0.3% 時不能入榜。 */
  maxSpreadPct: 0.3,
  /** 中間價上下 1% 內、最多 50 檔掛單，每側至少 1 萬 USDT；不是可成交保證。 */
  minDepth: 10_000,
  volumeBars: 20,
  breakoutBars: 16,
  volumeMultiple: 2,
  /** 距突破位超過 1.5 個 15 分 ATR，或 24 小時漲超過 30%，列為過熱。 */
  maxExtensionAtr: 1.5,
  maxChange24h: 30,
  /** 最少 352 根，確保任何 UTC 對齊位置都有至少 21 根完整 4 小時線。 */
  minBars: 352,
};
export type RadarPhase = 'WATCH' | 'BREAKOUT' | 'RETEST' | 'EXTENDED' | 'WAIT' | 'EXCLUDED';
export const PHASE_LABELS: Record<RadarPhase, string> = {
  WATCH: '提前關注', BREAKOUT: '剛啟動', RETEST: '回踩續強',
  EXTENDED: '漲幅過熱', WAIT: '等待條件', EXCLUDED: '流動性不合格',
};
export const isCandidate = (phase: RadarPhase) => ['WATCH', 'BREAKOUT', 'RETEST'].includes(phase);
/** 吃大魚可獨立入選；原始觸發仍保留，但過熱與流動性不合格不得繞過風控。 */
export const isRadarCandidate = (signal: RadarSignal) =>
  signal.phase !== 'EXCLUDED' && signal.phase !== 'EXTENDED' &&
  (isCandidate(signal.phase) || signal.bigFish?.entry === true);
/** 趨勢共振只升級既有候選的優先級；不足日線歷史不能被誤判為已確認。 */
export const isTrendConfirmedCandidate = (signal: RadarSignal) =>
  isRadarCandidate(signal) && signal.trendConfirmation?.confirmed === true;
export interface RadarCandle extends Candle { turnover: number }
export interface MarketTicker {
  symbol: string;
  price: number;
  turnover24h: number;
  change24h: number;
  spreadPct: number;
}
export interface RadarDepth { bid: number; ask: number; spreadPct: number }
/** 4h MA20 回踩與已收盤日線 MA7 共振；null 代表可用 15 分歷史不足，不能誤作趨勢反向。 */
export interface TrendConfirmation {
  version: '4h-ma20-daily-ma7-v1';
  fourHourMa20: number | null;
  fourHourMa20Rising: boolean | null;
  fourHourPullback: 'CONFIRMED' | 'FORMING' | 'NONE' | 'UNAVAILABLE';
  dailyMa7: number | null;
  dailyTrend: boolean | null;
  /** 同時滿足 4h 回踩轉強與日線趨勢向上才是趨勢共振；它優先排序，不取代原始 15 分觸發。 */
  confirmed: boolean;
}
export type DerivativeStatus = 'HEALTHY_TREND' | 'SHORT_SQUEEZE' | 'CROWDED_LONG' |
  'NEW_SHORTS' | 'DELEVERAGING' | 'NEUTRAL' | 'UNAVAILABLE';
/** Gate USDT 永續公開統計只用來解讀現貨訊號品質，不代表持倉、成交或下單方向。 */
export interface DerivativeSignal {
  version: 'gate-perp-crowding-v1';
  source: 'GATE_USDT_PERP';
  status: DerivativeStatus;
  checkedAt: number;
  openInterestUsd: number | null;
  /** 百分比單位；以約一小時前的 Gate 永續未平倉量為基準。 */
  openInterestChange1hPct: number | null;
  /** 小數比率，例如 0.0001 代表 0.01%；分位數以近 31 天可得紀錄計算。 */
  fundingRate: number | null;
  fundingPercentile: number | null;
  takerLongShortRatio: number | null;
  accountLongShortRatio: number | null;
  topLongShortRatio: number | null;
  longLiquidationUsd1h: number | null;
  shortLiquidationUsd1h: number | null;
  reasons: string[];
  risks: string[];
}
export interface RadarSignal {
  /** 舊快照沒有此欄時顯示未計算，不能將舊資料推定為未觸發。 */
  bigFish?: BigFishSignal | null;
  /** 舊快照沒有此欄時顯示尚待新版計算，不能推定未通過中週期確認。 */
  trendConfirmation?: TrendConfirmation | null;
  /** undefined 是舊快照；null 代表本輪未列入有限的衍生品精算名額。 */
  derivatives?: DerivativeSignal | null;
  /** 舊紀錄未填時為 Bybit；每輪 BTC、成交額與掛單皆取同一現貨來源。 */
  source?: 'BYBIT_SPOT' | 'GATE_SPOT';
  version: string;
  phase: RadarPhase;
  score: number;
  parts: { volume: number; relative: number; structure: number; trend: number; compression: number };
  barTime: number;
  price: number;
  change15m: number;
  change1h: number;
  change24h: number;
  relative1h: number;
  relative4h: number;
  relative24h: number;
  btcChange24h: number;
  volumeRatio: number;
  breakout: number;
  distancePct: number;
  invalidation: number;
  hourlyUp: boolean;
  fourHourlyUp: boolean;
  compressed: boolean;
  turnover24h: number;
  spreadPct: number;
  depth: RadarDepth;
  reasons: string[];
  risks: string[];
}
export interface RadarSnapshot {
  symbol: string;
  checkedAt: number;
  signal: RadarSignal | null;
  error: string | null;
}
export interface RadarObservation {
  id: string;
  symbol: string;
  /** 當根收盤是研究參考價；detectedAt 是實際發現時間，兩者不能冒充成交時間。 */
  enteredAt: number;
  detectedAt: number;
  entryPrice: number;
  signal: RadarSignal;
  checkedThrough: number;
  returns: { h24: number | null; h72: number | null; d7: number | null };
  maxRise: number;
  maxFall: number;
  complete: boolean;
  error: string | null;
}
export interface RadarRun {
  /** 舊版摘要沒有版本；升級後必須重算，不能沿用同根的舊版成功狀態。 */
  version?: string;
  source?: 'BYBIT_SPOT' | 'GATE_SPOT';
  startedAt: number;
  completedAt: number;
  eligible: number;
  selected: number;
  scanned: number;
  failed: number;
  error: string | null;
}
