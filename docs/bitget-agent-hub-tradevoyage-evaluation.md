# Bitget Agent Hub 與 TradeVoyage 評估

評估日期：2026-10-05（Asia/Taipei）。本次為文件、公開原始碼與 npm 發佈檔案的靜態評估；沒有安裝 MCP、提供帳戶憑證、執行第三方程式或送出交易。

## 建議決策

- Bitget MCP：適合讓開發用 AI 查詢行情、帳戶與交易資料，先以唯讀模式試用。
- 官方套件使用 `@bitget-ai/bitget-agent-mcp`；原連結的 `bitget-mcp-server` 已停止維護。
- 系統下單繼續經過現有策略、風控、去重與稽核流程。MCP 直接呼叫交易所不會經過這些專案規則。
- TradeVoyage：優先參考成交資料整理、完整倉位復盤、費用分解及交易後 AI 分析。
- 開發順序：成交對帳 → 倉位復盤 → 真實淨績效 → AI 週報。先完成 Bitget，再依需求擴充其他交易所。

## Bitget 工具的用途

| 工具 | 官方定位 | 本專案適合的用法 |
| --- | --- | --- |
| Agent Hub | CLI、MCP、SDK、交易 skills 與市場分析 skills 的總入口 | 作為選型與文件入口 |
| MCP | 將 Bitget 工具提供給支援 MCP 的 AI 用戶端 | 開發時查行情、帳戶與成交資料；先唯讀 |
| CLI + trading skill | 讓終端 AI 透過 `bgc` 查詢或操作 Bitget | 需要終端操作時再採用 |
| SDK | TypeScript 程式庫，包裝 UTA v3 操作 | 日後評估新 API 功能；替換現有 adapter 前核對 Workers 相容性與行為 |
| bitget-signal | 總經、鏈上、情緒、技術與新聞分析 skills | 參考研究流程與報告格式；skills 本身不等同常駐掃描服務 |

來源：[官方 Agent Hub](https://github.com/Bitget-AI/agent_hub)、[Bitget 官方 Agent Hub 文件](https://www.bitget.com/docs/uta/agent-hub)。

### 發佈與維護狀況

| 項目 | 實際查核結果 |
| --- | --- |
| `bitget-mcp-server` | npm latest 為 1.1.0，發佈於 2026-03-17；registry 尚未加 deprecated 欄位，但官方 changelog 已明示舊名稱不再維護 |
| `@bitget-ai/bitget-agent-mcp` | npm latest 為 3.3.1，發佈於 2026-09-20；要求 Node.js ≥20 |
| 公開 MCP GitHub 主分支 | 查核 commit `486a7c5b2769e452bc7d3b39337cb6d3f9b1a0d3`，日期 2026-09-01；package.json 仍標示 3.0.0 |
| npm 3.3.1 實際發佈檔案 | 已讀取 package.json、README、CHANGELOG 與編譯後 adapter；changelog 包含 SDK OAuth 流程更新，依賴 `@bitget-ai/bitget-agent-sdk@^3.3.0` |
| 可重現性 | 建議指定評估過的版本；頂層版本固定仍不會固定 `^` 範圍內的間接依賴，正式採用時另以 lockfile 控制 |

來源：[舊名稱停止維護的 changelog](https://github.com/Bitget-AI/agent-mcp/blob/main/CHANGELOG.md)、[舊套件 registry](https://registry.npmjs.org/bitget-mcp-server)、[新版 registry](https://registry.npmjs.org/@bitget-ai%2Fbitget-agent-mcp)、[3.3.1 固定版本 metadata](https://registry.npmjs.org/@bitget-ai%2Fbitget-agent-mcp/3.3.1)。

公開主分支與 npm 發佈版本不同步，因此不能僅憑 GitHub 首頁的版本或 README 判斷已安裝版本。這次已補看實際發佈檔案，但尚未做完整 SDK 與相依套件安全稽核。

### 採用條件

1. 初次僅查公開行情，可不提供帳戶憑證。需要帳戶資料時，另建唯讀 API Key，並啟用 `--read-only`。
2. 官方 adapter 採本地 stdio；簽章與 API 呼叫由 SDK 處理。它可提供自然語言查詢，但不會因加入網站依賴就自動接入 Cloudflare 排程。
3. 模組選擇用來縮小工具範圍；仍有 `raw` 入口，不應把 `--modules` 當作帳戶權限邊界。
4. 官方寫入規則是一般寫入立即執行，部分高風險操作要求 `confirm: true`；這個參數不等同我們系統的風控，也不能單靠它證明使用者已批准。
5. 若要演練交易，使用獨立 Demo 憑證與 `--paper-trading`。目前文件將該模式與 `--read-only` 列為互斥。
6. 若要讓站內 AI 操作交易，先建立只接受已驗證指令的內部入口，呼叫現有交易引擎；金鑰與直接交易工具不交給分析層。

來源：[官方 MCP 使用與安全模式](https://github.com/Bitget-AI/agent-mcp)、[adapter 的寫入規則與 SDK 呼叫](https://github.com/Bitget-AI/agent-mcp/blob/main/src/server.ts)。

## TradeVoyage 值得參考的功能

查核版本：`e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf`，最後提交日期 2025-12-22。它是以個人本地交易歷史分析為主要用途的 Next.js 應用，MIT 授權；README 與目前程式涵蓋 BitMEX、Binance、OKX、Bybit，沒有現成 Bitget adapter。

來源：[TradeVoyage 功能與架構](https://github.com/0x0funky/TradeVoyage)、[查核 commit](https://github.com/0x0funky/TradeVoyage/commit/e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf)。

| 優先順序 | 可參考的做法 | 我們的現況 | 建議加入的內容 |
| --- | --- | --- | --- |
| P0 | 從成交、帳單與帳戶歷史建立分析資料 | Bitget 下單有 orderId 與稽核；本地價格和損益主要取訊號參考價 | 同步實際成交均價、成交量、費用、資金費率、委託狀態及交易所倉位；標示對帳狀態 |
| P1 | 將多筆成交組合成完整倉位，點選後連到 K 線 | 有交易列表、策略圖層與回測買賣點；沒有完整的實際成交復盤 | 倉位詳情、加減倉時間線、實際買賣點與 Vela 圖表跳轉 |
| P1 | 月度損益、費用拆解與資金曲線 | Dashboard 有總損益、勝率、持倉數；回測已有多項績效公式 | 實際交易的淨損益、資金費率收支、費用、月度績效、回撤與每筆期望值 |
| P2 | AI 分析近期倉位及月度表現 | 已有 Gemini 盤勢與持股分析 | 使用經對帳的交易資料生成策略復盤／週報，列出支持結論的交易與資料範圍 |
| P2 | 唯讀 API 匯入與逐批進度顯示 | 已有交易所憑證與 Freqtrade 摘要同步 | 先做 Bitget 歷史回補、游標續傳、重複成交去除與匯入狀態，再擴充其他交易所 |

來源：[倉位整理邏輯](https://github.com/0x0funky/TradeVoyage/blob/e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf/lib/position_calculator.ts)、[統計與歷史資料](https://github.com/0x0funky/TradeVoyage/blob/e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf/lib/data_loader.ts)、[AI 分析輸入](https://github.com/0x0funky/TradeVoyage/blob/e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf/components/AIAnalysis.tsx)、[匯入進度](https://github.com/0x0funky/TradeVoyage/blob/e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf/app/api/import/stream/route.ts)。

### P0：先建立可對帳的成交紀錄

目前 `app/services/cryptoAutoTrading/engine.ts` 在委託送出後，用 `signal.referencePrice` 寫入進出場價格；平倉損益為參考價差乘以本地數量。委託被接受與實際成交是不同狀態，原生停損或交易所手動操作也可能使本地紀錄落後。

建議新增原始委託、成交、資金流水、帳戶快照與同步游標資料，依 `userId + accountId + exchange + environment` 隔離。成交與資金流水各以交易所識別碼去重，使用 decimal 字串保存價格與數量；依商品規格處理精度。

同步後由實際成交更新倉位。保留原始訊號參考價，以便比較訊號價、成交均價及滑價；保留估算／已對帳／資料不完整狀態，不把缺漏資料當成零。

基本驗收：同一成交重抓不會重複入帳；部分成交不會當成全部成交；原生停損與外部平倉可被同步辨識；本地數量與交易所數量的差異能被標示。

### P1：倉位復盤及淨績效

一個倉位可以包含多張委託及多次成交。依帳戶、環境、商品與持倉方向整理，避免同時持有多空時混算；歷史起點若落在已開倉之後，必須標示缺少期初部位，不能自行假設部位為零。

點選倉位可跳到 Vela 的進出場時段，顯示加減倉、停損與費用；再連回訊號來源、策略版本、4 小時週期與進場條件。MAE／MFE、實際持倉時間及策略版本比較是我們可延伸加入的功能，不是本次確認 TradeVoyage 已完整提供的功能。

績效統計以完整倉位為一個樣本，明確區分成交筆數、委託數與交易次數。沿用回測指標的定義時，改用真實帳本作為輸入，且按 Demo、LIVE、現貨／永續、幣種與策略分開統計。

淨損益應依交易所欄位定義核對：已實現交易損益加上帶正負號的資金費率，再扣除尚未包含的手續費；若來源損益已扣某項費用，不重複扣除。返佣與費用幣別另記，避免以絕對值消除返佣方向。

帳戶權益、策略累積淨損益與排除存提款影響的報酬率分開呈現。原始錢包餘額增加可能來自入金，不能直接視為策略獲利；最大回撤也應基於明確定義的權益或報酬序列。

基本驗收：倉位可以追溯原始成交與訊號；部分平倉已實現損益不會消失；存提款不被當成獲利；統計頁能顯示期間、樣本數與資料完整度。

### P2：交易後 AI 分析

先使用現有 Gemini，避免為復盤先增加大量模型選擇。輸入可包括淨績效、策略版本、進出場條件、滑價、持倉時間及錯過／拒絕的訊號，讓報告回答「哪些條件有幫助、哪些成本吃掉獲利、哪些交易偏離規則」。

報告保存統計期間、樣本數、資料版本與參考交易 ID；對資料不足的結論明確標示限制。報告可以提出下次研究方向，策略參數與交易權限仍由既有設定及引擎控制。

## 需要重新設計的實作

- **儲存與帳戶隔離**：TradeVoyage 使用專案目錄的 CSV／JSON 與按交易所共用的程序快取。我們需要 D1／R2、使用者及帳戶隔離，匯入改成有游標且可續傳的分批工作。
- **API 金鑰保存**：它將 AI provider 金鑰連同設定寫入瀏覽器 localStorage。站內採用時，應沿用我們的伺服器端加密及 secrets 管理，前端只取得已設定狀態。
- **倉位計算精度**：Binance 路徑用固定 `0.01` 判定部位近似清空；小於該值的有效 BTC 部位可能被判成已平倉。我們應依商品數量步進與實際倉位處理。
- **方向與費用**：BitMEX 路徑以累積買量大於賣量判為 long，完全平倉時買賣量相等會落入 short；另有以絕對值處理費用的做法。參考資料流程時需重新驗證方向、返佣及部分平倉。
- **資金曲線定義**：其 `getEquityCurve` 讀取錢包餘額。策略報酬分析要另外處理存提款、內部轉帳與未實現損益。
- **模型名單與資料範圍**：README 的 22 款模型清單是該版本的配置，並非今天全部可用的驗證。AI 元件主要取最近 20 筆倉位，長期策略評估應提供完整期間統計與代表性樣本。

來源：[儲存、快取與錢包曲線](https://github.com/0x0funky/TradeVoyage/blob/e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf/lib/data_loader.ts)、[金鑰的 localStorage 保存](https://github.com/0x0funky/TradeVoyage/blob/e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf/lib/ai_types.ts)、[方向與精度](https://github.com/0x0funky/TradeVoyage/blob/e8a6a1f511ccf3d922f70d58acce13adb2aaa1bf/lib/position_calculator.ts)。

以上程式問題來自靜態讀碼，沒有執行該專案或做交易所對帳。若日後採用它的原始碼，須按 MIT 授權保留適用的版權與授權聲明。

## 本專案可沿用的模組

| 模組 | 沿用方式 |
| --- | --- |
| `app/services/bitgetService.ts` | 現有 v2／v3 查詢與交易 adapter，擴充唯讀成交及資金流水查詢 |
| `app/services/cryptoAutoTrading/engine.ts` | 保留訊號、Demo／LIVE 隔離、部位限制與去重；在對帳層確認實際成交 |
| `app/services/riskGuard.ts` | 保留確定性風控，帳本完善後評估改以已對帳資料作為輸入 |
| `app/services/backtest/metrics.ts` | 沿用勝率、Profit Factor、回撤與期望值的定義，另建立實際交易的統計入口 |
| `app/routes/dashboard.tsx` | 擴充交易績效與對帳狀態頁 |
| `app/features/home/components/VelaChart.tsx` | 可抽出共用圖表契約，新增成交標記與歷史時段定位 |

建議第一個開發項目為「Bitget Demo 成交對帳與倉位詳情」。先用 Demo 驗證資料契約與原生停損同步，再把同一套唯讀同步邏輯延伸至 LIVE；各階段完成後再加入下一層圖表與 AI 分析。
