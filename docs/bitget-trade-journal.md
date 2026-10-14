# Bitget 成交帳本與交易復盤

## 已實作

入口：`/trade-journal`。登入後可從左側導覽或 Dashboard 進入。

- DEMO／LIVE USDT 永續帳本，依使用者、環境、API Key 指紋隔離。
- 支援 UTA V3 與 Classic V2。同步成交、歷史委託、待成交委託、帳務流水與目前持倉。
- 交易所成交 ID 去重；每頁資料及歷史游標以同一 D1 batch 寫入，失敗可繼續。
- 由成交重建多／空倉位生命週期、加倉、部分平倉與單向反手；數量採 18 位定點運算，不使用固定 0.01 容差。
- 實際成交價、手續費、資金費率、完整已平倉樣本的勝率／獲利因子／期望損益。
- UTC 事件日的累計與月度現金損益，以及日末現金損益最大回撤（USDT）。不製造沒有起始本金支持的報酬率。
- Vela 倉位圖：Bitget 歷史合約行情、EMA20、實際成交標記、均價線、逐根重播。重播時隱藏未來 K 線、成交標記及完整均價線。
- 日誌來源篩選、成交與資金費率明細、系統進場風控快照。
- Gemini 本週至今復盤：UTC 週一至產生時間，資料版本快取，每帳戶十分鐘最多一次。內容包含資料完整性、成本、執行偏差與風控觀察。

## 啟用順序

開發執行環境為 Node.js v20.19.6。

1. **先套用 `drizzle/0023_bitget_ledger.sql`，再部署程式**。新版 ORM 查詢與自動交易需要新增欄位。
2. 在本機資料庫使用 `npm run db:migrate:local`；正式資料庫另使用 `npm run db:migrate:remote`。
3. 於「設定」填妥對應的 Bitget 合約憑證。沿用 `MASTER_ENCRYPTION_KEY` 解密，不新增瀏覽器金鑰儲存。
4. 若要使用週報，將 `GEMINI_API_KEY` 設為 Workers secret。可選設 `GEMINI_REVIEW_MODEL`；預設 `gemini-3.8-flash`，不影響站內既有 `AI_PROVIDER`／`AI_MODEL`。3.8 Flash 呼叫不傳入舊版採樣參數，避免 API 拒絕請求。
5. 開啟交易復盤，選 DEMO 或 LIVE、匯入天數與帳戶種類，按「同步／繼續匯入」。Classic 自動探測失敗時可明確選 Classic。
6. 首次登記後，每五分鐘的既有持倉保護排程會分批同步。先執行持倉保護，再更新帳本；帳本故障不會阻止停損檢查。

本次開發沒有套用正式資料庫遷移、部署、呼叫使用者交易憑證或實際產生 Gemini 付費週報。上述指令由部署流程執行。

## 同步與進度

- 首次可匯入 7、30 或 89 天；保留 API 90 天上限的一天緩衝。
- 固定七日查詢窗口，每次最多三頁歷史資料，每頁最多 100 筆；另讀取待成交委託與持倉快照。
- 三類歷史資料都翻完，才推進「完整覆蓋」末端。跨窗口與 API 失敗會保留游標。
- 匯入未完成時可重複按同步；排程每輪挑最近最久未嘗試的兩個已登記帳戶，避免突發流量。
- 最新同步重抓五分鐘重疊區間，以交易所 ID 覆寫費用和最終狀態，不重複計數。委託只接受不早於已存版本的更新時間。
- 擴大匯入天數時重新確認連續覆蓋，不刪除已取得成交。正在翻頁時，先完成目前進度，再按較長區間同步。
- 帳戶指紋改變會停止舊帳戶更新，保留歷史；新憑證首次同步建立新帳本，不把兩個帳戶混在一起。
- 同步租約為兩分鐘，D1 條件寫入排除過期執行者。未遷移站台會顯示帳本未就緒。

## 自動交易對帳

新版系統委託在發送前登記帳戶、進場策略／風控快照、clientOid 及預留數量。唯一持倉槽避免不同訊號同時重複進場。

- 開倉回執只代表委託已接受。`PENDING` 保留風控額度，不當作已成交績效。
- 網路逾時稽核為 `UNKNOWN`，不盲目重送；取得相同 clientOid 的交易所委託後找回 orderId。
- 明確 API 拒單才釋放預留額度；部分成交後撤單仍有持倉，不能當成零成交取消。
- 新版平倉保留 `OPEN` 與 `CLOSE_PENDING`，待完整成交對帳及新持倉快照證實結果，才記實際平倉均價與淨損益。
- 平倉前查實際 long 數量，部分成交不能拿整筆預留數量平倉。超過本系統記錄的部位不自動接管。
- 有其他來源開倉、混合多個本地交易、歷史／費用缺漏、或快照不一致時，保留差異供核對。
- 原生停損等非本站發出的平倉，也可依同一倉位成交與平倉快照修正本地紀錄。
- 沒有帳戶指紋的舊本地紀錄維持原停損流程與 `ESTIMATED` 標籤。舊參考價估算不混入新實際成交帳本。

## 績效的資料邊界

- 合約資金費率使用明確帳單類型白名單；充值、提領、轉帳、股息與已在成交計入的交易損益不再累加。
- UTA 費用正數為扣款，轉為負現金流；Classic 保留原有符號，maker 回饋不能用絕對值吃掉。
- 非 USDT 費用保留原幣別，不猜換匯價格。淨利顯示「未完整」，待取得可信匯率後才能補算。
- 缺少開倉歷史、未知首筆單向方向或交易所損益／費用時，倉位不列入完整已平倉樣本。
- 帳單無法唯一歸屬雙向倉位時保留帳戶資金費率總額，該倉位淨利待補；未歸屬筆數會顯示在頁面。
- 整體損益以統計區間內的實際事件現金流計算；勝率、獲利因子與期望損益使用該區間內平倉的完整生命週期成本。
- 五分鐘內的末端視為排程正常延遲，完整性仍是「截至最後查詢時間」，不保證交易所立即一致。
- 每個帳戶每類資料一次最多讀取 20,000 筆，超出時停用完整績效；頁面顯示最近 200 個倉位、100 筆委託、每倉最多 500 筆成交及 100 筆資金費率。
- 待成交訂單每輪每個狀態最多讀取 99 筆；超出上限時保留歷史進度，標示同步未完成，避免宣告完整。
- 歷史行情每次最多 600 根，依持倉期間自動選 1H／4H／1D。交易所缺行情時顯示錯誤或覆蓋不足，不以其他交易所價格冒充 Bitget 成交行情。

## 授權與 AI

頁面與資料操作需要登入；所有帳戶查詢限定當前使用者。POST 要求同源 Origin、JSON Content-Type，請求內容上限 2 KB。回應標示 `private, no-store`。

金鑰只在伺服器解密及簽章使用，不存入帳本，不送入 Gemini。Gemini 只收到彙總數字及固定來源代號，無原始 label、任意文字快照或帳戶識別。模型輸出以純文字顯示，無工具、下單、通知或改寫風控的能力。

## 主要檔案

- `app/db/bitgetLedgerSchema.ts`、`drizzle/0023_bitget_ledger.sql`：帳本、週報與關聯欄位。
- `app/services/bitgetLedger/`：憑證隔離、API、同步、倉位重建、績效、對帳、圖表與週報。
- `app/routes/trade-journal.tsx`、`app/features/tradeJournal/`：登入頁面、資料操作、Vela 與績效 UI。
- `app/services/cryptoAutoTrading/engine.ts`：委託接受、風控 reservation 與實際成交狀態分離。
- `app/worker.ts`：既有五分鐘排程接入帳本更新。

## 官方參考

[UTA 訂單與成交](https://www.bitget.com/docs/catalog/trading/order-management)、[Classic 合約訂單與成交](https://www.bitget.com/docs/catalog/classic-contract-trade/classic-contract-trade)、[UTA 帳務流水](https://www.bitget.com/docs/catalog/account/assets-balance)、[Classic 合約帳務](https://www.bitget.com/docs/catalog/classic-contract-account/classic-contract-account)、[合約歷史 K 線](https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market)、[Gemini 3.8 Flash 模型](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)。

## 開發檢查

- `npm run build` 通過。Vela workspace 仍有既有的 bundle 大於 500 KB 警告。
- 全專案 `tsc --noEmit` 仍有四項既有錯誤：`api.freqtrade.sync.ts`、`freqtrade/research.server.ts` 的 D1Database 型別，以及根目錄 `debug-new-strategy.ts` 與 `scratch/test_api.ts`；本次新增帳本及復盤模組沒有型別錯誤。
- 沒有新增或執行測試，也沒有以使用者憑證驗證交易所回應。首次啟用仍需確認帳戶種類、權限與實際 API 資料格式。
- 全部 `app/` 手寫 TypeScript 檔目前低於 1000 行。
