-- 台股雷達只保存 Yahoo／證交所公開行情、研究績效與獨立 Slack 通知，不含券商帳戶或下單資料。
CREATE TABLE tw_stock_radar (
  symbol TEXT PRIMARY KEY NOT NULL,
  snapshot_json TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE tw_stock_observations (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  observation_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX tw_stock_observations_entered_idx ON tw_stock_observations(entered_at);
--> statement-breakpoint
CREATE TABLE tw_stock_radar_run (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  summary_json TEXT
);
--> statement-breakpoint
CREATE TABLE tw_stock_radar_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  message TEXT NOT NULL,
  sent_at INTEGER
);
--> statement-breakpoint
CREATE INDEX tw_stock_radar_notifications_pending_idx ON tw_stock_radar_notifications(sent_at, detected_at);
