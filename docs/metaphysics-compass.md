# 玄學羅盤（紫微變盤＋八字運勢）

玄學參考，非量化訊號，不構成投資建議。本功能不影響漲跌羅盤、選股、自動下單與風控，也不發任何通知。

## 功能

- `/metaphysics`：
  - **市場變盤日曆**：以台股（1962-02-09 證交所開業）、BTC（2009-01-03 創世區塊）、美股（1792-05-17 梧桐樹協議，時辰為假設）的紫微本命盤，疊上流年、流月、流日四化，算出 31 天的方向分數（-100～+100）與變盤強度（0–3）。今天那格有 AI 解說。
  - **我的八字**：生辰加密保存；顯示四柱、日主強弱、喜用神（扶抑法簡化版）、投資性格、大運流年與 31 天流日吉凶，並疊加所選市場的變盤強度。
  - **命中率**：歷史回測與上線後快照的命中率，與基準機率並列，附 95% 信賴區間。
- 首頁「今日玄學羅盤」小卡；設定頁有連結指向生辰填寫處。

## 規則與資料

- 規則細節：`docs/superpowers/specs/2026-11-09-metaphysics-compass-design.md`，規則版本 `ziwei-v1`、`bazi-v1`。
- 程式：`app/services/metaphysics/`。三個市場本命盤由 `scripts/metaphysics/generate-market-charts.ts` 以 iztro 預先產生；修改 `marketChartSpecs.ts` 後必須重跑產生器並升版規則。
- 資料表（migration 0031）：`user_birth_profiles`（加密生辰）、`metaphysics_market_forecasts`（`source` = `live` 或 `backtest`）、`metaphysics_narrative_cache`。
- 上線後快照：開啟頁面時寫入當天預測（台股、美股只在週一至週五），並回填已收盤日期的實際漲跌。
- 送給 AI 的只有衍生標籤，不含出生日期與四柱；方向分數會明確標示中性／偏多／偏空，避免 AI 解讀與頁面矛盾。

## 回測結論（2026-11-09，ziwei-v1）

| 市場 | 期間 | 強度 ≥ 2 實際變盤 | 任意一天變盤 | 方向命中 | 一直猜漲 |
|---|---|---|---|---|---|
| 台股 | 2006-12～2026-11 | 35.0% | 35.1% | 55.0% | 54.3% |
| BTC | 2021-07～2026-11 | 33.7% | 32.0% | 46.6% | 49.6% |
| 美股 | 2006-12～2026-11 | 32.0% | 34.5% | 53.5% | 54.4% |

三個市場都落在基準的 95% 區間內，**與隨機無明顯差異**。若要調整規則，必須升版並註明是看過回測後才調整，否則就是對歷史資料過度擬合。

## 測試

```bash
node --import tsx --test tests/metaphysics-*.test.ts
```

## 部署

1. `npm run db:migrate:remote`（套用 migration 0031）。
2. `node --import tsx scripts/metaphysics/backtest-ziwei-timing.ts`
3. `npx wrangler d1 execute crypto-analytics-db --remote --file=output/metaphysics/ziwei-backtest.sql`
4. `npm run deploy`

不需要新增 secret：沿用 `MASTER_ENCRYPTION_KEY` 與既有 AI 設定（`AI_PROVIDER` 等）。
