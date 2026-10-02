-- 使用者設定的是槓桿上限而非保證槓桿；實際下單還會受每個合約的 Bitget maxLever 限制。
-- 預設 1 倍可確保既有使用者升級後不會自動提高槓桿。
ALTER TABLE users ADD COLUMN bitget_demo_max_leverage INTEGER NOT NULL DEFAULT 1;
