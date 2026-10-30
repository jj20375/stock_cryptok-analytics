-- Solana 迷因幣防 Rug 戰情室（Meme Desk）：儲存 14 關審查紀錄、模擬持倉與分批平倉帳本。
CREATE TABLE IF NOT EXISTS meme_desk_checks (
  id TEXT PRIMARY KEY NOT NULL,
  checked_at INTEGER NOT NULL,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  stage TEXT NOT NULL,
  verdict TEXT NOT NULL,
  confidence REAL,
  reason TEXT NOT NULL,
  price_usd REAL,
  liquidity_usd REAL,
  pair_url TEXT,
  facts_json TEXT,
  pool_json TEXT,
  judge_json TEXT
);
CREATE INDEX IF NOT EXISTS meme_desk_checks_checked_idx ON meme_desk_checks (checked_at);
CREATE INDEX IF NOT EXISTS meme_desk_checks_mint_idx ON meme_desk_checks (mint);

CREATE TABLE IF NOT EXISTS meme_desk_positions (
  mint TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  entry_price REAL NOT NULL,
  initial_qty REAL NOT NULL,
  remaining_qty REAL NOT NULL,
  peak_price REAL NOT NULL,
  initial_liquidity_usd REAL NOT NULL,
  last_price REAL NOT NULL,
  last_liquidity_usd REAL NOT NULL,
  opened_at INTEGER NOT NULL,
  steps INTEGER NOT NULL DEFAULT 0,
  ticket_usd REAL NOT NULL,
  pair_url TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meme_desk_trades (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  usd REAL NOT NULL,
  price REAL NOT NULL,
  pnl REAL NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meme_desk_trades_created_idx ON meme_desk_trades (created_at);
CREATE INDEX IF NOT EXISTS meme_desk_trades_mint_idx ON meme_desk_trades (mint, created_at);
