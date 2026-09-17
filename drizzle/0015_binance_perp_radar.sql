-- Binance 永續吃大魚雷達只保存排程狀態與已格式化公開行情訊息，不含帳戶、交易或憑證資料。
CREATE TABLE binance_perp_run (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  summary_json TEXT
);
--> statement-breakpoint
CREATE TABLE binance_perp_alerts (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  message TEXT NOT NULL,
  sent_at INTEGER
);
--> statement-breakpoint
CREATE INDEX binance_perp_alerts_pending_idx
  ON binance_perp_alerts(sent_at, detected_at);
