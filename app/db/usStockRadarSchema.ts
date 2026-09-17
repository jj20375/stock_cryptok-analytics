/** @file 美股潛力雷達的共享快照、研究樣本、排程租約與獨立 Slack 佇列。 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const usStockRadar = sqliteTable('us_stock_radar', {
  symbol: text('symbol').primaryKey(),
  snapshotJson: text('snapshot_json').notNull(),
  checkedAt: integer('checked_at').notNull(),
});

/** 入選後固定追蹤 1 小時、1 日與 5 個交易日；失敗樣本保留，避免只統計成功案例。 */
export const usStockObservations = sqliteTable('us_stock_observations', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  enteredAt: integer('entered_at').notNull(),
  checkedAt: integer('checked_at').notNull(),
  observationJson: text('observation_json').notNull(),
}, table => [index('us_stock_observations_entered_idx').on(table.enteredAt)]);

/** 單列租約防止排程重疊；summary_json 供頁面顯示最近一次完整掃描狀態。 */
export const usStockRadarRun = sqliteTable('us_stock_radar_run', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at').notNull(),
  summaryJson: text('summary_json'),
});

/** 美股訊號使用獨立頻道；成功收到 Slack 回應後才寫 sent_at，暫時失敗可補送。 */
export const usStockRadarNotifications = sqliteTable('us_stock_radar_notifications', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  barTime: integer('bar_time').notNull(),
  detectedAt: integer('detected_at').notNull(),
  message: text('message').notNull(),
  sentAt: integer('sent_at'),
}, table => [index('us_stock_radar_notifications_pending_idx').on(table.sentAt, table.detectedAt)]);
