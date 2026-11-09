-- 玄學羅盤：加密生辰、每日紫微預測快照（上線與回測）、AI 解說快取。不修改任何既有資料表。
CREATE TABLE IF NOT EXISTS user_birth_profiles (
  user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS metaphysics_market_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  market TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  source TEXT NOT NULL,
  direction_score INTEGER NOT NULL,
  turning_strength INTEGER NOT NULL,
  triggers_json TEXT NOT NULL,
  actual_change_pct REAL,
  is_turning_actual INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS metaphysics_forecast_unique ON metaphysics_market_forecasts (market, trade_date, rule_version, source);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS metaphysics_narrative_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0,
  cache_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS metaphysics_narrative_unique ON metaphysics_narrative_cache (user_id, cache_date, kind, rule_version);
