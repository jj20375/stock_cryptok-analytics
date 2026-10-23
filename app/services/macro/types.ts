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

/** 羅盤使用的外部報價來源代號；用於標記哪一項抓取失敗與報價時間 */
export type MacroSourceKey = "dxy" | "us10y" | "us5y" | "us3m" | "vix" | "usdTwd" | "nq" | "es";

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
  /** 維度識別碼 */
  key: "treasury" | "fx" | "futures" | "bondSpreadAndVix";
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
  /** 專屬四大維度卡片 */
  pillars: {
    treasury: MacroPillarAnalysis;
    fx: MacroPillarAnalysis;
    futures: MacroPillarAnalysis;
    bondSpreadAndVix: MacroPillarAnalysis;
  };
  /** 專屬市場漲跌總結 */
  outlook: MacroMarketOutlook;
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
};
