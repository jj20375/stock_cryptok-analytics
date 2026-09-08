import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** 全站共享公開行情；不儲存個人帳戶、金鑰或實際持倉。 */
export const waveRadar = sqliteTable('wave_radar', {
  symbol: text('symbol').primaryKey(),
  snapshotJson: text('snapshot_json').notNull(),
  checkedAt: integer('checked_at').notNull(),
});

/** 待發通知先落地；事件 id 含幣種、K 線時間與階段，重跑不重建事件。 */
export const waveNotifications = sqliteTable('wave_notifications', {
  id: text('id').primaryKey(),
  message: text('message').notNull(),
  createdAt: integer('created_at').notNull(),
  sentAt: integer('sent_at'),
});

/** 排程租約防止同一排程重疊發送；毫秒 UTC 到期後可由下一輪接手。 */
export const waveLease = sqliteTable('wave_lease', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
