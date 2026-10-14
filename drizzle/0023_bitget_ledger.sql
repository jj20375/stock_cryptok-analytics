-- 成交、委託與資金流水分開保存；精度字串不轉成 SQLite 浮點數。
CREATE TABLE bitget_ledger_accounts (
 id TEXT PRIMARY KEY NOT NULL, user_id INTEGER NOT NULL, environment TEXT NOT NULL,
 dialect TEXT, cursor_json TEXT, covered_from INTEGER, covered_to INTEGER,
 last_synced_at INTEGER, last_attempt_at INTEGER, error TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT,
 report_lease_until INTEGER NOT NULL DEFAULT 0, report_token TEXT,
 snapshot_json TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX bitget_ledger_accounts_user_idx ON bitget_ledger_accounts(user_id, environment);
CREATE TABLE bitget_ledger_fills (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, exchange_id TEXT NOT NULL,
 order_id TEXT NOT NULL, client_oid TEXT, symbol TEXT NOT NULL, side TEXT NOT NULL,
 position_side TEXT NOT NULL, effect TEXT NOT NULL, price TEXT NOT NULL, quantity TEXT NOT NULL,
 realized_pnl TEXT, fees_json TEXT NOT NULL, executed_at INTEGER NOT NULL
);
CREATE INDEX bitget_ledger_fills_account_time_idx ON bitget_ledger_fills(account_id, executed_at);
CREATE TABLE bitget_ledger_bills (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, exchange_id TEXT NOT NULL,
 symbol TEXT, coin TEXT NOT NULL, type TEXT NOT NULL, amount TEXT NOT NULL, balance TEXT, occurred_at INTEGER NOT NULL
);
CREATE INDEX bitget_ledger_bills_account_time_idx ON bitget_ledger_bills(account_id, occurred_at);
CREATE TABLE bitget_ledger_orders (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, exchange_id TEXT NOT NULL,
 client_oid TEXT, symbol TEXT NOT NULL, side TEXT NOT NULL, position_side TEXT NOT NULL,
 status TEXT NOT NULL, quantity TEXT NOT NULL, filled_quantity TEXT NOT NULL, average_price TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX bitget_ledger_orders_account_idx ON bitget_ledger_orders(account_id, updated_at);
CREATE TABLE bitget_journal_reports (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, period_from INTEGER NOT NULL, period_to INTEGER NOT NULL,
 data_version TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX bitget_journal_reports_account_idx ON bitget_journal_reports(account_id, created_at);
ALTER TABLE crypto_auto_orders ADD COLUMN ledger_account_id TEXT;
ALTER TABLE crypto_auto_orders ADD COLUMN paper_trade_id INTEGER;
ALTER TABLE crypto_auto_orders ADD COLUMN requested_quantity TEXT;
ALTER TABLE crypto_auto_orders ADD COLUMN strategy_snapshot_json TEXT;
ALTER TABLE paper_trades ADD COLUMN ledger_account_id TEXT;
ALTER TABLE paper_trades ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'ESTIMATED';
-- 新版未成交 reservation 亦保留一個持倉槽；不同訊號同時進場不得重複開倉。
CREATE UNIQUE INDEX crypto_bitget_open_slot_idx ON paper_trades(user_id,mode,symbol)
 WHERE exchange='BITGET' AND market='CRYPTO' AND status='OPEN' AND ledger_account_id IS NOT NULL;
