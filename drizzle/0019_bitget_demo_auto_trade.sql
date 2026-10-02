-- Bitget Demo 憑證與正式盤分離；所有開關預設關閉，套用 migration 不會自動開始交易。
ALTER TABLE users ADD COLUMN bitget_demo_api_key TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN bitget_demo_api_secret TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN bitget_demo_passphrase TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN tradingview_demo_auto_trading_enabled INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN internal_demo_auto_trading_enabled INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- 事件表先寫入再送單；固定主鍵可抵抗 TradingView、Cloudflare 與排程重試造成的重複下單。
CREATE TABLE crypto_auto_orders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  signal_at INTEGER NOT NULL,
  reference_price REAL NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  bitget_client_oid TEXT,
  bitget_order_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX crypto_auto_orders_user_time_idx ON crypto_auto_orders(user_id, created_at);
--> statement-breakpoint
CREATE INDEX crypto_auto_orders_status_idx ON crypto_auto_orders(status, updated_at);
