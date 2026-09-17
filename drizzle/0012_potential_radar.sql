-- 潛力幣雷達只保存公開行情與研究紀錄，不影響既有交易資料。
CREATE TABLE potential_radar (
  symbol TEXT PRIMARY KEY NOT NULL,
  snapshot_json TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE potential_observations (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  observation_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX potential_observations_entered_idx ON potential_observations(entered_at);
--> statement-breakpoint
CREATE TABLE potential_run (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  summary_json TEXT
);
