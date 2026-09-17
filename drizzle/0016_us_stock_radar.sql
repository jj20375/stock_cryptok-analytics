-- 美股潛力雷達只保存公開行情分析、研究績效及獨立 Slack 通知，不含券商帳戶或交易憑證。
CREATE TABLE us_stock_radar (
  symbol TEXT PRIMARY KEY NOT NULL,
  snapshot_json TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE us_stock_observations (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  observation_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX us_stock_observations_entered_idx
  ON us_stock_observations(entered_at);
--> statement-breakpoint
CREATE TABLE us_stock_radar_run (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  summary_json TEXT
);
--> statement-breakpoint
CREATE TABLE us_stock_radar_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  message TEXT NOT NULL,
  sent_at INTEGER
);
--> statement-breakpoint
CREATE INDEX us_stock_radar_notifications_pending_idx
  ON us_stock_radar_notifications(sent_at, detected_at);
