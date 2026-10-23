/** @file 市場漲跌走勢羅盤的預測快照；只存公開行情數值與判讀結果，不含任何帳戶或憑證。 */
import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

/**
 * 每一筆代表「某個時間點羅盤給出的結論與當下輸入」，事後檢討預判失準時才能回答「當時看到的是什麼」。
 * source：TW_PREOPEN = 台北 08:30 固定排程快照（每日一筆，用於長期命中率統計）；
 *         API_VIEW = 使用者開頁面時實際算出的判讀（節流後落地，用於還原當下畫面）。
 */
export const macroOutlookSnapshots = sqliteTable('macro_outlook_snapshots', {
  id: text('id').primaryKey(),
  /** 判讀計算時間（毫秒 UTC），對應 MacroIndicators.timestamp */
  createdAt: integer('created_at').notNull(),
  source: text('source').notNull(),
  /** 各市場整體方向（BULLISH／NEUTRAL／BEARISH）與 -100～+100 評分 */
  twDirection: text('tw_direction').notNull(),
  twScore: integer('tw_score').notNull(),
  usDirection: text('us_direction').notNull(),
  usScore: integer('us_score').notNull(),
  cryptoDirection: text('crypto_direction').notNull(),
  cryptoScore: integer('crypto_score').notNull(),
  /** 抓取失敗的報價來源 JSON 陣列；非空代表該次判讀不完整 */
  missingSources: text('missing_sources').notNull(),
  /** 判讀當下的原始輸入（DXY、台幣、10Y、3M、VIX、NQ、ES、利差與各報價時間）JSON */
  inputsJson: text('inputs_json').notNull(),
  /** 各市場四大維度的訊號 JSON，供逐項檢討哪一個維度看錯 */
  pillarsJson: text('pillars_json').notNull(),
}, table => [
  index('macro_outlook_snapshots_created_idx').on(table.createdAt),
  index('macro_outlook_snapshots_source_idx').on(table.source, table.createdAt),
]);
