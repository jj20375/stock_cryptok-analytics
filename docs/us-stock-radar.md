# 美股潛力雷達

2026-10-04 起，美股雷達只在週一至週五 UTC 17、18、20、21 點的第 7、22、37、52 分鐘檢查 SPY，涵蓋紐約夏令／冬令收盤時段；其餘時段不建立雷達排程。只在新的 4 小時／正常交易時段收盤段完成時執行完整掃描。資料來自 Yahoo Finance 公開行情，只做觀察、績效追蹤與 Slack 通知，不會呼叫券商或下單服務。

## 訊號

- 經典吃大魚 2.0：4 小時 MACD（12／26／9）金叉且收盤高於 EMA200 × 0.98，或 Supertrend（ATR 10、係數 4）翻綠。兩條件維持 OR 關係，再由已收盤日線 EMA20／EMA50 確認方向。
- 量價結構：4 小時放量突破、突破後回踩續強，以及接近突破位的提前關注。
- 趨勢品質：個股日線 EMA20／EMA50、SPY 日線趨勢、近 20 日相對 SPY 報酬、RSI 與 MACD 動能。
- 流動性：股價至少 2 美元，前 20 個交易日平均成交額至少 2,000 萬美元。
- 過熱：距 4 小時 EMA20 超過 3 ATR，或當日漲幅超過 15%，不發進場型通知。

雷達每輪從 Yahoo 當日漲幅榜與成交活躍榜挑選，再加入 AAPL、NVDA、TSLA、TSLL、COIN 等固定池輪替。有限掃描代表空榜不等同全市場沒有訊號。

## Slack 獨立頻道

沿用現有 `SLACK_API_TOKEN`，不需要建立另一個 Incoming Webhook。請在 Slack 建立美股頻道、邀請同一個 Bot，再將頻道 ID 設為 Worker secret：

```sh
npx wrangler secret put US_STOCK_SLACK_CHANNEL_ID
```

程式刻意不使用 `SLACK_CHANNEL_ID` 作為備援，避免美股訊號誤發到虛擬幣頻道。未設定新頻道時，掃描與頁面仍會運作，但不建立或發送 Slack 訊息。

## 資料庫與部署

```sh
npm run db:migrate:remote
npm run deploy
```

資料庫沿用 `0016_us_stock_radar.sql`。通知會先寫入 D1，Slack 成功回應後才標記已送；新批次出現時會捨棄尚未送出的舊批次，避免即時頻道出現歷史進場價。


## TradingView 對齊與通知時效

- 合成 K 線依紐約當地 09:30 開盤對齊；每段需完整的小時 K，缺資料時捨棄該段，不跨段拼接。提早收盤日缺少完整正常時段資料時暫不通知。
- 日線以正常交易時段 16:00 收盤確認，不再誤延後至 16:30。收盤後的排程抓取提供定版緩衝。
- 新事件與補送佇列皆只允許收盤後 35 分鐘內送出；同根不重建通知。
- 美股直接呼叫共用的 `app/services/strategy/bigFish.ts` 自行計算；通知標示「系統自算」，不需要 TradingView 訂閱、API 或 Webhook。外部 TradingView 入口預設停用。
- 原始吃大魚 OR 公式保留；以手算 Supertrend 與獨立 EMA 閉式加權和驗證。Yahoo 資料、歷史暖機、日線篩選、復權與交易時段設定仍可能使自算訊號與 TradingView 有差異，未宣稱完整逐根一致。

完整設定及排程差異見 [股票訊號重點調整](stock-signal-focus.md)。
