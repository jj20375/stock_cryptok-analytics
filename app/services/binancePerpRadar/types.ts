/** @file USDT 永續 Mark Price 雷達契約；只分析公開行情，不連接帳戶或下單。 */
import type { BigFishSignal } from '../potentialRadar/bigFish';
import type { PerpSignalQuality } from './quality';

/** 永續 15 分 K 線以 UTC 邊界對齊；排程只讀取已收盤資料。 */
export const PERP_QUARTER_MS = 15 * 60 * 1000;
export const PERP_DAY_MS = 24 * 60 * 60 * 1000;

export const BINANCE_PERP_RULES = {
  /** 版本放入事件 ID；策略或市場篩選變更後，同一根可依新版重新判斷一次。 */
  version: 'gate-perp-mark-15m-big-fish-v3',
  /** 24 小時名目成交額低於 500 萬 USDT 的永續合約不進入有限掃描池。 */
  minQuoteVolume: 5_000_000,
  /** 每輪仍只掃 32 檔，避免超過 Cloudflare 外部請求預算。 */
  scanLimit: 32,
  /** 上漲榜保留八席，涵蓋已開始加速的強勢幣。 */
  topGainerSlots: 8,
  /** 跌幅榜保留四席，讓 BR 類深跌後首次翻綠不會只能等待輪替。 */
  topDeclinerSlots: 4,
  /** 高成交額保留八席，其餘十二席繼續固定輪替。 */
  topVolumeSlots: 8,
  /** 輪替標的回算最近一小時，補回上一輪未被選中的單根交叉，但歷史訊號會標示延遲。 */
  recoveryBars: 4,
  /** EMA200 至少需要 201 根；多抓至 1000 根降低指標暖機差異，但仍可能與圖表供應商略有差距。 */
  minimumBars: 201,
  requestedBars: 1000,
  /** 單一公開行情三秒即放棄；排程必須在 Cloudflare 的單次執行時間內完成並釋放租約。 */
  requestTimeoutMs: 3_000,
} as const;

export interface PerpTicker {
  symbol: string;
  baseAsset: string;
  price: number;
  change24h: number;
  quoteVolume24h: number;
}

export interface PerpAlert {
  id: string;
  symbol: string;
  barTime: number;
  detectedAt: number;
  message: string;
}

export interface PerpSignalEvent {
  ticker: PerpTicker;
  signal: BigFishSignal;
  /** 分級只影響通知優先順序與標示，不會增加或刪除原始策略觸發。 */
  quality: PerpSignalQuality;
  /** 該觸發根的 Mark Price 收盤，不可用掃描當下的 24h ticker 價冒充歷史訊號價。 */
  markPrice: number;
}

export interface PerpRunSummary {
  version: string;
  startedAt: number;
  completedAt: number;
  eligible: number;
  selected: number;
  scanned: number;
  failed: number;
  signals: number;
  bestSignals: number;
  error: string | null;
}
