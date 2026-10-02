/** @file 潛力幣的共享行情、歷史入選與排程狀態；不含個人交易或憑證。 */
import { integer, sqliteTable, text, index, primaryKey } from 'drizzle-orm/sqlite-core';

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
/**
 * 4 小時吃大魚由獨立排程計算後寫入，雷達每輪只讀一次；分開執行才不會擠爆雷達單次 50 個子請求的上限。
 * signalJson 為 null 時 error 說明原因（例如新幣歷史不足），代表本根已嘗試過、不需重抓。
 */
export const potentialBigFish = sqliteTable('potential_big_fish', {
  symbol: text('symbol').notNull(), source: text('source').notNull(), barTime: integer('bar_time').notNull(),
  signalJson: text('signal_json'), error: text('error'), checkedAt: integer('checked_at').notNull(),
}, table => [primaryKey({ columns: [table.symbol, table.source] }), index('potential_big_fish_bar_idx').on(table.barTime)]);
/** 候選通知先與快照一起入列；Slack 暫時失敗時保留未送事件，避免掃描成功卻永久漏報。 */
export const potentialRadarNotifications = sqliteTable('potential_radar_notifications', {
  id: text('id').primaryKey(), message: text('message').notNull(), createdAt: integer('created_at').notNull(),
  sentAt: integer('sent_at'),
}, table => [index('potential_radar_notifications_pending_idx').on(table.sentAt, table.createdAt)]);
