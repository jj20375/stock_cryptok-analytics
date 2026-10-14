# 本機 Bitget Demo 自動交易

正式合約全倉配置與 30U 測試額度請參考 [LIVE 流程](futures-live-automation.md)。`dev:demo` 仍只允許 Demo，資料庫更新不會把舊設定轉成 LIVE。

## 啟動

使用 Node.js 20.19.6，在專案目錄執行：

```sh
npm run dev:demo
```

本機網址為 `http://localhost:5190`。專用指令會開放本機 Demo 策略，每分鐘檢查；普通 `npm run dev` 不會自動開放此功能。首次開啟網站後背景排程開始運作，之後不需要保持頁面開著；Node 程序與電腦仍須持續運作。

網站與排程共用 `.wrangler/state/v3/d1` 本機資料庫。Cloudflare 的帳號、設定與紀錄不會自動同步到本機，正式 Worker 的自動化開關也沒有被這個指令修改。

`.dev.vars` 必須有既有 `SESSION_SECRET`、`MASTER_ENCRYPTION_KEY`、`SLACK_API_TOKEN`，以及 `CRYPTO_FUTURES_TRADE_SLACK_CHANNEL_ID`。已有加密資料時請保留原主加密金鑰，變更會使舊憑證無法解密；檔案不可提交至 Git。

## 使用順序

1. 登入 [本機設定頁](http://localhost:5190/settings)。
2. 在 Bitget 切換到 **Demo Trading**，進入個人中心的 API Key Management，建立 Demo 專用 API Key；此操作需由帳戶本人完成。將 Key、Secret 與 Passphrase 填入本機「Demo 專用憑證」，選擇 Demo 模式並儲存。操作方式以 [Bitget Demo API 官方說明](https://www.bitget.com/docs/uta/demo-trading/rest-api) 為準。
3. 讓既有 Slack Bot **stock_daily_app** 加入「虛擬幣合約多單通知」頻道。本機已使用從 Slack 介面核對的頻道 ID；Bot 不在頻道會收到 `not_in_channel`，光有 token 與頻道 ID 不代表能送達。
4. 打開 [本機合約頁](http://localhost:5190/crypto-futures)，在「Bitget 合約自動盯盤與交易」選 Demo，再按「檢查 DEMO 帳戶（唯讀）」。這個按鈕只讀帳戶，不送單。
5. 選擇商品與策略，填入單邊費率；勾選「啟用自動通知與 Demo 交易」及 Demo 授權，儲存設定。後端驗證 Demo 憑證成功後才保存啟用狀態。
6. 查看最後檢查時間、各商品最近檢查原因及最近確認訊號；委託接受與已成交分開顯示。Bitget 網頁須切到 Demo 模式核對委託和持倉。

兩個策略固定使用已收盤 1H 訊號、4H 盤勢與預設參數，支援多空；不會因為 Slack 頻道名稱含「多單」就改為只做多。若只想研究多單，需另行指定交易方向規則。

沒有確認訊號就不下單；首次啟動先暖機，超過五分鐘的進場不追補。頁面的歷史回測參數不會自動套用到這個即時執行器。

## 本機執行範圍與停止

- 每分鐘執行既有 `FUTURES_AUTO` Demo 策略，使用固定事件 ID 與帳戶授權去重。
- 每五分鐘只保護 `FUTURES_AUTO` 來源的 Demo 部位，並同步 Demo 帳本。排程不選用 LIVE 憑證。
- 按「停止自動新倉」會關閉帳戶新倉授權；程序繼續執行時，既有 Demo 部位仍有備援保護與對帳。
- 關閉 Node 程序或讓電腦休眠後，本機檢查、通知、時間退出與備援保護會停止。已送出的委託與交易所已接受的原生停損／目標仍留在 Bitget，需自行核對。
- 若要完全關閉本機執行器，先停止新倉、核對委託與部位，再於啟動它的終端機按 `Ctrl+C`。同一本機資料庫請只啟動一個開發伺服器；執行建置前先停止開發伺服器，建置完成再啟動，避免產生檔案觸發重新載入。

## 2026-10-13 實際檢查

本機已存有三個 Demo 憑證欄位，且自動化帳戶數為零。唯讀帳戶檢查固定使用 `paptrading:1`，V3 `/api/v3/account/settings` 與 V2 `/api/v2/mix/account/account` 均返回 HTTP 400／`40099`；目前金鑰與 Demo 環境不符，需更換真正的 Demo 專用金鑰。

已核對 Slack Bot 與使用者指定頻道屬於同一工作空間，保存本機頻道設定；發送一則明確標示的通知連線測試時，Slack 回覆 `not_in_channel`，沒有成功投遞。尚需讓 Bot 加入頻道。

專用指令已成功啟動，本機 API 未登入返回 401。使用者自行登入後，實際合約控制頁顯示本機 Demo 已開放但帳戶自動化停止；按唯讀「檢查 Demo 連線」亦顯示金鑰環境不正確。設定頁新增連至合約頁的入口，並修正舊的只做多說明。

`npm run build` 通過，保留既有 Vela 大型 chunk 警告；完整 TypeScript 檢查仍有四個既有錯誤（Freqtrade D1 型別、debug-new-strategy 市場參數及 scratch 匯入路徑），本次未增加錯誤。未執行新的自動化測試，也未建立 Demo 或 LIVE 委託。上述兩項設定完成前，自動化保持停止。
