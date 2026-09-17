/** @file 潛力幣的共享行情、歷史入選與排程狀態；不含個人交易或憑證。 */
import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

export const potentialRadar = sqliteTable('potential_radar', {
  symbol: text('symbol').primaryKey(), snapshotJson: text('snapshot_json').notNull(), checkedAt: integer('checked_at').notNull(),
});
/** 入選快照保留原始版本與分數；追蹤失敗也不刪除，避免只留下成功案例。 */
export const potentialObservations = sqliteTable('potential_observations', {
  id: text('id').primaryKey(), symbol: text('symbol').notNull(), enteredAt: integer('entered_at').notNull(),
  checkedAt: integer('checked_at').notNull(), observationJson: text('observation_json').notNull(),
}, table => [index('potential_observations_entered_idx').on(table.enteredAt)]);
/** 單行租約與最近執行摘要；owner 限制只有當輪持有者能發布結果。 */
export const potentialRun = sqliteTable('potential_run', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), expiresAt: integer('expires_at').notNull(),
  summaryJson: text('summary_json'),
});
/** 候選通知先與快照一起入列；Slack 暫時失敗時保留未送事件，避免掃描成功卻永久漏報。 */
export const potentialRadarNotifications = sqliteTable('potential_radar_notifications', {
  id: text('id').primaryKey(), message: text('message').notNull(), createdAt: integer('created_at').notNull(),
  sentAt: integer('sent_at'),
}, table => [index('potential_radar_notifications_pending_idx').on(table.sentAt, table.createdAt)]);
