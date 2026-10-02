-- 潛力幣雷達的 4 小時吃大魚計算結果；由獨立排程寫入、雷達唯讀。只保存公開現貨行情推算的指標，不含帳戶或下單資料。
-- 每個標的在每個現貨來源只保留最新一根 4 小時 K 的結果；計算失敗（如新幣歷史不足）也記錄，避免同一根反覆重試。
CREATE TABLE potential_big_fish (
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  signal_json TEXT,
  error TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (symbol, source)
);
--> statement-breakpoint
CREATE INDEX potential_big_fish_bar_idx ON potential_big_fish(bar_time);
