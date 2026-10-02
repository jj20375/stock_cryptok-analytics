---
name: project-context
description: 詳述本專案 (us-tw-crypto-analytics-2) 的技術架構、引用 API 與專案結構，讓 AI 助手能快速理解上下文。
---

# 專案上下文：股市與加密貨幣分析平台

本專案是一個整合台灣股市、美國股市及加密貨幣即時監控與自動化交易的 Web 應用程式。

## 1. 技術架構 (Tech Stack)

- **前端與路由**：React Router v7 (SSR 模式)。
- **部署環境**：Cloudflare Workers。
- **資料庫**：Cloudflare D1 (使用 Drizzle ORM 管理)。
- **定時任務**：Cloudflare Cron Triggers (每 15 分鐘執行一次策略引擎)。

## 2. 整合的 API 服務 (Integrated APIs)

本專案目前串接並引用了以下服務，開發時請務必遵循其呼叫邏輯：

### 📈 股市資料 (Stock Data)

- **Yahoo Finance API (代理模式)**：
  - 用途：抓取台股/美股的即時與歷史 K 線數據。
  - 端點：`https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`。
- **TWSE API (台灣證券交易所)**：
  - 用途：取得台股每日收盤行情、成交量排名及前 50 大股票清單。
  - 端點：`https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&type=ALL`。

### ₿ 加密貨幣 (Crypto Data & Trading)

- **Binance API**：
  - 用途：抓取加密貨幣即時行情、計算技術指標及執行自動化交易 (模擬/實戰)。
  - 功能：支援 K 線抓取、測試單/正式單下單。

### 🤖 AI 與通知 (AI & Notifications)

- **Google Gemini 2.0 Flash**：
  - 用途：根據股市數據提供 AI 盤勢分析與建議。
- **Telegram Bot API**：
  - 用途：將交易訊號、成交通知及每日爆量篩選結果推送至使用者手機。

## 3. 核心目錄結構

- `/app/routes/`：頁面與 API 路由 (如 `api.stock.ts`, `api.top50.ts`)。
- `/app/services/`：核心邏輯與外部服務整合 (如 `stockService.ts`, `strategyEngine.ts`, `binanceService.ts`)。
- `/app/db/`：資料庫 Schema 與 Drizzle 配置。
- `/drizzle/`：資料庫遷移文件。

## 4. 當前重點策略 (Current Key Strategies)

- **加密貨幣**：RSI 超跌 + 均線乖離回歸策略。
- **台灣股市**：每日成交量暴增 (今日量 > 5MV * 2) 且逼近壓力線之潛力股篩選。
