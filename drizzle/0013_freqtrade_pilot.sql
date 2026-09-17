-- Freqtrade 試點只保存經驗證的研究與模擬績效；不保存交易金鑰、API 密碼或下單指令。
CREATE TABLE freqtrade_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  exchange TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  research_json TEXT DEFAULT '{}' NOT NULL,
  synced_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX freqtrade_runs_generated_at_idx ON freqtrade_runs(generated_at);
