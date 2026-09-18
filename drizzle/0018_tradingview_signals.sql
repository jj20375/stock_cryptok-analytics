-- TradingView 外部訊號的落地紀錄與紙上配對交易；只保存訊號本身與公開行情價格，不含券商帳戶或下單資料。
-- 原始 log 體積大（含 payload），由排程保留 60 天；配對後的交易紀錄極小，保留較久以維持長期績效統計。
CREATE TABLE tradingview_signals (
  id TEXT PRIMARY KEY NOT NULL,
  received_at INTEGER NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT,
  price REAL,
  note TEXT,
  status TEXT NOT NULL,
  slack_ok INTEGER,
  trade_effect TEXT,
  raw_body TEXT,
  error TEXT
);
--> statement-breakpoint
CREATE INDEX tradingview_signals_received_idx ON tradingview_signals(received_at);
--> statement-breakpoint
-- 一筆 = 一次完整進出場；未平倉時 exit 欄位為 NULL，報酬率不得以 0 代替缺值。
CREATE TABLE tradingview_trades (
  id TEXT PRIMARY KEY NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_at INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  entry_note TEXT,
  exit_at INTEGER,
  exit_price REAL,
  exit_note TEXT,
  return_pct REAL,
  closed INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX tradingview_trades_open_idx ON tradingview_trades(market, symbol, closed);
--> statement-breakpoint
CREATE INDEX tradingview_trades_entry_idx ON tradingview_trades(entry_at);
