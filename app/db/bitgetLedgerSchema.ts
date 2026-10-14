/** @file 唯讀成交帳本；使用者、環境與金鑰指紋隔離，明文憑證不落入帳本。 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const bitgetLedgerAccounts = sqliteTable('bitget_ledger_accounts', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  environment: text('environment').notNull(),
  dialect: text('dialect'),
  /** 游標含固定查詢區間與三條資料流；中斷後重抓同一頁仍以交易所 ID 去重。 */
  cursorJson: text('cursor_json'),
  coveredFrom: integer('covered_from'),
  coveredTo: integer('covered_to'),
  lastSyncedAt: integer('last_synced_at'),
  lastAttemptAt: integer('last_attempt_at'),
  error: text('error'),
  /** D1 原子租約避免手動同步與排程同時推進游標；時間單位為 UTC 毫秒。 */
  leaseUntil: integer('lease_until').default(0).notNull(),
  leaseToken: text('lease_token'),
  reportLeaseUntil: integer('report_lease_until').default(0).notNull(),
  reportToken: text('report_token'),
  snapshotJson: text('snapshot_json'),
  createdAt: integer('created_at').notNull(),
}, t => [index('bitget_ledger_accounts_user_idx').on(t.userId, t.environment)]);

export const bitgetLedgerFills = sqliteTable('bitget_ledger_fills', {
  /** 主鍵組合 scope 與交易所 execId；不是以 timestamp 或價格猜測唯一性。 */
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  exchangeId: text('exchange_id').notNull(),
  orderId: text('order_id').notNull(),
  clientOid: text('client_oid'),
  symbol: text('symbol').notNull(),
  side: text('side').notNull(),
  positionSide: text('position_side').notNull(),
  effect: text('effect').notNull(),
  /** 價格、數量、損益保持 decimal 字串；缺少損益時為 null，不能假設零。 */
  price: text('price').notNull(),
  quantity: text('quantity').notNull(),
  realizedPnl: text('realized_pnl'),
  feesJson: text('fees_json').notNull(),
  executedAt: integer('executed_at').notNull(),
}, t => [index('bitget_ledger_fills_account_time_idx').on(t.accountId, t.executedAt)]);

export const bitgetLedgerBills = sqliteTable('bitget_ledger_bills', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  exchangeId: text('exchange_id').notNull(),
  symbol: text('symbol'),
  coin: text('coin').notNull(),
  type: text('type').notNull(),
  amount: text('amount').notNull(),
  balance: text('balance'),
  occurredAt: integer('occurred_at').notNull(),
}, t => [index('bitget_ledger_bills_account_time_idx').on(t.accountId, t.occurredAt)]);

export const bitgetLedgerOrders = sqliteTable('bitget_ledger_orders', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  exchangeId: text('exchange_id').notNull(),
  clientOid: text('client_oid'),
  symbol: text('symbol').notNull(),
  side: text('side').notNull(),
  positionSide: text('position_side').notNull(),
  status: text('status').notNull(),
  quantity: text('quantity').notNull(),
  filledQuantity: text('filled_quantity').notNull(),
  averagePrice: text('average_price'),
  updatedAt: integer('updated_at').notNull(),
}, t => [index('bitget_ledger_orders_account_idx').on(t.accountId, t.updatedAt)]);

export const bitgetJournalReports = sqliteTable('bitget_journal_reports', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  periodFrom: integer('period_from').notNull(),
  periodTo: integer('period_to').notNull(),
  dataVersion: text('data_version').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [index('bitget_journal_reports_account_idx').on(t.accountId, t.createdAt)]);
