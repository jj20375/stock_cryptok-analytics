/** @file USDT 永續 Mark Price 雷達契約；只分析公開行情，不連接帳戶或下單。 */
import type { BigFishSignal } from '../potentialRadar/bigFish';
import type { PerpSignalQuality } from './quality';

/**
 * 永續吃大魚改用 4 小時 K 線（UTC 00／04／08／12／16／20 收盤）；排程只讀取已收盤資料。
 * 由 15 分改為 4 小時是使用者的策略決策：以較少訊號換取較少假突破，但進場較晚、防守線較遠。
 */
export const PERP_BAR_MS = 4 * 60 * 60 * 1000;
export const PERP_DAY_MS = 24 * 60 * 60 * 1000;

export const BINANCE_PERP_RULES = {
  /** 版本放入事件 ID 與自動交易去重鍵；改週期後換新版本，舊 15 分事件不會與新 4 小時事件互相去重。 */
  version: 'perp-mark-4h-big-fish-v5',
  /** 24 小時名目成交額低於 500 萬 USDT 的永續合約不進入有限掃描池。 */
  minQuoteVolume: 5_000_000,
  /** 每根 K 線拆成四個互斥分片；每次 Worker 仍只讀 32 檔，避免超過免費方案外部請求上限。 */
  scanLimit: 128,
  shardCount: 4,
  shardSize: 32,
  /** 上漲榜保留八席，涵蓋已開始加速的強勢幣。 */
  topGainerSlots: 8,
  /** 跌幅榜保留四席，讓 BR 類深跌後首次翻綠不會只能等待輪替。 */
  topDeclinerSlots: 4,
  /** 高成交額保留八席，其餘十二席繼續固定輪替。 */
  topVolumeSlots: 8,
  /**
   * 只判斷最新一根已收盤 K 線。通知佇列只送最新批次、上一根一律過期捨棄，自動交易也只用最新根，
   * 回算更舊的 4 小時 K 線只會白耗 CPU，且十多小時前的進場價對即時頻道沒有意義。
   */
  recoveryBars: 1,
  /** EMA200 至少需要 201 根 4 小時 K 線（約 34 天）；上市未滿此天數的合約記為略過而非失敗。 */
  minimumBars: 201,
  requestedBars: 1000,
  /** 單一公開行情三秒即放棄；排程必須在 Cloudflare 的單次執行時間內完成並釋放租約。 */
  requestTimeoutMs: 3_000,
} as const;

export type PerpMarketSource = 'BINANCE' | 'GATE';

export interface PerpTicker {
  symbol: string;
  baseAsset: string;
  price: number;
  change24h: number;
  quoteVolume24h: number;
}

export interface PerpUniverse {
  source: PerpMarketSource;
  tickers: PerpTicker[];
}

export interface PerpAlert {
  id: string;
  symbol: string;
  barTime: number;
  detectedAt: number;
  message: string;
}

export interface PerpSignalEvent {
  source: PerpMarketSource;
  ticker: PerpTicker;
  signal: BigFishSignal;
  /** 分級只影響通知優先順序與標示，不會增加或刪除原始策略觸發。 */
  quality: PerpSignalQuality;
  /** 該觸發根的 Mark Price 收盤，不可用掃描當下的 24h ticker 價冒充歷史訊號價。 */
  markPrice: number;
}

export interface PerpRunSummary {
  version: string;
  source: PerpMarketSource | null;
  shardIndex: number;
  shardCount: number;
  startedAt: number;
  completedAt: number;
  eligible: number;
  selected: number;
  scanned: number;
  failed: number;
  /** 歷史未滿 201 根的新合約；屬於永久性條件，不計入失敗、不觸發整個分片重試。 */
  skipped?: number;
  signals: number;
  bestSignals: number;
  error: string | null;
  /**
   * 各分片已成功完成的 4 小時 K 線編號（floor(時間 / 4h)）。單一摘要列由四個分片輪流寫入，
   * 必須累積保存，否則每個分片只看得到上一個分片的摘要，會把同一根 4 小時 K 線重掃十六次。
   */
  completedShards?: Record<string, number>;
}
