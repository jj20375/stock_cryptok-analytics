# US/TW/Crypto 智能交易分析系統 (React Router v7)

這是一個基於 **React Router v7** 框架建構的全端交易分析系統，支援美股 (US)、台股 (TW) 與加密貨幣 (Crypto) 的即時數據抓取、技術指標運算，以及 **Gemini AI** 驅動的智能交易策略分析。

## 🚀 系統核心功能

- **多市場即時監控**：整合 Yahoo Finance 與 台灣證交所 (TWSE) API，實時抓取各市場前 50 大交易量標的。
- **高階技術圖表**：採用 `klinecharts` 引擎，提供專業級的 K 線圖，支援多週期切換與自定義技術指標顯示（MA, EMA, MACD, RSI, KD 等）。
- **全自動技術掃描**：一鍵掃描當前市場熱點，根據量化篩選邏輯過濾出具備「底部反轉」或「強勢突破」潛力的標的。
- **Gemini AI 智能洞察**：
  - **個股策略產生器**：針對特定標的進行深度技術分析，並生成具體的進場、止損與止盈劇本。
  - **掃描器 AI 點評**：自動為掃描出的熱門標的提供 20 字以內的 AI 洞察建議。
- **後端安全架構**：所有的外部 API 請求與 Gemini AI 呼叫皆在伺服器端 (Server Action/Loader) 處理，確保 API Key 不會暴露於客戶端。

## 🛠 技術棧

- **框架**: [React Router v7 (Full-stack Framework)](https://reactrouter.com/)
- **UI 樣式**: Tailwind CSS 4, Lucide React (圖標)
- **圖表庫**: KlineCharts v9.x
- **AI 引擎**: Google Gemini 3 Flash / Pro
- **數據源**: Yahoo Finance SDK / API, 台灣證券交易所 (TWSE) JSON 端點

## 📋 環境需求

此專案依賴於最新的 Node.js API 與 React Router v7 引擎，請確保您的開發環境符合以下要求：

- **Node.js**: `v20.19.6` 或更高版本 (強制要求)
- **套件管理器**: `npm` (推薦)

## 📦 安裝與啟動

1. **安裝依賴套件**:
   ```bash
   npm install
   ```

2. **設定環境變數**:
   在專案根目錄建立 `.env` 檔案，並加入您的 Gemini API 金鑰：
   ```env
   GEMINI_API_KEY=您的_API_KEY_在此
   ```

3. **啟動開發伺服器**:
   ```bash
   npm run dev
   ```

4. **編譯生產版本**:
   ```bash
   npm run build
   ```

## 🛡 安全說明

本系統已全面改進為 **Server-Side API** 架構。Gemini API 金鑰僅在伺服器環境中讀取，瀏覽器端的網路日誌 (Network Log) 僅會顯示對內部 `/api/gemini` 的通訊，無法獲取您的私密金鑰。

## ⚠️ 免責聲明

本系統提供的所有數據與 AI 分析內容僅供參考，不構成任何投資建議。金融市場投資具有風險，請使用者務必自行評估並承擔相關風險。

---
*本專案程式碼均附帶繁體中文詳細註解。*
