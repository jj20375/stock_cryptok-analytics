# Bitget 美股現貨代幣進場雷達

入口：`/stock-token-radar`（需登入）。目標是 Bitget **現貨 rToken**，例如 rAAPL、rTSLA、rNVDA，不是美股原股、股票永續或一般加密貨幣。商品名單每輪由交易所更新，不以固定清單假設已上架。

此功能只產生人工判斷用的做多候選、D1 報告及 Slack 訊號，不建立持倉、不送單、不更動既有自動交易授權。策略門檻尚未經樣本外回測，不能宣稱勝率或保證獲利。

## 行情與篩選

使用 Bitget v3 公開 `SPOT` API：

- `market/instruments`：僅接受 `isReality=yes`、`marketRegion=US`、`instrumentType=stock/etf`、`status=online` 的 USDT 商品，並核對 baseCoin 與 symbol。
- `market/tickers`：必須有有效買賣價與雙邊數量；報價產生時間最多落後兩分鐘，價差不超過 0.3%。
- `platformTurnover24h` 至少 10 萬 USDT。平台成交額與一般 `turnover24h` 分開顯示，缺平台額時不使用一般額替代。成交額門檻不代表可承受任意倉位或保證成交。
- 合格商品依平台成交額排序，每輪分析前 20 檔。頁面會顯示全體上架數、合格數、實際分析數及排除原因；清單不代表已分析全部商品。
- `market/candles`：讀取同商品 `market` 類型的 1H／4H K 線，各保留最多 120 根。排除未收盤根，拒絕無效、矛盾、重複或不足的資料，不使用 Yahoo 股票量價填補。

## 做多規則

兩個週期各至少 80 根已收盤 K 線。最近 21 根小時線需連續且有成交量；週末／休市缺根時等待資料補足。

| 條件 | 初版門檻 |
| --- | --- |
| 4h 趨勢 | 收盤 > EMA20 > EMA50，且 EMA20 上升 |
| 1h 趨勢 | 收盤 > EMA20 > EMA50 |
| 1h 動能 | RSI14 介於 50～72 |
| 突破進場 | 收盤突破前 20 根最高價，量 ≥ 前 20 根均量的 1.5 倍 |
| 回踩進場 | 低點落在 EMA20 ± 0.5 ATR14，收盤為紅K且超過前根最高價，量 ≥ 前 20 根均量 |
| 進場區間 | 訊號收盤 −0.25 ATR 至收盤 +min(0.25 ATR, 0.5%)；買一價須在區間內 |
| 失效價 | min(近五根低點 −0.25 ATR, 訊號收盤 −1.5 ATR) |
| 風險距離 | 訊號價與實際驗證買一價至失效價皆需介於 0.5%～5% |
| 目標 | 訊號收盤起算 2R；依買一價估算單邊 0.1% 進出費用後，淨報酬風險比至少 1.5R |
| 有效期 | 1h 收盤後 20 分鐘；離開區間或觸及失效／目標不通知 |

費率是研究估算，實際費用依帳戶而定。區間、失效價與目標為參考，不會建立限價單或停損單；買一價只有當時頂層報價，不代表大額訂單的成交均價。代幣與原股可能有價差，未以原股報價驗證溢折價、財報事件或公司行動。

## 排程、清單及通知

`STOCK_TOKEN_RADAR_ENABLED=true` 才自動執行，掛在既有每分鐘 Trigger，每五分鐘跑一次，不新增 Cron 定義，不開啟一般幣新倉或舊雷達。

頁面重新整理及每分鐘更新只讀 D1。手動掃描透過登入後的同源 POST 執行；全站共用四分鐘冷卻與租約，避免連點／重疊消耗 API。

Slack 使用 `SLACK_API_TOKEN` 與 **`US_STOCK_SLACK_CHANNEL_ID`**，指定「美股即時進場價格」。不使用 `SLACK_CHANNEL_ID`、`SLACK_CRYPTO_CHANNEL_ID` 或虛擬幣頻道作 fallback。未設定專用頻道時仍可產生清單，不建立通知事件。

通知以策略版本、商品與訊號收盤時間去重，每輪最多三則；只發合格的新進場候選，不定期發空清單。發送前再次讀取商品及買賣價，重新檢查流動性、時效、區間、失效價與費後報酬風險比。過期／不再入選的事件不補送。Slack 失敗在有效期內下一輪重試，錯誤會顯示在頁面；若 Slack 已收到但 D1 送達標記失敗，仍可能重送一次。事件保留 30 天供稽核。

## 啟用

先在目標 Slack 頻道邀請既有 Bot，複製該頻道連結確認 Channel ID。Bot 需具備發訊權限；缺 `channels:read` 時不影響已知 ID 的發訊，但無法靠 API 查名稱。

```sh
# Node.js v20.19.6；先完成測試與建置。
node --import tsx --test tests/stock-token-radar.test.ts tests/stock-token-radar.integration.test.ts
npm run build

# 本機只做公開行情篩選，輸出 output/stock-token-radar.json，不發通知。
node --import tsx scripts/scan-stock-tokens.ts

# 正式啟用前需執行資料庫更新與部署；以下是操作指令，不代表已執行。
npx wrangler d1 migrations apply crypto-analytics-db --remote
npx wrangler secret put US_STOCK_SLACK_CHANNEL_ID
# 若 Bot Token 有更換，透過 secret put 更新，不要貼在聊天或原始碼。
npx wrangler secret put SLACK_API_TOKEN
npm run deploy
```

本機可將專用頻道 ID 放入已忽略的 `.dev.vars`。本次功能不會自動執行正式 migration 或部署。若 Cloudflare 出口被 Bitget 拒絕（例如 HTTP 403），頁面會顯示錯誤並清除進場候選；需改用可正常連線的執行器，不能將舊清單當即時機會，也不應關閉 TLS 憑證驗證。

截至 2026-11-06，正式 Worker 已部署於 `https://us-tw-crypto-analytics-2.desiginerice5908.workers.dev/stock-token-radar`，登入後可開啟；D1 `0030_stock_token_radar.sql` 已套用，`US_STOCK_SLACK_CHANNEL_ID` 已設為 `C0C24G1DQDA`。正式環境首輪排程回報 Bitget 公開現貨 API HTTP 403，故目前沒有有效即時行情、候選清單或進場通知；頁面會顯示失敗狀態，不沿用舊訊號。本機另遇到 Fortinet 簽發憑證但找不到對應信任鏈。需由網路管理者確認合法 CA 鏈或使用可正常連線的執行器，不停用 TLS 憑證驗證。Slack Bot Token 曾貼在聊天中，應撤銷並重新產生後透過 `wrangler secret put SLACK_API_TOKEN` 更新正式 secret；不要把 Token 貼入聊天或原始碼。

24 項相關測試及 `npm run build` 通過，涵蓋策略、流動性、登入／同源檢查、D1 租約去重、Slack 重試與再驗價；build 仍有既有的大型 bundle 警告。全專案型別檢查仍有既有的 MacroMarketCompass、Freqtrade D1、debug／scratch 與舊研究測試型別錯誤，本次新增檔案無型別錯誤；本功能未擴充這些既有錯誤檔案。所有本次新增手寫程式檔皆低於 1000 行，現有 `app/` 手寫檔也未發現超過 1000 行。

## 來源

- [Bitget 現貨股票／rToken 說明](https://www.bitget.com/asia/support/articles/12560603887176)
- [商品識別 API](https://www.bitget.com/docs/catalog/market-market-data/market-instruments)
- [Ticker 與平台成交額 API](https://www.bitget.com/docs/catalog/market-market-data/market-ticker)
- [rToken K 線週期及格式](https://www.bitget.com/docs/catalog/market-market-data/market-candles)
