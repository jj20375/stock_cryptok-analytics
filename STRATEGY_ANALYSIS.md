# 股市與加密貨幣交易策略分析 (Strategy Analysis)

本文件詳述本專案中實作的自動化交易與篩選策略。

## 1. 加密貨幣：RSI 超跌均線回歸策略 (Binance RSI Strategy)

### 策略邏輯
- **監控標的**：BTC, ETH, SOL, ADA, DOGE, XRP, SUI, AVAX (USDT 交易對)。
- **時間週期**：使用者自訂 (預設 15m)。
- **進場條件 (BUY)**：
  - RSI (14) < 20 (進入極度超賣區)。
  - 價格偏離 20MA (20日均線) 超過 10% (即 `CurrentPrice < MA20 * 0.9`)。
- **出場條件 (SELL)**：
  - 價格回升並觸及或突破 20MA (即 `CurrentPrice >= MA20`)。

### 執行方式
- 透過 Cloudflare Workers Cron Triggers 每 15 分鐘執行一次 `strategyEngine.ts`。
- 支援「模擬 (PAPER)」與「實戰 (LIVE)」模式。
- 透過 Telegram Bot 送出即時成交通知。

---

## 2. 台股：日成交量暴增篩選策略 (Daily Volume Surge)

### 策略邏輯
- **監控標的**：台股上市前 50 大成交量股票。
- **篩選條件**：
  - **成交量暴增**：今日總成交量 > 近 5 日平均成交量 (5MV) 的 **2 倍** 以上。
  - **技術面**：目前股價尚未突破壓力線 (如近 20 日高點或季線)。
- **執行頻率**：每日一次 (建議在收盤後執行以取得完整日成交量)。

### 資料來源
- **TWSE API**：取得每日收盤行情與成交量排名。
- **Yahoo Finance API**：取得歷史日 K 線以計算 5MV 與壓力線。
- **Fugle API (評估中)**：若需要更精準的盤中即時數據與大戶吃貨軌跡 (內外盤比)，建議整合此服務。

---

## 3. AI 輔助分析 (Gemini AI Analysis)
- **服務**：Google Gemini 2.0 Flash。
- **功能**：根據抓取到的 K 線數據與指標，提供自然語言的盤勢分析與投資建議。
