# Bitget 合約自動交易（Demo／LIVE）

## 目前範圍

- 支援 Bitget 官方 Demo 與 LIVE；兩種環境使用互不共用的獨立 API Key、Secret 與 Passphrase。
- 只做 Bitget USDT 永續合約多單，固定逐倉、不做空；出場只呼叫指定 long 的平倉端點。
- 預設為 DEMO。LIVE 必須同時選擇 LIVE 模式、填妥正式合約專用憑證，並開啟「允許 LIVE 真實下單」。
- 可設定 1 至 50 倍槓桿上限；每個合約進場時取「使用者上限」與 Bitget `maxLever` 的較小值。
- 槓桿僅降低所需保證金，名目倉位仍受單筆風險 0.25% 與部位上限 5% 約束，不會因提高倍數自動放大。
- TradingView 與系統自己的 4 小時線「吃大魚 2.0」（2026-10-02 由 15 分改為 4 小時）共用同一套去重、部位與本金風控。
- 系統訊號只讓 `BEST` 與 `TREND_FLIP` 開倉；`EARLY_MACD` 保留 Slack 通知，不自動開倉。
- 單筆風險硬上限為本金 0.25%，名目部位硬上限為本金 5%；使用者原設定更保守時採更保守值。
- 每張開多委託都帶 Bitget 原生停損；五分鐘排程再以永續 Mark Price 備援檢查。
- 出場一律呼叫「平倉」端點並指定 long，不送一般 sell 開倉單，因此不會由本系統建立空單。
- 合約開多、平多與停損結果優先發往 `CRYPTO_FUTURES_TRADE_SLACK_CHANNEL_ID`；一般虛擬幣雷達仍使用 `CRYPTO_ENTRY_SLACK_CHANNEL_ID`。

## Demo 啟用方式

1. 在 Bitget 切換至 Demo 模式，於 Demo API 管理建立一組 API Key、Secret 與 Passphrase。
2. 到本系統「個人設定與 API 綁定」，在 Bitget USDT 永續區選擇 `DEMO`。
3. 將三項資料填在「Demo 專用憑證」。
4. 先只開一個來源：`TradingView 吃大魚訊號` 或 `系統自己的吃大魚訊號`。
5. 在「合約槓桿上限」填入 1 至 50；例如填 50，而該幣 Bitget 最高 20 倍時，系統會以 20 倍進場。
6. 儲存後等待下一個已收盤訊號，並在 Bitget Demo 的 USDT 永續訂單、持倉與 Slack 核對。

## LIVE 啟用方式

1. 先在 Demo 累積訊號、成交、停損及去重對帳結果。
2. 另建一組 Bitget 正式 API 憑證，只授予 Read／Trade，不開啟提領。若主機具固定出口 IP，再設定 Bitget IP 白名單。
3. 將三項憑證填入「正式合約專用憑證」，正式盤槓桿上限建議先設 `1`。
4. 將合約模式切為 `LIVE`，再開啟本金保護區的「允許 LIVE 真實下單」。兩項缺一都不會建立真實新倉。
5. 關閉 LIVE 授權會停止新開倉；既有正式多單仍可由原生停損、五分鐘備援或出場訊號平倉。

切換 Demo／LIVE 不會搬用另一組憑證，稽核去重鍵也包含執行環境；同一來源訊號在兩種環境各自留一筆紀錄。

一般 Cloudflare Workers 沒有帳戶專用固定出口 IP；需要嚴格 IP 白名單時，應把正式下單請求轉到固定 IP 的小型執行服務，或使用 Cloudflare 的 Dedicated Egress 類企業方案。Demo 掃描與通知仍可留在 Workers。

既有 TradingView payload 的 `symbol`、`action`、`price` 已足夠；若要讓稽核更準確，可改成：

```json
{
  "event_id": "{{ticker}}-{{time}}-{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}},
  "time": "{{time}}",
  "note": "吃大魚 2.0"
}
```

TradingView 改動策略程式或 Alert 訊息後，必須刪除並重建 Alert，舊 Alert 不會自動套用新快照。

## 不使用 TradingView

可以。永續雷達每根 4 小時 K 收盤後自行抓 Binance Mark Price；Cloudflare 地區無法連線時整批改用 Gate。它用與 Pine 版相同的 MACD、EMA200、ATR 10／係數 4 Supertrend 條件計算，直接建立內部事件並交給目前選定的合約環境，因此不需要 TradingView 方案或 Webhook。

訊號行情來源與 Bitget 實際成交交易所不同，歷史長度、Mark Price 與成交價定義也可能讓結果和 TradingView 有少量差異，應先累積 Demo 對帳結果，再評估正式盤執行器。

## JEV 決策

目前不接入交易路徑。JEV 社群站的 API Center 標示 API Key 與 Server SDK 尚未推出，而且它是通用結構化 AI 輸出，不是交易所執行或風控服務。即使日後 API 可用，也只適合放在第二意見或否決層；固定停損、單筆風險、每日虧損與重複下單保護仍由確定性程式掌管。

- JEV 社群文件：https://www.jevai.org/zh/docs
- JEV API Center：https://www.jevai.org/zh/jev-api
- Bitget Demo API：https://www.bitget.com/docs/classic/demo-trading/rest-api
- Bitget USDT 永續下單：https://www.bitget.com/api-doc/classic/contract/trade/Place-Order
- Bitget 平倉：https://www.bitget.com/docs/catalog/classic-contract-trade/classic-contract-trade
