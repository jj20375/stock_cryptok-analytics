/**
 * @file 即時戰略 Dashboard 的資料契約；只彙整既有雷達的已收盤觀察結果，不含下單、推播或任何交易指令。
 * 所有時間欄位皆為 UTC 毫秒；畫面再轉成 Asia/Taipei 顯示。
 */
import type { RadarSnapshot } from '../potentialRadar/types';
import type { UsStockSnapshot } from '../usStockRadar/types';

export type DashboardMarket = 'TW' | 'US' | 'CRYPTO';
export const DASHBOARD_MARKETS: DashboardMarket[] = ['TW', 'US', 'CRYPTO'];
export const isDashboardMarket = (value: unknown): value is DashboardMarket =>
  typeof value === 'string' && (DASHBOARD_MARKETS as string[]).includes(value);

export const DASHBOARD_RULES = {
  /** 伺服器端每個市場的結果快取 5 分鐘；與羅盤自動更新頻率一致，避免多分頁同時打爆 Yahoo／Bybit。 */
  cacheTtlMs: 5 * 60 * 1000,
  /** 單一面板最多列出 12 檔，維持「值得關注」而非整份掃描清單。 */
  maxPicks: 12,
  /** 未達條件的觀察清單最多 10 檔，只作說明用途。 */
  maxWatch: 10,
  /**
   * 回測或入選追蹤至少要有 20 筆完成樣本才標示為「已有驗證數據」；
   * 低於此值的統計波動過大，畫面一律標示「未經驗證」。
   */
  minValidationSamples: 20,
  /** 虛擬幣雷達每 15 分鐘掃描；D1 最新一輪超過 30 分鐘未更新即視為過時，改以同一套函式即時補算。 */
  cryptoStaleMs: 30 * 60 * 1000,
} as const;

/** 資料來源：D1 已存雷達結果優先；只有過時或缺資料時才用同一套雷達函式即時補算（不寫 DB、不推播）。 */
export type DashboardSource = 'RADAR_DB' | 'LIVE_RECALC';

/** 驗證狀態：BACKTEST＝使用者自己跑過相同策略與週期的回測；TRACKED＝雷達入選後追蹤樣本足夠；UNVERIFIED＝兩者皆無。 */
export type ValidationStatus = 'BACKTEST' | 'TRACKED' | 'UNVERIFIED';

export interface PickValidation {
  status: ValidationStatus;
  /** 一行摘要，例如「回測 32 筆：勝率 41%、報酬 +3.2%」或「未經回測驗證」。 */
  label: string;
  /** 補充說明（樣本不足、追蹤視窗、是否扣費等）。 */
  detail: string;
}

/** 進場區間與停損參考；全部取自雷達既有欄位（收盤參考價、突破位、EMA20、結構失效價），不另創門檻。 */
export interface PickLevels {
  /** 價格單位與該市場報價一致：台股新台幣、美股美元、虛擬幣 USDT。 */
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  /** 收盤參考價到停損的距離（百分比，正值）。 */
  riskPct: number;
  /** 進場下緣採用的依據說明，例如「突破位」「4 小時 EMA20」。 */
  entryBasis: string;
}

export interface DashboardPick {
  market: DashboardMarket;
  symbol: string;
  name: string;
  /** 最近一根已收盤 K 線的收盤價，不是即時成交價。 */
  price: number;
  /** 漲跌幅百分比；changeLabel 說明比較區間（台美股為當日、虛擬幣為 24 小時）。 */
  changePct: number;
  changeLabel: string;
  /** 觸發的策略／訊號標籤，例如「經典吃大魚」「放量突破」。 */
  strategies: string[];
  /** 雷達品質分數（0–100），只代表條件符合程度，不是勝率。 */
  score: number;
  reasons: string[];
  risks: string[];
  levels: PickLevels | null;
  /** 訊號所屬已收盤 K 線的收盤時間，以及雷達實際計算時間。 */
  signalClosedAt: number;
  signalTimeframe: string;
  checkedAt: number;
  /** 此檔訊號是否對應該市場最新一根已收盤 K 線。 */
  fresh: boolean;
  validation: PickValidation;
  /** 供 K 線抽屜使用的原始雷達快照；台美股與虛擬幣各自沿用既有抽屜元件。 */
  stockSnapshot?: UsStockSnapshot;
  cryptoSnapshot?: RadarSnapshot;
}

/**
 * 已完成分析、但沒通過雷達候選條件的標的；只用來說明「卡在哪個條件」，畫面明確標示不是推薦。
 * 讓使用者在清單為空時仍能看到本輪實際分析了哪些標的，而不是一片空白。
 */
export interface DashboardWatchItem {
  market: DashboardMarket;
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  changeLabel: string;
  score: number;
  /** 目前的量價階段或吃大魚狀態，例如「等待條件」「綠色趨勢延續 · 無新進場」。 */
  statusLabel: string;
  /** 未通過的條件，例如「漲幅過熱」「日線 EMA20／50 未轉多」。 */
  blockers: string[];
  signalClosedAt: number;
  stockSnapshot?: UsStockSnapshot;
  cryptoSnapshot?: RadarSnapshot;
}

export interface DashboardPanelData {
  market: DashboardMarket;
  source: DashboardSource;
  /** 給使用者看的來源說明，例如「D1 台股雷達（排程寫入）」。 */
  sourceLabel: string;
  /** 本次彙整完成時間（伺服器時間）。 */
  generatedAt: number;
  /** 本批訊號對應的最新已收盤 K 線收盤時間；無法取得時為 null。 */
  latestBarClosedAt: number | null;
  /** 整批資料是否過時；stale 為 true 時 staleReason 必填。 */
  stale: boolean;
  staleReason: string | null;
  /** 本輪實際完成分析的標的數。 */
  scannedCount: number;
  picks: DashboardPick[];
  /** 已分析但未達候選條件的標的（依品質分數排序，最多 maxWatch 檔）。 */
  watchlist: DashboardWatchItem[];
  /** 清單為空時說明原因；不允許只顯示一片空白。 */
  emptyReason: string | null;
  /** 抓取或計算失敗的標的與原因，以及整體來源異常。 */
  errors: string[];
  /** 非錯誤的狀態說明，例如休市中、D1 雷達落後而改用即時補算。 */
  notes: string[];
  /** 這個市場的訊號規則摘要（雷達版本與條件），讓使用者知道清單從哪套邏輯來。 */
  ruleSummary: string;
}
