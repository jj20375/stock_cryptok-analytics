-- 獨立美股 rToken 報告與 Slack 去重佇列；不修改持倉、授權或交易設定。
CREATE TABLE IF NOT EXISTS stock_token_radar_run (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  report_json TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS stock_token_notices (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  candidate_json TEXT NOT NULL,
  sent_at INTEGER
);
