-- 跨 Worker 原子限制合約預覽與 Demo 請求；沒有交易或帳戶憑證。
CREATE TABLE IF NOT EXISTS crypto_futures_rate_limits (
  user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id),
  next_at INTEGER NOT NULL
);
