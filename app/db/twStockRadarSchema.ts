/** @file 台股 4 小時／日線雷達的快照、績效、租約與獨立 Slack 通知佇列。 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const twStockRadar = sqliteTable('tw_stock_radar', {
  symbol: text('symbol').primaryKey(), snapshotJson: text('snapshot_json').notNull(), checkedAt: integer('checked_at').notNull(),
});

export const twStockObservations = sqliteTable('tw_stock_observations', {
  id: text('id').primaryKey(), symbol: text('symbol').notNull(), enteredAt: integer('entered_at').notNull(),
  checkedAt: integer('checked_at').notNull(), observationJson: text('observation_json').notNull(),
}, table => [index('tw_stock_observations_entered_idx').on(table.enteredAt)]);

export const twStockRadarRun = sqliteTable('tw_stock_radar_run', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), expiresAt: integer('expires_at').notNull(),
  summaryJson: text('summary_json'),
});

export const twStockRadarNotifications = sqliteTable('tw_stock_radar_notifications', {
  id: text('id').primaryKey(), symbol: text('symbol').notNull(), barTime: integer('bar_time').notNull(),
  detectedAt: integer('detected_at').notNull(), message: text('message').notNull(), sentAt: integer('sent_at'),
}, table => [index('tw_stock_radar_notifications_pending_idx').on(table.sentAt, table.detectedAt)]);
