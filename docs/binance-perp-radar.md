# 永續吃大魚雷達

這個排程自行讀取 USDT 永續合約的公開 Mark Price 4 小時 K 線（2026-10-02 由 15 分改為 4 小時，以較少訊號換取較少假突破），不依賴 TradingView Webhook，也不需要交易所 API key。它只發送觀察通知，不連接交易帳戶、不建立持倉，也不會自動下單。

系統會先嘗試 Binance USD-M `fapi.binance.com`，讓資料盡量對齊 TradingView 的 Binance `.P Mark Price`。正式 Cloudflare Worker 曾對 Binance 期貨端點收到 HTTP 403，因此市場清單或首檔 K 線失敗時，整個分片會自動改用已驗證可連線的 Gate；同一分片不會混用兩個來源。Slack 卡片與執行摘要會如實標示實際來源，Gate 結果可能和 TradingView 略有差異。

## 掃描方式

- Cron 仍每 15 分鐘在第 1、2、3、4 分鐘喚醒四個互斥分片，但每個分片在同一根 4 小時 K 線只要成功一次就略過，實際行情掃描每 4 小時各一次；失敗的分片利用之後的 15 分槽位自動重試。完成紀錄存在摘要的 `completedShards`。每批最多 32 檔，合計最多 128 檔，單次 Worker 仍低於免費方案 50 次子請求上限。
- 僅保留來源中格式有效的 USDT 永續；排除穩定幣、貴金屬與名稱可辨識的槓桿代幣。
- 24 小時名目成交額至少 500 萬 USDT。排名會優先納入 8 檔正漲幅領先、4 檔負跌幅領先與高成交額標的，再以每根 K 線固定輪替補足。穩定雜湊確保同一幣只屬於一個分片；跌幅榜只取得優先權，仍須符合原始吃大魚條件才通知。
- 每檔取得最多 1000 根已收盤 Mark Price 4 小時 K 線，只判斷最新一根。缺根、重複、價格無效或最新收盤尚未就緒時該檔本輪失敗；歷史少於 201 根（約 34 天，新上市合約）記為「略過」，不算失敗、不觸發分片重試，也不會被誤判成 Binance 遭封鎖而整批切到 Gate。
- Mark Price K 線沒有真實成交量。吃大魚 2.0 只使用 OHLC、MACD、EMA200、ATR 與 Supertrend，因此程式不以其他成交量資料冒充 Mark Price 成交量。

## 通知條件

策略沿用 `big-fish-2.0-15m-v1`：

- MACD（12、26、9）當根金叉且收盤高於 EMA200 × 0.98；或
- Supertrend（ATR 10、係數 4）由紅翻綠。

這裡發送的是原始 4 小時觸發，不套用現貨潛力幣雷達的掛單深度與 4 小時／日線共振。若 MACD 金叉發生時 Supertrend 仍是紅色，訊息會同時顯示「衝突警示」；這反映提供的 Pine 條件本來可能同時出現進場與多單出場狀態。

為了凸顯 AIN／PONS 截圖所呈現的底部啟動型態，通知分成三層，但不改寫上述原始進場條件：

- ⭐ 最佳型：Supertrend 至少連續紅色 16 根（4 小時）後首次翻綠，觸發價距 EMA200 介於 -5% 到 +10%，距 Supertrend 防守線不超過 12%，且觸發前 4 小時漲跌介於 -3% 到 +8%、前 24 小時介於 -15% 到 +15%。
- 🟢 趨勢翻綠型：確實由紅翻綠，但沒有通過全部最佳型門檻。
- 🟣 一般 MACD 提早型：只有 MACD 金叉分支成立。

每個分片完成後最多立即送一則；每五分鐘的待發佇列再補送一則。待發訊號會先送最佳型，再送其他翻綠及一般 MACD 訊號；新的收盤批次出現後，尚未送出的舊批次會捨棄，避免即時頻道出現失效進場價。這些門檻尚未經足夠的樣本外回測，`最佳型` 代表形態最接近，不代表保證上漲。

每輪會重算最近四根已收盤 K 線，以便輪替或短暫停機後補回最近一小時。事件 ID 綁定來源、合約、K 線時間與規則版本，同一根不會因重跑重複入列。Slack 暫時失敗或限流時保留在 `binance_perp_alerts`，由五分鐘佇列接續處理。

不同圖表的歷史起點、價格精度、指標暖機及資料修訂仍可能造成少量差異。這個功能沒有驗證勝率，也不表示槓桿永續適合進場。

## 啟用與驗證

1. 使用 Node.js v20.19.6。
2. 套用 `drizzle/0015_binance_perp_radar.sql`：本機執行 `npm run db:migrate:local`，正式環境依既有發布流程執行 `npm run db:migrate:remote`。
3. `wrangler.toml` 的 `BINANCE_PERP_RADAR_ENABLED` 設為 `true`，並沿用正式 Worker 的 `SLACK_API_TOKEN` 與 `CRYPTO_ENTRY_SLACK_CHANNEL_ID` secrets。
4. 建置並部署後，確認合併 Cron 含有每季第 `+1` 至 `+4` 分鐘的四個永續分片。
5. 可查詢 `binance_perp_run.summary_json` 檢查最近分片的 `source`、`shardIndex`、合格數、選取數、成功／失敗、`signals` 與 `bestSignals`；待發訊息可在 `binance_perp_alerts` 以 `sent_at IS NULL` 檢查。

本機測試不會連接正式 Gate、D1 或 Slack：

```sh
node --import tsx --test tests/binance-perp-radar.test.ts
node --import tsx --test tests/binance-perp-quality.test.ts
npm run build
npx wrangler deploy --dry-run
```
