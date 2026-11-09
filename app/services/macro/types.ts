/**
 * @file 市場漲跌走勢羅盤（美債、匯率、期貨、債券利差與 VIX）的共用型別。
 * 從 macroService.ts 拆出，讓服務檔專注在資料抓取與判讀邏輯，前端元件與快照紀錄共用同一份型別。
 */

/**
 * 【詳細繁體中文註解】
 * 單一宏觀維度（美債、匯率、期貨、債券利差）的多空判讀結構
 */
export type MacroSignalDirection = "BULLISH" | "NEUTRAL" | "BEARISH";
export type MacroTargetMarket = "US" | "TW" | "CRYPTO";

/** 羅盤使用的外部報價來源代號；用於標記哪一項抓取失敗與報價時間（tsm 為台積電 ADR、sox 為費城半導體指數，用來模擬台指夜盤與科技股先行盤） */
export type MacroSourceKey = "dxy" | "us10y" | "us5y" | "us3m" | "vix" | "usdTwd" | "nq" | "es" | "wti" | "brent" | "tsm" | "sox";

/** 單一報價的日線摘要：最新值、前一根日K收盤、漲跌幅（%）、10 日均線與相對均線的方向 */
export interface MacroQuote {
  value: number;
  prevValue: number;
  changePct: number;
  ma10: number;
  /** 最新值高於 10MA 為 UP，否則 DOWN */
  trend: "UP" | "DOWN";
}

export interface MacroPillarAnalysis {
  /** 維度識別碼（nightSession 為台指夜盤／費半與台積電 ADR 連動觀察） */
  key: "treasury" | "fx" | "futures" | "bondSpreadAndVix" | "oil" | "nightSession";
  /** 維度顯示標題 */
  title: string;
  /** 對目標市場的影響方向：BULLISH (看漲利多) / NEUTRAL (中性震盪) / BEARISH (看跌利空) */
  signal: MacroSignalDirection;
  /** 方向中文短標籤（例如：📈 利多美股看漲、⚖️ 美股影響中性、📉 利空美股看跌） */
  signalLabel: string;
  /** 核心數值主標（例如：5.117% (-0.019) 或 NQ -1.83% (29,458)） */
  primaryMetric: string;
  /** 輔助比較數值（例如：10MA: 5.18% ｜ 5Y: 4.93%） */
  secondaryMetric: string;
  /** 白話影響解讀：說明為何此數據目前對該市場看漲或看跌 */
  explanation: string;
  /**
   * 該維度的報價抓取失敗、無法判讀時為 true。
   * 此時 signal 固定為 NEUTRAL 且不計入評分，避免用假預設值產生看漲/看跌訊號。
   */
  dataUnavailable?: boolean;
}

/**
 * 【詳細繁體中文註解】
 * 跌勢與震盪盤中的「做空／做多切入時機」訊號結構：
 * 結合 VIX 恐慌指數（位階、10MA 乖離與單日轉折）、美股期貨（NQ/ES 走盤）及台指夜盤連動指標（TSM 台積電 ADR / ^SOX 費半），
 * 明確標示當前處於「順勢做空時機」「恐慌見底反轉做多時機」「順勢做多時機」或「多空拉鋸觀望」。
 */
export interface MacroTimingWindow {
  /** 時機狀態：SHORT_WINDOW（破線/避險升溫做空時機）、REVERSAL_LONG_WINDOW（恐慌極值回落抄底做多時機）、TREND_LONG_WINDOW（順勢做多時機）、WAIT（觀望等待） */
  stance: "SHORT_WINDOW" | "REVERSAL_LONG_WINDOW" | "TREND_LONG_WINDOW" | "WAIT";
  /** 時機燈號短標題 */
  badge: string;
  /** 為何現在是做空或做多時機的判斷依據（VIX + 期貨走盤 + 台指夜盤 TSM/SOX 連動） */
  triggerReason: string;
  /** 做多觸發與確認清單（讓使用者清楚知道跌勢中出現什麼訊號可以開多） */
  longChecklist: string[];
  /** 做空觸發與確認清單（讓使用者清楚知道反彈到哪或破哪裡可以開空） */
  shortChecklist: string[];
}

/**
 * 【詳細繁體中文註解】
 * 單一目標市場（美股 US / 台股 TW / 加密貨幣 CRYPTO）的專屬漲跌研判結構
 */
export interface MacroMarketOutlook {
  /** 整體市場走向：BULLISH (偏多看漲) / NEUTRAL (多空震盪) / BEARISH (偏空看跌) */
  direction: MacroSignalDirection;
  /** 走向大標題（例如：美股偏多看漲、美股多空震盪、美股偏空看跌） */
  label: string;
  /** 多空綜合加權評分（-100 至 +100，正值代表看漲機率高、負值代表看跌壓力大） */
  score: number;
  /** 四大維度中看漲的數量 */
  bullishCount: number;
  /** 四大維度中中性的數量（不含資料暫缺的維度） */
  neutralCount: number;
  /** 四大維度中看跌的數量 */
  bearishCount: number;
  /** 四大維度中因報價抓取失敗而未納入評分的數量 */
  unavailableCount: number;
  /** 動態生成的市場漲跌白話總結（絕對與下方四張卡片訊號一致，不產生矛盾） */
  summary: string;
  /** 具體操作策略建議 */
  actionHint: string;
  /** 向下相容欄位：美股焦點建議 */
  usMarketHint: string;
  /** 向下相容欄位：台股焦點建議 */
  twMarketHint: string;
}

export interface MarketSpecificMacroView {
  market: MacroTargetMarket;
  /** 羅盤頂部標題 */
  compassTitle: string;
  /** 專屬四大維度卡片與夜盤／油價觀察 */
  pillars: {
    treasury: MacroPillarAnalysis;
    fx: MacroPillarAnalysis;
    futures: MacroPillarAnalysis;
    bondSpreadAndVix: MacroPillarAnalysis;
    /** 台股／美股的油價補充觀察；不列入原四項評分與訊號計數，幣圈不提供。 */
    oil?: MacroPillarAnalysis;
    /** 台指夜盤與費半／台積電 ADR 連動觀察卡片（不改動原回測四項評分，專供判斷夜盤與開盤跳空） */
    nightSession?: MacroPillarAnalysis;
  };
  /** 專屬市場漲跌總結 */
  outlook: MacroMarketOutlook;
  /** 跌勢與震盪盤中的「做空／反轉做多／順勢做多」時機訊號 */
  timingWindow?: MacroTimingWindow;
}

/** 報價完整度：哪些來源抓取失敗，以及每個來源最後一筆成交/報價的時間 */
export interface MacroDataStatus {
  /** 抓取失敗的來源；這些來源不會用預設值代入判讀 */
  missing: MacroSourceKey[];
  /** 各來源最後報價時間（毫秒 UTC，取自 Yahoo regularMarketTime），用來判斷數據是否已過時 */
  quoteTimes: Partial<Record<MacroSourceKey, number>>;
}

/**
 * 【詳細繁體中文註解】
 * 全球總體經濟指標資料結構（向下相容既有欄位，並內建美股/台股/幣圈專屬漲跌判讀）
 */
export interface MacroIndicators {
  /** 本次判讀的計算時間（毫秒 UTC）；前端以此顯示「幾點算的」，避免拿舊判讀操作 */
  timestamp: number;
  dxy: MacroQuote;
  /** 美元兌新台幣；抓取失敗時為 null（不再以 32.0 假值代入） */
  usdTwd: MacroQuote | null;
  us10y: MacroQuote;
  us5y: Omit<MacroQuote, "changePct">;
  us3m: Omit<MacroQuote, "changePct">;
  vix: MacroQuote;
  /** 原油近月期貨（美元／桶）；任一來源失敗為 null，不影響其餘羅盤資料。 */
  oil: { wti: MacroQuote | null; brent: MacroQuote | null };
  /** 台指夜盤與美股科技先行指標：台積電 ADR (TSM) 與費城半導體指數 (^SOX) */
  nightSession?: { tsm: MacroQuote | null; sox: MacroQuote | null };
  futures: {
    /** 那斯達克 100 期貨；抓取失敗時為 null（不再以 20000 假值代入） */
    nq: MacroQuote | null;
    /** 標普 500 期貨；抓取失敗時為 null（不再以 5800 假值代入） */
    es: MacroQuote | null;
  };
  spreads: {
    yieldSpread10Y3M: number; // 10年期減3個月利差 (低於 0 代表倒掛，預示經濟衰退)
    yieldSpread10Y5Y: number; // 10年期減5年期利差
  };
  regime: {
    riskState: "RISK_ON" | "RISK_OFF" | "PANIC";
    allowLong: boolean;
    reason: string;
  };
  /** 預設（美股）四大維度判讀，保留向下相容 */
  pillars: MarketSpecificMacroView["pillars"];
  /** 預設（美股）走向結論，保留向下相容 */
  marketOutlook: MacroMarketOutlook;
  /** 依市場（US 美股 / TW 台股 / CRYPTO 幣圈）量身打造的專屬漲跌分析 */
  marketViews: Record<MacroTargetMarket, MarketSpecificMacroView>;
  /** 報價完整度與各來源報價時間 */
  dataStatus: MacroDataStatus;
}

/** 判讀函式的原始輸入；usdTwd / nq / es 為 null 代表抓取失敗，該維度不得產生多空訊號 */
export type MacroRawInput = {
  dxy: MacroQuote;
  usdTwd: MacroQuote | null;
  us10y: MacroQuote;
  us5y: Omit<MacroQuote, "changePct">;
  vix: MacroQuote;
  nq: MacroQuote | null;
  es: MacroQuote | null;
  yieldSpread10Y3M: number;
  /** 選填以相容既有回測輸入；省略時油價觀察標示資料暫缺，不改動評分。 */
  oil?: { wti: MacroQuote | null; brent: MacroQuote | null };
  /** 選填：台積電 ADR (TSM) 與費城半導體 (^SOX)，用於台指夜盤連動與多空時機判讀 */
  nightSession?: { tsm: MacroQuote | null; sox: MacroQuote | null };
};
