-- 30 USDT 僅為測試名目額度；正式資金依交易所餘額與原有風控分配。
-- 舊設定保留測試額度並停止新倉，改用全倉前必須由使用者重新儲存授權。
ALTER TABLE crypto_futures_automation ADD COLUMN test_mode INTEGER NOT NULL DEFAULT 1 CHECK (test_mode IN (0,1));
ALTER TABLE crypto_futures_automation ADD COLUMN position_pct REAL NOT NULL DEFAULT 5 CHECK (position_pct >=3 AND position_pct <=5);
ALTER TABLE crypto_futures_automation ADD COLUMN max_open_positions INTEGER NOT NULL DEFAULT 3 CHECK (max_open_positions >=1 AND max_open_positions <=3);
UPDATE crypto_futures_automation SET enabled=0, updated_at=updated_at+1;
