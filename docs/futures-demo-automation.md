# Bitget Demo 合約自動化

新增的正式合約全倉分支與 30U 測試額度請參考 [LIVE 自動化流程](futures-live-automation.md)；預設政策關閉，Demo 指令不能啟用正式新倉。

登入 `/crypto-futures` 後，可在「Demo 合約自動盯盤與交易」設定最多五個 USDT 合約、選擇既有的趨勢回踩或區間假突破策略，並填入單邊帳戶費率。策略固定使用註冊模組的預設參數，RSI2 研究候選仍不能送單。

## 執行流程

1. 雲端一分鐘排程檢查最新已收盤 1H K 線，以 4H 盤勢篩選；頁面不需要持續開啟。
2. 首次啟用先取得完整暖機資料，之後每小時補新根。同一帳戶、商品、策略、收盤根與方向使用固定事件 ID。
3. 已確認訊號先保存紀錄，再交給既有 Bitget 引擎，以強制 `DEMO` 執行。帳戶仍須獨立勾選授權，且必須有 Demo 專用憑證。
4. 新自動化開倉使用全倉、交易所原生停損／目標與既有風控；本金取交易所 USDT 淨值，單筆倉位上限 3～5%、最多三筆，每筆計畫風險最多本金 0.25%。槓桿只影響所需保證金，不放大名目倉位。
5. Slack 通知使用既有合約頻道；委託接受、成交與部分成交分開顯示。交易所結果未知時不盲目重送，由成交帳本對帳。
6. 行情失敗、缺口、暖機不足或超過五分鐘的進場不補成有效訊號。通知最多重試三次，失敗只重投通知，不重送訂單。

新獨立政策只允許 `FUTURES_AUTO` 來源且明確指定 Demo。它不開放舊現貨、TradingView 或 LIVE 新倉。原有 `CRYPTO_NEW_ENTRIES_ENABLED` 等政策維持獨立。

## 部署與使用

- 本機 Demo 已有專用啟動指令 `npm run dev:demo`；操作與當前阻擋原因請參考 [本機 Demo 流程](local-futures-demo.md)。本機開放不會改動 Cloudflare 部署開關。
- 套用 `drizzle/0025_futures_demo_automation.sql` 後建置及部署。
- 設定 `CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED=true` 前，須先確認執行環境可正常連線至 Bitget。
- 使用者在設定頁填妥 Demo 專用 API；正式合約憑證不會自動代入 Demo。
- 合約頁的「檢查 Demo 連線」只讀取帳戶設定，不送單。
- 勾選啟用與 Demo 授權後儲存，才會自動通知與交易；預設停止。
- 停止按鈕不受十秒操作冷卻阻擋。它停止新倉，已接受委託仍可能成交，既有部位的原生停損與五分鐘備援仍保留。

## 已確認的執行環境限制

2026-10-13 首次以真正的 Cloudflare 遠端預覽 Worker，測試 Bitget V2 合約行情與 V3 商品清單，皆收到 HTTP 403，內容為 `{"cloudflare":"block"}`。V2 使用與程式相同的端點與標頭；當時本機 Node 與 curl 也遇到 TLS 信任鏈驗證失敗。

同日依使用者要求重新驗證，本機 Node 與 curl 已能正常通過 TLS；V2 行情、歷史 K 線及 V3 商品清單皆返回 HTTP 200／`00000`。專案實際讀取程式亦成功取得連續 1000 根 BTCUSDT 已收盤 1H K 線，通過暖機與最新收盤根驗證，並取得 12 個維持保證金級距、資金費率及雙邊深度。Cloudflare 遠端預覽重試上述三個公開端點仍皆為 HTTP 403／`{"cloudflare":"block"}`。所有檢查僅讀公開行情，未使用金鑰、未通知、未送單，亦未停用 TLS 驗證。

後續進一步排除預覽模式差異：Cloudflare [官方已知問題](https://developers.cloudflare.com/workers/platform/known-issues/#wrangler-dev) 說明遠端預覽的 `cf-workers-preview-token` 可能使跨站請求遭拒。因此最初只有遠端預覽的結果，尚不足以推論正式 Worker 一定被擋。2026-10-13 台北 10:32～10:33，以獨立、真正已部署且沒有帳戶／資料庫／排程的診斷 Worker 檢查同三個公開端點；一般請求及明確刪除預覽標頭的請求均收到相同 403。遠端預覽的兩種請求也均為 403。

已部署診斷 Worker 的 ticker 回應：UTC `2026-10-13T02:32:24.976Z`、`server: cloudflare`、`cf-ray: a49aef0418364a0f-TPE`、回應 `{"cloudflare":"block"}`。測完移除診斷 Worker。可以確認目前測試的 Cloudflare 執行來源遭到安全層拒絕；具體是來源 IP、ASN、請求標頭或哪條規則，仍需 Cloudflare／Bitget 端查詢紀錄，不能只靠 403 推論。公開行情未使用 API 金鑰，因此此項失敗並非缺少帳戶金鑰。

目前保留自動化部署開關為關閉。Workers 付費方案提高 CPU／請求額度，沒有證據顯示升級能處理上述 403；應先釐清安全規則。本機公開行情連線已恢復，仍需選定執行環境、完成持續執行的本機或伺服器執行器及 Demo 帳戶檢查，才可啟用自動交易。

## 公開行情連線重測方式

使用相同端點、HTTP 方法與標頭，比較本機和真正已部署的 Worker；每個環境只測一次，記錄時間、上游 HTTP 狀態、回應和 `cf-ray`。不要以本機 `wrangler dev` 的成功當作 Cloudflare 成功，亦不要只用遠端預覽失敗判定正式環境。

本機終端機（不需任何金鑰）：

```sh
curl -i --connect-timeout 10 --max-time 20 \
  -H 'Accept: application/json' \
  -H 'User-Agent: CryptoAnalytics/1.0' \
  'https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=USDT-FUTURES'
```

Cloudflare 建立獨立測試 Worker，使用下列最小程式，實際部署後開啟它的網址；不綁定正式金鑰、資料庫或排程，測完刪除：

```js
/** @file 固定 Bitget 公開行情診斷；不轉送訪客憑證、不處理下單。 */
export default {
  async fetch() {
    const response = await fetch(
      'https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=USDT-FUTURES',
      { headers: { Accept: 'application/json', 'User-Agent': 'CryptoAnalytics/1.0' },
        signal: AbortSignal.timeout(10000) }
    );
    return Response.json({
      checkedAt: new Date().toISOString(),
      upstreamStatus: response.status,
      ray: response.headers.get('cf-ray'),
      body: await response.text(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  },
};
```

- 上游 HTTP 200 且 Bitget `code=00000`：該環境公開行情成功，仍須另查 Demo 帳戶權限。
- 上游 HTTP 403：保存時間、端點、回應與 `cf-ray` 供客服確認安全規則。
- API 回傳驗證／簽名錯誤：只有在後續帳戶介面測試時，才檢查金鑰、Demo 模式與 IP 白名單。
- DNS、TLS 或逾時錯誤：分別檢查解析、信任鏈與連線；不關閉憑證驗證。

若日後直接使用 Cloudflare 執行，多商品指標與對帳需核對 Workers CPU／外部請求限制；免費方案 CPU 10 ms、外部請求每次 50 個，Paid 最低 US$5／月。正式費用與限制以 [Cloudflare 官方價格](https://developers.cloudflare.com/workers/platform/pricing/) 和 [限制](https://developers.cloudflare.com/workers/platform/limits/) 為準。

收盤後約一分鐘開始檢查是目標，不是延遲保證。通知回應遺失可能造成重複投遞，訊息保留固定識別供辨認；訂單另有資料庫事件去重。

## 本次驗證

必要的 16 項合約／自動化／排程檢查通過，包含臨時 D1、帳戶隔離、同根去重、通知文字跳脫、停止優先與行情失敗不造訊號；所有外部通知及下單請求均以合成資料攔截，沒有實際 Demo 或 LIVE 委託。`npm run build` 通過。

完整 TypeScript 檢查仍有四個既有錯誤（Freqtrade 的 D1 型別、debug-new-strategy 的市場參數及 scratch 匯入路徑），不屬於本次變更；既有 Vela 大型 chunk 警告亦保留。本次修改的手寫程式均低於 1000 行。

本機補齊 0023／0024 帳本依賴與 0025 自動化資料表；正式 D1 已套用 0025。Cloudflare 部署版本為 `09336532-8682-4312-b2fb-0ba5e61bbd83`，Demo 自動化開關保持關閉。正式 API 的未登入請求返回 401，正式頁面需要重新登入才能核對個人 Demo 綁定；介面視覺檢查使用同元件的合成狀態預覽。
