-- Demo 自動化獨立授權；預設不啟用，不變更既有帳戶的 LIVE 或通知設定。
CREATE TABLE crypto_futures_automation (
  user_id INTEGER PRIMARY KEY REFERENCES users(id), enabled INTEGER NOT NULL DEFAULT 0,
  symbols_json TEXT NOT NULL DEFAULT '["BTCUSDT","ETHUSDT"]', strategy_id TEXT NOT NULL DEFAULT 'futures_trend_retest',
  fee_rate REAL NOT NULL DEFAULT 0.0006,
  scan_state_json TEXT NOT NULL DEFAULT '{}', lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER, last_error TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE crypto_futures_automation_events (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), symbol TEXT NOT NULL, strategy_id TEXT NOT NULL,
  signal_at INTEGER NOT NULL, intent TEXT NOT NULL, price REAL NOT NULL, reason TEXT NOT NULL,
  stop_price REAL, target_price REAL, order_status TEXT NOT NULL DEFAULT 'PENDING', order_reason TEXT,
  notification_status TEXT NOT NULL DEFAULT 'PENDING', delivery_lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX futures_auto_events_user_time ON crypto_futures_automation_events(user_id, signal_at);
CREATE INDEX futures_auto_events_pending ON crypto_futures_automation_events(next_attempt_at);
CREATE TABLE crypto_futures_automation_candles (symbol TEXT PRIMARY KEY, candles_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX crypto_auto_orders_user_event ON crypto_auto_orders(user_id, source_event_id, execution_mode);
