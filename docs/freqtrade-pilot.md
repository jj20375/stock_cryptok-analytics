# Freqtrade 波段雷達試點

這個試點將 Freqtrade 當作獨立的策略研究與模擬交易引擎。現有 Cloudflare 系統仍負責戰情室、波段雷達、觀察名單與 Slack；Freqtrade 不可直接替代既有網站，也不可與既有下單路徑同時管理同一個槓桿帳戶。

## 試點策略

`WaveRadar15mStrategy` 用已收盤日線確認 MA20/50 上升趨勢，以已收盤 4h K 線計算 20 根前高、放量和 ATR，最後以 15 分鐘價格越過參考位作為入場觸發。這讓 15 分鐘線負責時機，而不是單獨判斷趨勢。

它是新策略，不是網站 `crypto_wave` 的逐行重製。兩者的資料來源、訂單成交模型和指標函式不同，結果必須分開展示。回測、樣本外期間、Dry-run 三者一致後，才可以討論後續風險設定。

## 建立模擬環境

在本機或有 Docker 的 Linux 主機上執行：

```bash
python3 freqtrade/setup_local.py
cd freqtrade
docker compose run --rm freqtrade download-data --config /freqtrade/user_data/config.dryrun.local.json --timeframes 15m 4h 1d
docker compose up -d freqtrade
```

初始化程式會建立被 Git 忽略的本機設定、隨機 REST 密碼和同步金鑰，且不會在終端印出秘密。Docker 只將 API 映射到主機 `127.0.0.1:8080`，外部網路無法直接連到交易機器人。設定固定為 `dry_run: true`、現貨、五檔幣對與最多兩筆模擬持倉；請先維持這個範圍，動態熱門幣清單無法可靠還原歷史時點，會污染回測比較。

回測須在資料、手續費、滑價假設、幣單與期間固定後執行。建議至少報告：交易樣本數、扣成本後淨報酬、Profit Factor、最大回撤、連續虧損與未參與調參的樣本外表現。回測資料不含真實滑價，特別是小幣和急漲行情要另外做較高滑價壓力測試。

## 同步到戰情室

1. 先套用 `0013_freqtrade_pilot.sql`，再部署網站程式。
2. 將 `freqtrade/user_data/config.sync.local.json` 的 `dashboard_url` 改成已部署網站的 `https://…/api/freqtrade/sync`；把同一個 `sync_secret` 設為 Cloudflare 的 `FREQTRADE_SYNC_SECRET`。金鑰至少 32 字元，設定檔不可提交。
3. Freqtrade REST API 只允許透過 Docker 的 `127.0.0.1:8080` 映射存取；不公開連接埠，也不讓瀏覽器直接存取。
4. 啟用同步服務：`docker compose --profile sync up -d`。同步器只讀 `/show_config`、`/profit`、`/status`、`/health` 和 `/whitelist`，只接受現貨 Dry-run。心跳逾五分鐘、服務異常或無已平倉樣本時，Dashboard 會明確標示，絕不把空值顯示為績效。

同步入口只接受有限的績效、研究期間與成本欄位，以及五分鐘內的簽章請求，且不能下單。戰情室與波段雷達共用研究面板，顯示模式、策略版本、樣本、勝率、Profit Factor、最大回撤及成本假設；資料尚未同步時，原有即時觀察看板仍可使用。

## Slack 通知原則

Slack 應優先通知「通過研究門檻且 Dry-run 未失效」的突破／回踩訊號，訊息包含策略版本、樣本數、回撤、失效價與觸發時間。勝率只能與樣本數、Profit Factor 和最大回撤一起呈現，不能單獨當成推薦依據。這個試點尚未自動發送 Freqtrade 訂單事件，避免在同步可靠性未驗證前增加通知噪音。
