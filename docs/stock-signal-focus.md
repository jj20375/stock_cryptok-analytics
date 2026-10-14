# 股票訊號重點調整（2026-10-04）

不需要 TradingView 訂閱、API 或 Webhook；股票雷達從公開行情自行計算並發送 Slack。重點為台股、美股吃大魚觀察；保留虛擬幣歷史與手動分析，停止虛擬幣排程掃描、新倉及觀察訊號推播。台股日報的權證已在排行前排除，股票與 ETF 保留。

## Cloudflare 排程

仍使用五個 Cron 定義。原設定每日 1,156 次喚醒，改為平日 314 次、週末 288 次；按完整一週計算約減少 73.5%。這是 Cron 觸發次數，並非 D1 查詢量或實際費用的估計。

| 工作 | 觸發方式 | 平日次數 |
| --- | --- | ---: |
| 台股雷達 | 台北 13:08、13:23、13:38、13:53 | 4 |
| 美股雷達 | UTC 17、18、20、21 點，第 7／22／37／52 分；涵蓋夏令與冬令時間 | 16 |
| 台股日報 | 台北 14:00、14:15 | 2 |
| 美股日報 | UTC 20／21 點 30／45 分，只有紐約 16:30／16:45 實際執行 | 4 |
| 既有持倉保護 | 每五分鐘永續停損；共用每十五分鐘現貨持倉檢查 | 288 |

虛擬幣波段、潛力幣、4 小時吃大魚、永續掃描與通知佇列已從 Worker 排程移除，不會靠「仍喚醒後提前 return」假裝省下觸發。每日 K 線快取也不再自動更新虛擬幣。

每五分鐘保護仍占排程次數，依使用者要求保留。它只處理既有持倉：永續仍保留交易所原生停損與備援；現貨只檢查已持有的現貨代號，不抓固定幣池、不進行 AI 掃描。持倉清空後可另行移除保護 Cron。

COIN、MSTR 等實際美股日線工作及已授權的股票代幣交易沿用原本的股票日報時段，沒有獨立新增 Trigger。截圖中的台股權證與股票代幣是不同商品，本次依截圖排除台股權證。

## 停用範圍

`wrangler.toml` 使用以下設定：

```toml
TRADINGVIEW_WEBHOOK_ENABLED = "false"
CRYPTO_AUTO_SCAN_ENABLED = "false"
CRYPTO_NEW_ENTRIES_ENABLED = "false"
CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED = "false"
WAVE_RADAR_ENABLED = "false"
POTENTIAL_RADAR_ENABLED = "false"
BINANCE_PERP_RADAR_ENABLED = "false"
```

新倉開關同時保護現貨策略及 Bitget Demo／LIVE 永續入口。SELL／停損仍可處理既有持倉；成交與平倉通知獨立保留。舊雷達佇列不補送。TradingView 外部入口停用，在讀取 payload、查詢 D1 或建立背景通知前回覆 410；歷史稽核頁仍保留。

## 系統自行產生吃大魚訊號

1. 證交所／Yahoo 動態名單加上固定股票池；先排除台股權證，再挑本輪標的。
2. 抓取 Yahoo 正常交易時段 1 小時及日線 OHLCV。每段小時 K 必須完整，依交易所開盤時間合成 4 小時／收盤段；排除盤前盤後與未收盤資料。
3. 台股、美股共同呼叫 `app/services/strategy/bigFish.ts`。核心只 import 純技術指標，不讀 TradingView、資料庫或通知服務。
4. 每根已收盤 K 套用既有 Pine 吃大魚條件，再計算日線、流動性與過熱品質。
5. 儲存系統快照與研究紀錄；合格的新觸發寫入 D1 通知佇列，由專屬 Slack 頻道發送，同根不重建事件，過期不補送。

| 項目 | 自算方式 |
| --- | --- |
| EMA200 | 首根收盤作種子，平滑係數 2／201 |
| MACD | 收盤的 EMA12 減 EMA26；訊號線為差值的 EMA9 |
| 提早型 | 前根 MACD 線 ≤ 訊號線、當根 MACD 線 > 訊號線，且收盤 > EMA200 × 0.98 |
| ATR10 | 首十根 True Range 平均；後續採 Wilder 平滑 |
| Supertrend | 以 HL2 ± 4 × ATR10 作基本上下軌，再按前根收盤與上下軌遞迴；紅為 1，綠為 -1 |
| 確認型 | Supertrend 從紅翻綠，僅翻轉當根觸發 |
| 原始進場 | 提早型或確認型，保留 OR，不擅自改為兩者同時成立 |
| 通知品質 | 已收盤日線多頭、成交額合格且未過熱；通知比原始觸發少，是品質篩選而非公式差異 |

通知來源標示「系統自算」，並區分 MACD 提早進場與 Supertrend 確認。股票分別使用 `TW_STOCK_SLACK_CHANNEL_ID` 與 `US_STOCK_SLACK_CHANNEL_ID`，不得 fallback 到虛擬幣頻道。

本次額外修正美股缺小時 K 的跨段拼接、台股小時 K 重複量，以及台股／美股日線錯延後半小時確認。新通知及佇列補送限收盤後 35 分鐘。

[TradingView 官方 Supertrend 說明](https://www.tradingview.com/support/solutions/43000634738-supertrend/) 可核對上下軌與方向遞迴；[官方時間與交易時段說明](https://www.tradingview.com/pine-script-docs/concepts/time/) 可核對交易日最後一根較短 K 線的處理。這些是公式參考資料，系統執行時不呼叫 TradingView。

驗證使用手算 Supertrend／Wilder ATR 序列、獨立 EMA 閉式加權和，以及離線台股／美股掃描與 Slack 測試。尚未取得同源 TradingView 歷史逐根對帳，也未驗證策略勝率。Yahoo 的歷史起點、復權、資料修訂與提早收盤仍可能造成差異；不能宣稱每根訊號 100% 相同。

## 部署與驗證

本次沒有新增 migration。需部署新的 Worker 與 `wrangler.toml` 後，正式 Cron 才會更新；未執行正式部署。變更 Cron 的生效時間依 Cloudflare 控制面更新為準。

使用 Node.js v20.19.6 執行相關單元、離線 D1 整合測試與 `npm run build`。全專案型別檢查仍有既有的 Freqtrade D1 型別、debug-new-strategy 參數與 scratch 匯入路徑錯誤，本次修改檔案無新增型別錯誤。
