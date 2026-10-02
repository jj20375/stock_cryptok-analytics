/** @file Bitget 合約自動交易事件稽核；不保存任何 API 金鑰或明文憑證。 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cryptoAutoOrders = sqliteTable('crypto_auto_orders', {
  /** 同一使用者與同一來源事件共用固定 ID，Cloudflare 重試也不會重複下單。 */
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  source: text('source').notNull(),
  sourceEventId: text('source_event_id').notNull(),
  symbol: text('symbol').notNull(),
  action: text('action').notNull(),
  /** DEMO 與 LIVE 分開去重，切換環境後不會被另一環境的歷史事件誤擋。 */
  executionMode: text('execution_mode').default('DEMO').notNull(),
  signalAt: integer('signal_at').notNull(),
  referencePrice: real('reference_price').notNull(),
  status: text('status').notNull(),
  reason: text('reason'),
  bitgetClientOid: text('bitget_client_oid'),
  bitgetOrderId: text('bitget_order_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('crypto_auto_orders_user_time_idx').on(table.userId, table.createdAt),
  index('crypto_auto_orders_status_idx').on(table.status, table.updatedAt),
]);
