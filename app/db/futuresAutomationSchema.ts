/** @file Demo 自動化設定與通知佇列；時間為 UTC 毫秒、價格為每幣 USDT、費率為小數比例，不儲存憑證。 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const futuresAutomation = sqliteTable('crypto_futures_automation', {
  userId: integer('user_id').primaryKey(), enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
  /** 缺值僅為 Demo；LIVE 需獨立表單授權與部署允許，額度以 USDT 名目計。 */
  executionMode: text('execution_mode').default('DEMO').notNull(), maxNotionalUsdt: real('max_notional_usdt').default(30).notNull(),
  /** 額度欄位只限制測試單；正式交易依交易所 USDT 本金與風控，不設固定 30U。 */
  testMode: integer('test_mode', { mode: 'boolean' }).default(true).notNull(),
  /** 單筆名目佔 USDT 本金 3～5%；最多三個持倉槽，送單待確認也占用槽位。 */
  positionPct: real('position_pct').default(5).notNull(), maxOpenPositions: integer('max_open_positions').default(3).notNull(),
  symbolsJson: text('symbols_json').default('["BTCUSDT","ETHUSDT"]').notNull(), strategyId: text('strategy_id').default('futures_trend_retest').notNull(),
  /** 單邊費率為小數比例，0.0006 代表 0.06%，執行時仍取交易所費率的保守下限。 */
  feeRate: real('fee_rate').default(0.0006).notNull(), scanStateJson: text('scan_state_json').default('{}').notNull(),
  /** 租約隔離重疊 Cron；過期只允許接手掃描，訂單仍由既有引擎去重。 */
  leaseOwner: text('lease_owner'), leaseUntil: integer('lease_until').default(0).notNull(), checkedAt: integer('checked_at'),
  lastError: text('last_error'), updatedAt: integer('updated_at').notNull(),
});
export const futuresAutomationEvents = sqliteTable('crypto_futures_automation_events', {
  id: text('id').primaryKey(), userId: integer('user_id').notNull(), symbol: text('symbol').notNull(), strategyId: text('strategy_id').notNull(),
  executionMode: text('execution_mode').default('DEMO').notNull(),
  signalAt: integer('signal_at').notNull(), intent: text('intent').notNull(), price: real('price').notNull(), reason: text('reason').notNull(),
  stopPrice: real('stop_price'), targetPrice: real('target_price'), orderStatus: text('order_status').default('PENDING').notNull(), orderReason: text('order_reason'),
  notificationStatus: text('notification_status').default('PENDING').notNull(), deliveryLeaseUntil: integer('delivery_lease_until').default(0).notNull(),
  attempts: integer('attempts').default(0).notNull(), nextAttemptAt: integer('next_attempt_at').default(0).notNull(), createdAt: integer('created_at').notNull(),
}, table => [index('futures_auto_events_user_time').on(table.userId, table.signalAt), index('futures_auto_events_pending').on(table.nextAttemptAt)]);
export const futuresAutomationCandles = sqliteTable('crypto_futures_automation_candles', {
  symbol: text('symbol').primaryKey(), candlesJson: text('candles_json').notNull(), updatedAt: integer('updated_at').notNull(),
});
