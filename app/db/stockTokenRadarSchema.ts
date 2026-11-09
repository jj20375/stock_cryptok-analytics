/** @file 美股現貨代幣的共享報告、掃描租約與同根去重通知；與股票／合約帳本分開。 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const stockTokenRadarRun = sqliteTable('stock_token_radar_run', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), expiresAt: integer('expires_at').notNull(),
  reportJson: text('report_json'),
});
export const stockTokenNotices = sqliteTable('stock_token_notices', {
  id: text('id').primaryKey(), symbol: text('symbol').notNull(),
  expiresAt: integer('expires_at').notNull(), candidateJson: text('candidate_json').notNull(),
  sentAt: integer('sent_at'),
});
