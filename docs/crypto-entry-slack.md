# 虛擬幣訊號通知（目前停用）

2026-10-04 起，`CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED=false`：以下虛擬幣觀察訊號全部停用，包含舊佇列補送與 TradingView。行情／研究紀錄保留；自動掃描與新倉也停用，既有持倉保護另行保留。詳見 [股票訊號重點調整](stock-signal-focus.md)。

以下是未來明確重新設為 `true` 時才適用的頻道設定。

虛擬幣訊號改用獨立的 `CRYPTO_ENTRY_SLACK_CHANNEL_ID`。它涵蓋 4 小時 Gate 永續吃大魚、潛力幣雷達、4 小時波段雷達、策略引擎的虛擬幣進出場與 TradingView 外部虛擬幣訊號。股市日報繼續使用原本的 `SLACK_CHANNEL_ID`，美股潛力雷達則使用 `US_STOCK_SLACK_CHANNEL_ID`。

不需要建立新的 Incoming Webhook。建立「虛擬幣即時進場價格」頻道後，邀請現有 Slack Bot，取得以 `C` 開頭的 Channel ID，再設定：

```sh
npx wrangler secret put CRYPTO_ENTRY_SLACK_CHANNEL_ID
```

雷達通知改為精簡 Block Kit 卡片，主要呈現訊號、進場參考價、收盤時間、失效參考、重點與單行風險。詳細指標仍保留在站內雷達頁。舊佇列若需補送，會縮成最多四段文字，避免新頻道被長訊息洗版。
