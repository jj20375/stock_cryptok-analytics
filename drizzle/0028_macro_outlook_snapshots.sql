-- 市場漲跌走勢羅盤預測快照：記錄每次判讀的時間、結論與原始輸入，供事後檢討與命中率統計。
-- 只存公開行情數值，不含帳戶資料；API_VIEW 保留 180 天、TW_PREOPEN 長期保留。
CREATE TABLE IF NOT EXISTS macro_outlook_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('TW_PREOPEN','API_VIEW')),
  tw_direction TEXT NOT NULL,
  tw_score INTEGER NOT NULL,
  us_direction TEXT NOT NULL,
  us_score INTEGER NOT NULL,
  crypto_direction TEXT NOT NULL,
  crypto_score INTEGER NOT NULL,
  missing_sources TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  pillars_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS macro_outlook_snapshots_created_idx ON macro_outlook_snapshots (created_at);
CREATE INDEX IF NOT EXISTS macro_outlook_snapshots_source_idx ON macro_outlook_snapshots (source, created_at);
