# 程式拆解計畫

本文件列出目前已超過 1000 行或接近風險線的檔案，以及建議拆分方式。後續 Claude、Codex、Antigravity、Antigravity IDE 接手時，應優先依此計畫處理。

## 優先順序

1. `app/routes/home.tsx` 已完成第一階段拆解，後續只允許保留頁面容器、狀態串接與必要 lifecycle。
2. 接著拆 `app/services/stockService.ts`，因為它同時包含資料抓取、技術指標、策略判斷與市場工具函式。
3. 拆分時保持每個新檔案低於 800 行，避免剛拆完又接近 1000 行上限。

## `app/routes/home.tsx` 拆解方向

狀態：第一階段已完成，頁面檔已低於 1000 行。

目標：後續可再將頁面檔縮到 500 行以內，只保留頁面組裝、狀態串接與主要事件處理。

建議拆分：

- `app/features/home/constants/markets.ts`：市場清單、股票清單與預設選項。
- `app/features/home/types.ts`：首頁專用型別，例如掃描結果、AI 策略結果與策略圖層型別。
- `app/features/home/strategy-overlays.ts`：策略圖層定義、事件建立、布林帶計算與策略 overlay 建立。
- `app/features/home/components/StrategyLayerPanel.tsx`：策略圖層切換 UI。
- `app/features/home/components/HomeHeader.tsx`：首頁搜尋、切換市場與刷新按鈕。
- `app/features/home/components/LeftSidebar.tsx`：選股、持股、交易訊號、AI 策略與技術指標。
- `app/features/home/components/MainChartPanel.tsx`：價格摘要、指標切換、策略圖層與 K 線圖容器。
- `app/features/home/components/MarketHotPicks.tsx`：市場掃描策略面板與 Top 10 結果。
- `app/features/home/ai-prompts.ts`：Gemini strategy/scanner prompt 組裝。
- `app/features/home/components/KlineChart.tsx`：K 線圖初始化、資料套用、技術指標與 overlay 渲染。
- `app/features/home/components/MarketScanner.tsx`：市場掃描 UI 與掃描結果列表。
- `app/features/home/components/PortfolioPanel.tsx`：投資組合顯示、加入與移除。
- `app/features/home/components/AiStrategyPanel.tsx`：AI 分析與策略建議區塊。
- `app/features/home/hooks/useHomeMarketData.ts`：目前市場、股票、K 線資料與時間週期狀態。
- `app/features/home/hooks/useStrategyLayers.ts`：策略圖層計算、可見區間過濾與啟用狀態。
- `app/features/home/hooks/usePortfolioActions.ts`：投資組合 API 操作。

拆分順序：

1. 先搬出型別、常數與策略圖層工具，這一步風險最低。
2. 再搬出策略圖層 UI 與 K 線圖 component。
3. 最後拆掃描、投資組合與 AI 分析區塊。

## `app/services/stockService.ts` 拆解方向

目標：將服務檔拆成多個單責任模組，避免技術指標、資料抓取與策略判斷互相混在一起。

建議拆分：

- `app/services/marketData/yahooFinance.ts`：Yahoo Finance 歷史 K 線與報價抓取。
- `app/services/marketData/twse.ts`：台股 TWSE 資料抓取與格式轉換。
- `app/services/indicators/movingAverage.ts`：MA、EMA 與成交量均線。
- `app/services/indicators/momentum.ts`：RSI、KD、MACD。
- `app/services/indicators/volatility.ts`：ATR、Supertrend、布林帶。
- `app/services/strategies/trendMomentum.ts`：趨勢動能策略。
- `app/services/strategies/consecutiveVolume.ts`：連續爆量策略。
- `app/services/strategies/volumeNoBreakout.ts`：量增未破策略。
- `app/services/strategies/extremeReversal.ts`：極值反彈策略。
- `app/services/strategies/bigFish.ts`：吃大魚策略。
- `app/services/stockService.ts`：保留向後相容的 re-export，避免一次改壞所有 import。

拆分順序：

1. 先抽出純函式技術指標，因為最容易測試且副作用最低。
2. 再抽出策略判斷，讓 UI 與排程能共用同一套策略邏輯。
3. 最後抽資料抓取，避免影響 Yahoo/TWSE/Binance 的資料流程。

## 註解補強重點

- 策略門檻：例如 RSI 15/85、EMA200、Supertrend factor、ATR 週期，都要註明用途與風險。
- 時間週期：例如 `15m`、`60m`、`4h`、`1d` 要註明用於短線、波段或日報。
- 排程時間：台股、美股與加密貨幣排程必須標註時區。
- 副作用：Slack、Telegram、資料庫寫入與下單 API 必須註明可能失敗與重試策略。
- 回測與提示：策略圖層是視覺提示，不等於保證獲利，必須在註解中避免誤解。

## 驗收標準

- `app/routes/home.tsx` 小於 1000 行，目標小於 500 行。
- `app/services/stockService.ts` 小於 1000 行，目標只保留 re-export 或相容 API。
- 新增檔案單檔小於 800 行。
- 所有重要變數與策略門檻都有繁體中文註解。
- `npm run build` 通過。
