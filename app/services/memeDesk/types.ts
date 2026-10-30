/**
 * @file Solana 迷因幣防 Rug 戰情室（Meme Desk）共用型別定義。
 * 涵蓋 Rugcheck 合約報告、DexScreener 流動池與社群結構、Gemini 裁判結論與戰情室統計報表。
 */

/**
 * 第 1 ～ 9 關：Rugcheck 合約安全檢查結構（對應原文 rugcheck.py 回傳欄位）。
 */
export interface RugcheckFacts {
  /** Solana 代幣 Mint 地址 */
  mint: string;
  /** 代幣代號（Symbol） */
  symbol: string | null;
  /** 代幣名稱（Name） */
  name: string | null;
  /** 第 1 關：是否已被 Rugcheck 標記為已跑路（Rugged） */
  rugged: boolean;
  /** 第 5 關：正規化風險分數（0 ~ 100，越高越危險） */
  riskScore: number | null;
  /** 第 4 關：所有等級為 danger 的致命風險名稱列表 */
  dangerFlags: string[];
  /** 次級警告（warn）名稱列表，會傳遞給第 14 關 Gemini 評估是否疊加成高風險 */
  warnFlags: string[];
  /** 第 2 關：鑄幣權限地址（非 null 代表開發者仍可無限增發代幣） */
  mintAuthority: string | null;
  /** 第 3 關：凍結權限地址（非 null 代表開發者可凍結買家錢包禁止賣出） */
  freezeAuthority: string | null;
  /** 第 6 關：最大池子 LP 鎖倉／銷毀百分比（0 ~ 100） */
  lpLockedPct: number | null;
  /** 第 7 關：排除 AMM 與鎖倉合約後，前 10 大持幣地址合計佔比（%） */
  top10Pct: number | null;
  /** 第 8 關：創建者（Dev）錢包目前持幣佔總供給百分比（%） */
  devPct: number | null;
  /** 第 9 關：內部人地址數與關聯網路偵測命中總數 */
  insiders: number;
  /** 總持幣地址數 */
  totalHolders: number | null;
}

/**
 * 第 10 ～ 13 關：DexScreener 流動池與社群交易結構（對應原文 market.py 並擴充 Gemini 所需欄位）。
 */
export interface DexPoolSnapshot {
  /** 代幣代號 */
  symbol: string | null;
  /** 代幣名稱 */
  name: string | null;
  /** 現價（USD） */
  priceUsd: number;
  /** 最大池流動性（USD） */
  liquidityUsd: number;
  /** 完全稀釋估值 FDV（USD） */
  fdvUsd: number | null;
  /** 池子成立時間（分鐘） */
  ageMin: number | null;
  /** 近 5 分鐘買單筆數 */
  buys5m: number;
  /** 近 5 分鐘賣單筆數 */
  sells5m: number;
  /** 近 1 小時買單筆數 */
  buys1h: number;
  /** 近 1 小時賣單筆數 */
  sells1h: number;
  /** 近 1 小時成交量（USD） */
  volume1hUsd: number;
  /** 近 1 小時平均每筆成交金額（USD，供 Gemini 識別 $1 微額刷量機器人） */
  avgTrade1hUsd: number | null;
  /** 近 1 小時價格漲跌幅（%） */
  priceChange1hPct: number | null;
  /** 代幣在 DexScreener 登記的社群連結（如 Twitter/X、Telegram） */
  socials: Array<{ type: string; url: string }>;
  /** 代幣在 DexScreener 登記的官方網站列表 */
  websites: string[];
  /** 目前活躍的 DexScreener 付費 Boost 點數 */
  boostsActive: number;
  /** DexScreener 交易對頁面網址 */
  pairUrl: string | null;
}

/**
 * 第 14 關：Gemini AI 裁判結構化輸出（對應原文 prompts.py 的 JSON 規格）。
 */
export interface GeminiJudgeVerdict {
  /** 裁決結果：BUY 放行或 SKIP 淘汰 */
  verdict: 'BUY' | 'SKIP';
  /** 信心分數（0.0 ~ 1.0，低於 0.7 由程式強制轉為 SKIP） */
  confidence: number;
  /** 兩行以內的核心裁決理由（繁體中文） */
  why: string;
  /** 社群連結、敘事與刷量結構判讀（繁體中文，一行） */
  xRead: string;
  /** 最大潛在風險提醒（繁體中文，一行） */
  mainRisk: string;
}

/**
 * 單顆代幣執行 14 關審查後的完整回傳結構（對應原文 check.py 輸出）。
 */
export interface MemeCheckResult {
  id: string;
  checkedAt: number;
  mint: string;
  symbol: string;
  /** 若屬於 Bitget 交易所已上架代幣，紀錄其 Bitget 現貨／合約交易對代號（如 WIFUSDT） */
  bitgetSymbol?: string | null;
  stage: 'limits' | 'facts' | 'pool' | 'judge';
  verdict: 'BUY' | 'SKIP';
  confidence: number | null;
  reason: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  pairUrl: string | null;
  actionText?: string;
  facts: RugcheckFacts | null;
  pool: DexPoolSnapshot | null;
  judge: GeminiJudgeVerdict | null;
}

/**
 * 持倉顯示結構（含即時未實現損益與出場條件距離）。
 */
export interface MemeOpenPositionView {
  mint: string;
  symbol: string;
  /** Bitget 交易對代號（如 BONKUSDT），供一鍵跳轉至 Bitget 現貨下單 */
  bitgetSymbol?: string | null;
  entryPrice: number;
  lastPrice: number;
  peakPrice: number;
  initialQty: number;
  remainingQty: number;
  initialLiquidityUsd: number;
  lastLiquidityUsd: number;
  openedAt: number;
  updatedAt: number;
  steps: number;
  ticketUsd: number;
  pairUrl: string | null;
  /** 當前未實現漲跌幅（%） */
  unrealizedPct: number;
  /** 當前剩餘部位市值（USD） */
  marketValueUsd: number;
  /** 當前剩餘部位未實現損益（USD） */
  unrealizedPnlUsd: number;
  /** 池子流動性較進場時的變化百分比（%，負值代表池子縮水） */
  liquidityChangePct: number;
  /** 已持倉小時數 */
  heldHours: number;
}

/**
 * 每日擊殺與績效晚報統計（對應原文 report.py 的 EVENING REPORT）。
 */
export interface MemeEveningReport {
  /** 統計日期（UTC YYYY-MM-DD） */
  day: string;
  /** 是否為模擬盤模式 */
  paperMode: boolean;
  /** 今日總審查代幣數 */
  checkedCount: number;
  /** 死於第 1 關（本地風控上限）的數量 */
  killedByLimits: number;
  /** 死於第 2~9 關（Rugcheck 合約檢查）的數量 */
  killedByFacts: number;
  /** 死於第 10~13 關（DexScreener 流動池檢查）的數量 */
  killedByPool: number;
  /** 死於第 14 關（Gemini AI 審查）的數量 */
  killedByJudge: number;
  /** 今日通過全部 14 關買進的數量 */
  boughtCount: number;
  /** 目前場內持倉中數量 */
  openNowCount: number;
  /** 今日已實現損益合計（USD） */
  realizedPnlTodayUsd: number;
  /** 今日已平倉獲利筆數 */
  greenExitsCount: number;
  /** 今日已平倉總筆數 */
  totalExitsCount: number;
  /** 今日最佳已實現交易 */
  bestTrade: { symbol: string; pnlUsd: number } | null;
  /** 今日最差已實現交易 */
  worstTrade: { symbol: string; pnlUsd: number } | null;
  /** 今日最常見的硬過濾死因與次數 */
  mostCommonKill: { reason: string; count: number } | null;
}
