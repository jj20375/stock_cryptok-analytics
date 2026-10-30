/**
 * @file Solana 迷因幣防 Rug 戰情室（Meme Desk）資料表結構。
 * 對應 @0xboan「Code kills, AI reads, you sign」架構中的三個核心檔案：
 * 1. meme_desk_checks -> 對應 checks.csv（記錄每顆代幣死在哪一關與具體原因）
 * 2. meme_desk_positions -> 對應 positions.json（記錄目前持有中的模擬／追蹤部位與最高價、初始流動性）
 * 3. meme_desk_trades -> 對應 trades.csv（記錄開倉、階梯分批停利與最終平倉的已實現損益）
 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 代幣 14 關審查紀錄表（對應原文 checks.csv）。
 * 每一筆代表對一個 Solana Mint 地址執行完整漏斗（limits -> facts -> pool -> judge）的最終裁決。
 */
export const memeDeskChecks = sqliteTable('meme_desk_checks', {
  /** 唯一識別碼（UUID） */
  id: text('id').primaryKey(),
  /** 審查執行時間（毫秒 UTC） */
  checkedAt: integer('checked_at').notNull(),
  /** Solana 代幣合約地址（Mint Address / CA） */
  mint: text('mint').notNull(),
  /** 代幣代號（Symbol，若在 limits 階段即被攔截可能為空字串） */
  symbol: text('symbol').notNull(),
  /** 結束或攔截的階段：limits（風控上限）| facts（合約硬指標）| pool（流動池檢查）| judge（Gemini 審查） */
  stage: text('stage').notNull(),
  /** 最終裁決：BUY（通過全部 14 關）| SKIP（任一關不通過或 API 異常） */
  verdict: text('verdict').notNull(),
  /** Gemini 給予的信心分數（0 ~ 1；未進入 judge 階段時為 null） */
  confidence: real('confidence'),
  /** 淘汰或買進的具體原因代碼（如 mint_open、thin_pool、或 Gemini 的兩行理由） */
  reason: text('reason').notNull(),
  /** 審查當下的代幣價格（USD；未進入 pool 階段時為 null） */
  priceUsd: real('price_usd'),
  /** 審查當下的最大池流動性（USD；未進入 pool 階段時為 null） */
  liquidityUsd: real('liquidity_usd'),
  /** DexScreener 交易對網址 */
  pairUrl: text('pair_url'),
  /** Rugcheck 合約檢查精簡結果 JSON（供前端展開檢視 9 項合約指標） */
  factsJson: text('facts_json'),
  /** DexScreener 流動池與社群連結檢查結果 JSON（供前端展開檢視 4 項池指標與買賣比） */
  poolJson: text('pool_json'),
  /** Gemini 第 14 關完整判讀結果 JSON（包含 why、socialRead、mainRisk） */
  judgeJson: text('judge_json'),
}, table => [
  index('meme_desk_checks_checked_idx').on(table.checkedAt),
  index('meme_desk_checks_mint_idx').on(table.mint),
]);

/**
 * 當前持倉表（對應原文 positions.json）。
 * 每個 Mint 同時最多一筆持倉；支援階梯式分批出場（steps 記錄目前已觸發第幾階停利）。
 */
export const memeDeskPositions = sqliteTable('meme_desk_positions', {
  /** Solana 代幣合約地址（作為主鍵，確保同幣種不重複開倉） */
  mint: text('mint').primaryKey(),
  /** 代幣代號 */
  symbol: text('symbol').notNull(),
  /** 進場均價（USD） */
  entryPrice: real('entry_price').notNull(),
  /** 原始買入數量（qty0，分批停利時固定依原始數量的比例計算賣出顆數） */
  initialQty: real('initial_qty').notNull(),
  /** 目前剩餘數量（qty） */
  remainingQty: real('remaining_qty').notNull(),
  /** 持倉期間創下的最高價（peak，用於第一階停利後的 30% 回落移動停利） */
  peakPrice: real('peak_price').notNull(),
  /** 進場當下的池子流動性（liq0，用於監控是否發生抽池超過 40% 的 Rug 徵兆） */
  initialLiquidityUsd: real('initial_liquidity_usd').notNull(),
  /** 最新一次巡檢更新的價格（USD） */
  lastPrice: real('last_price').notNull(),
  /** 最新一次巡檢更新的流動性（USD） */
  lastLiquidityUsd: real('last_liquidity_usd').notNull(),
  /** 開倉時間（毫秒 UTC，用於 6 小時未漲 20% 的時間停損判斷） */
  openedAt: integer('opened_at').notNull(),
  /** 已完成的階梯停利階段數（0 = 未停利、1 = 已過 +100% 賣半、2 = 已過 +200% 再賣 1/4） */
  steps: integer('steps').default(0).notNull(),
  /** 單筆固定投入本金（USD，預設 25 美元） */
  ticketUsd: real('ticket_usd').notNull(),
  /** 交易對網址 */
  pairUrl: text('pair_url'),
  /** 最新巡檢時間（毫秒 UTC） */
  updatedAt: integer('updated_at').notNull(),
});

/**
 * 歷史進出場與分批平倉帳本（對應原文 trades.csv）。
 * 用於計算當日已實現損益（today_pnl）、每日開倉次數上限與 24 小時同幣冷卻期。
 */
export const memeDeskTrades = sqliteTable('meme_desk_trades', {
  /** 唯一識別碼（UUID） */
  id: text('id').primaryKey(),
  /** 交易發生時間（毫秒 UTC） */
  createdAt: integer('created_at').notNull(),
  /** Solana 代幣合約地址 */
  mint: text('mint').notNull(),
  /** 代幣代號 */
  symbol: text('symbol').notNull(),
  /** 動作類型：open（新開倉）| partial（階梯部分停利）| close（全數平倉出場） */
  action: text('action').notNull(),
  /** 該筆成交名目金額（USD） */
  usd: real('usd').notNull(),
  /** 成交價格（USD） */
  price: real('price').notNull(),
  /** 已實現損益（USD；open 時為 0，partial / close 時為實際實現損益） */
  pnl: real('pnl').notNull(),
  /** 觸發原因（如 entry、liquidity_pulled、stop、take_profit_100、trailing_stop、time_stop、manual） */
  reason: text('reason').notNull(),
}, table => [
  index('meme_desk_trades_created_idx').on(table.createdAt),
  index('meme_desk_trades_mint_idx').on(table.mint, table.createdAt),
]);
