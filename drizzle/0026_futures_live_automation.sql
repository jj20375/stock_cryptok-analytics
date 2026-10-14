-- 原有設定只繼續作 Demo；資料庫更新不能將任何帳戶自動轉成正式盤。
ALTER TABLE crypto_futures_automation ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'DEMO' CHECK (execution_mode IN ('DEMO', 'LIVE'));
ALTER TABLE crypto_futures_automation ADD COLUMN max_notional_usdt REAL NOT NULL DEFAULT 30 CHECK (max_notional_usdt >= 5 AND max_notional_usdt <= 30);
ALTER TABLE crypto_futures_automation_events ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'DEMO' CHECK (execution_mode IN ('DEMO', 'LIVE'));
