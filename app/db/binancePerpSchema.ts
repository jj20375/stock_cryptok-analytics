/** @file Binance 永續 Mark Price 雷達的租約與 Slack 耐久通知；不保存交易憑證或下單資料。 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 單行租約防止同一輪排程重疊；摘要只記錄公開行情掃描結果。 */
export const binancePerpRun = sqliteTable('binance_perp_run', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at').notNull(),
  summaryJson: text('summary_json'),
});

/** 先把已收盤訊號寫入 D1，Slack 成功回應後才標記送達，暫時失敗可於下一輪補送。 */
export const binancePerpAlerts = sqliteTable('binance_perp_alerts', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  barTime: integer('bar_time').notNull(),
  detectedAt: integer('detected_at').notNull(),
  message: text('message').notNull(),
  sentAt: integer('sent_at'),
}, table => [index('binance_perp_alerts_pending_idx').on(table.sentAt, table.detectedAt)]);
