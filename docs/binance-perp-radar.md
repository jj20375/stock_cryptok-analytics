# 永續吃大魚雷達

這個排程讀取 Gate USDT 永續合約的公開 Mark Price 15 分 K 線，不使用 TradingView Webhook，也不需要交易所 API key。它只發送觀察通知，不連接交易帳戶、不建立持倉，也不會自動下單。

原先版本使用 Binance USD-M `fapi.binance.com`，但正式 Cloudflare Worker 對 Binance 主網域、`fapi1` 至 `fapi4` 及資料專用端點均收到 HTTP 403，造成每輪實際掃描零檔。Bybit 也因 Cloudflare 出口地區限制回覆 403。Gate 的主站與期貨備援端點已在相同 Cloudflare 遠端執行環境驗證成功，因此正式來源改為 Gate，通知必須如實標示 Gate；結果可能和 TradingView 的 Binance 圖略有差異。

## 掃描方式

- 每根 15 分 K 線收盤後一分鐘執行，cron 為 `1,16,31,46 * * * *`（UTC 分鐘與台北分鐘相同）。
- 僅保留 Gate USDT 永續 ticker 中格式有效的合約；排除穩定幣、貴金屬與名稱可辨識的槓桿代幣。
- 24 小時名目成交額至少 500 萬 USDT。每輪最多 32 檔：8 檔正漲幅領先、4 檔負跌幅領先、8 檔高成交額，其餘用輪替補足。跌幅榜只取得掃描資格，仍須符合原始吃大魚條件才通知；這可涵蓋 BR 類深跌後首次翻綠，但仍不是全市場逐幣完整掃描。
- 每檔取得最多 1000 根已收盤 Mark Price 15 分 K 線。缺根、重複、價格無效、歷史少於 201 根或最新收盤尚未就緒時，該檔本輪失敗且不產生訊號。
- Mark Price K 線沒有真實成交量。吃大魚 2.0 只使用 OHLC、MACD、EMA200、ATR 與 Supertrend，因此程式不以其他成交量資料冒充 Mark Price 成交量。

## 通知條件

策略沿用 `big-fish-2.0-15m-v1`：

- MACD（12、26、9）當根金叉且收盤高於 EMA200 × 0.98；或
- Supertrend（ATR 10、係數 4）由紅翻綠。

這裡發送的是原始 15 分觸發，不套用現貨潛力幣雷達的掛單深度與 4 小時／日線共振。若 MACD 金叉發生時 Supertrend 仍是紅色，訊息會同時顯示「衝突警示」；這反映提供的 Pine 條件本來可能同時出現進場與多單出場狀態。

為了凸顯 AIN／PONS 截圖所呈現的底部啟動型態，通知分成三層，但不改寫上述原始進場條件：

- ⭐ 最佳型：Supertrend 至少連續紅色 16 根（4 小時）後首次翻綠，觸發價距 EMA200 介於 -5% 到 +10%，距 Supertrend 防守線不超過 12%，且觸發前 4 小時漲跌介於 -3% 到 +8%、前 24 小時介於 -15% 到 +15%。
- 🟢 趨勢翻綠型：確實由紅翻綠，但沒有通過全部最佳型門檻。
- 🟣 一般 MACD 提早型：只有 MACD 金叉分支成立。

Slack 每輪仍最多送三則；待發佇列會先送最佳型，再送其他翻綠及一般 MACD 訊號。同級依偵測時間排序，低層級訊號不會被刪除。這些門檻是依使用者指出的型態建立的第一版風控，尚未經足夠的樣本外回測，`最佳型` 代表形態最接近，不代表保證上漲。

每輪會重算最近四根已收盤 K 線，以便輪替或短暫停機後補回最近一小時。事件 ID 綁定來源、合約、K 線時間與規則版本，同一根不會因重跑重複入列。Slack 暫時失敗或限流時保留在 `binance_perp_alerts`，後續排程每輪最多補送三則；歷史補送會明確標示時間風險。

不同圖表的歷史起點、價格精度、指標暖機及資料修訂仍可能造成少量差異。這個功能沒有驗證勝率，也不表示槓桿永續適合進場。

## 啟用與驗證

1. 使用 Node.js v20.19.6。
2. 套用 `drizzle/0015_binance_perp_radar.sql`：本機執行 `npm run db:migrate:local`，正式環境依既有發布流程執行 `npm run db:migrate:remote`。
3. `wrangler.toml` 的 `BINANCE_PERP_RADAR_ENABLED` 設為 `true`，並沿用正式 Worker 的 `SLACK_API_TOKEN` 與 `SLACK_CHANNEL_ID` secrets。
4. 建置並部署後，確認 Cloudflare Cron 已出現 `1,16,31,46 * * * *`。
5. 可查詢 `binance_perp_run.summary_json` 檢查最近一輪的合格數、選取數、成功／失敗、`signals` 與 `bestSignals`；待發訊息可在 `binance_perp_alerts` 以 `sent_at IS NULL` 檢查。

本機測試不會連接正式 Gate、D1 或 Slack：

```sh
node --import tsx --test tests/binance-perp-radar.test.ts
node --import tsx --test tests/binance-perp-quality.test.ts
npm run build
npx wrangler deploy --dry-run
```
