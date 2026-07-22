import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 【詳細繁體中文註解】：使用者資料表
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  
  // Telegram 機器人綁定資訊 (加密儲存)
  telegramBotToken: text('telegram_bot_token'),
  telegramChatId: text('telegram_chat_id'),
  
  // 交易所 API 金鑰 (加密儲存)
  binanceApiKey: text('binance_api_key'),
  binanceApiSecret: text('binance_api_secret'),
  pionexApiKey: text('pionex_api_key'),
  pionexApiSecret: text('pionex_api_secret'),

  // 【詳細繁體中文註解】：Alpaca 券商 API 金鑰 (加密儲存)。
  // 目前僅預留欄位，尚未實作(美股改走 Bitget 股票代幣(rToken)自動下單，見下方欄位)。
  alpacaApiKey: text('alpaca_api_key'),
  alpacaApiSecret: text('alpaca_api_secret'),

  // 【詳細繁體中文註解】：Bitget API 金鑰 (加密儲存)。
  // Bitget 簽名機制需要額外的 passphrase(建立 API 金鑰時自訂)，與 Binance 只需 key+secret 不同。
  // 用途:(1) 作為加密貨幣自動交易的第二個可選交易所(見 preferredExchange)
  //      (2) 美股代幣(rToken，如 RCOINUSDT)自動下單 — Bitget 是唯一支援此功能的交易所
  bitgetApiKey: text('bitget_api_key'),
  bitgetApiSecret: text('bitget_api_secret'),
  bitgetPassphrase: text('bitget_passphrase'),

  // 【詳細繁體中文註解】：加密貨幣自動交易偏好使用的交易所:BINANCE(預設，向下相容既有行為) | BITGET
  preferredExchange: text('preferred_exchange').default('BINANCE').notNull(),

  // 【詳細繁體中文註解】：虛擬幣概念美股「自動下單」總開關(預設關閉)。
  // 關閉時，美股訊號僅發送 Slack 通知(既有行為);開啟且 Bitget 金鑰齊全時，
  // 系統會透過 Bitget 股票代幣(rToken)實際下單，同樣受 tradingMode(PAPER/LIVE)
  // 與 liveTradingEnabled 雙重開關保護。
  stockAutoTradingEnabled: integer('stock_auto_trading_enabled', { mode: 'boolean' }).default(false).notNull(),

  // 帳號建立與更新時間
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  
  // 交易模式: PAPER (模擬) 或 LIVE (實戰)
  tradingMode: text('trading_mode').default('PAPER').notNull(),
  
  // 【詳細繁體中文註解】：策略盯盤參考的 K 線週期，支援 '5m', '15m', '1h', '4h'
  strategyTimeframe: text('strategy_timeframe').default('4h').notNull(),

  // 本金保護設定
  capitalBaseUsdt: text('capital_base_usdt').default('1000').notNull(),
  maxRiskPerTradePct: text('max_risk_per_trade_pct').default('0.5').notNull(),
  maxDailyLossPct: text('max_daily_loss_pct').default('1').notNull(),
  maxPositionSizePct: text('max_position_size_pct').default('10').notNull(),
  riskStopLossPct: text('risk_stop_loss_pct').default('5').notNull(),
  maxOpenPositions: integer('max_open_positions').default(2).notNull(),
  maxTradesPerDay: integer('max_trades_per_day').default(3).notNull(),
  cryptoCrashGuardEnabled: integer('crypto_crash_guard_enabled', { mode: 'boolean' }).default(true).notNull(),
  liveTradingEnabled: integer('live_trading_enabled', { mode: 'boolean' }).default(false).notNull(),
});

// 【詳細繁體中文註解】：交易紀錄表 (包含模擬與實戰)
export const paperTrades = sqliteTable('paper_trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  
  // 交易模式: PAPER 或 LIVE
  mode: text('mode').default('PAPER').notNull(),

  // 【詳細繁體中文註解】：市場類型，預設 CRYPTO 向下相容既有資料。
  // US 代表美股代幣(Bitget rToken)自動交易產生的紀錄，symbol 為實際下單的代幣交易對(如 RCOINUSDT)。
  market: text('market').default('CRYPTO').notNull(),

  // 【詳細繁體中文註解】：實際下單的交易所，預設 BINANCE 向下相容既有資料。
  // 平倉時需依「開倉當時的交易所」送出賣單，不可用使用者當下的偏好設定
  // (使用者可能在持倉期間切換偏好交易所，此欄位確保平倉單送到正確的交易所)。
  exchange: text('exchange').default('BINANCE').notNull(),

  // 交易對 (例如: BTCUSDT)
  symbol: text('symbol').notNull(),
  // 方向: BUY 或 SELL (目前抄底策略主要記錄 BUY 後等待 SELL)
  side: text('side').notNull(),
  // 狀態: OPEN (持倉中), CLOSED (已平倉)
  status: text('status').notNull(),
  
  // 進場價格與數量
  entryPrice: text('entry_price').notNull(),
  amount: text('amount').notNull(), // 虛擬購買的數量
  
  // 出場價格與損益
  stopLossPrice: text('stop_loss_price'),
  exitPrice: text('exit_price'),
  pnl: text('pnl'), // 損益金額 (USDT)
  
  // 策略觸發原因 (可選記錄 RSI 數值等)
  reason: text('reason'),
  
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  closedAt: text('closed_at'),
});

// 【詳細繁體中文註解】：使用者持股與追蹤清單
export const userPortfolio = sqliteTable('user_portfolio', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  
  // 股票或幣種代號 (例如: 2330.TW, BTC/USD)
  symbol: text('symbol').notNull(),
  // 名稱 (例如: 台積電)
  name: text('name'),
  // 市場類型: US, TW, CRYPTO
  market: text('market').notNull(),
  
  // 投資資訊 (新增)
  avgPrice: text("avg_price"),
  shares: text("shares"),
  fees: text("fees"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 【詳細繁體中文註解】：K 線歷史快取表 — 回測資料的唯一真相來源。
// 資料來源：加密貨幣走 Binance 公開行情 API(不用 OKX fallback,避免量價單位不同污染資料)、
// 美股走 Yahoo Finance 日線(不做即時價覆寫,避免回測前視偏差)。
// open_time 為該根 K 線「開盤時間」的毫秒 UTC timestamp;
// (symbol, interval, open_time) 唯一,重複寫入以 INSERT OR IGNORE 略過。
export const klineCache = sqliteTable('kline_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // 標的代號:加密貨幣如 BTCUSDT、美股如 COIN
  symbol: text('symbol').notNull(),
  // 市場類型:CRYPTO | US
  market: text('market').notNull(),
  // K 線週期:15m | 1h | 4h | 1d
  interval: text('interval').notNull(),
  // K 線開盤時間 (毫秒 UTC)
  openTime: integer('open_time').notNull(),
  open: real('open').notNull(),
  high: real('high').notNull(),
  low: real('low').notNull(),
  close: real('close').notNull(),
  volume: real('volume').notNull(),
}, (table) => [
  uniqueIndex('idx_kline_unique').on(table.symbol, table.interval, table.openTime),
]);

// 【詳細繁體中文註解】：回測主檔 — 一列代表一次回測任務與其結果。
// status 流程:PENDING → PREPARING(補歷史資料) → RUNNING(逐根重放計算) → DONE / ERROR。
// params_json 保存完整回測參數(策略參數、手續費率、滑價、fillMode、初始資金),
// 確保結果可重現;result_json 保存績效指標;equity_curve_json 為降採樣後(≤1000 點)的權益曲線。
export const backtests = sqliteTable('backtests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  // 策略 id,對應 app/services/strategy/registry.ts 的註冊表
  strategyId: text('strategy_id').notNull(),
  symbol: text('symbol').notNull(),
  // 市場類型:CRYPTO | US
  market: text('market').notNull(),
  interval: text('interval').notNull(),
  // 回測起訖時間 (毫秒 UTC)
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time').notNull(),
  // 回測完整參數 JSON (策略參數 + 費率 + 滑價 + fillMode + 初始資金)
  paramsJson: text('params_json').notNull(),
  status: text('status').default('PENDING').notNull(),
  // 分段執行游標 (毫秒):資料補抓或計算被 Workers CPU/subrequest 上限中斷時,由此續跑
  progressCursor: integer('progress_cursor'),
  resultJson: text('result_json'),
  equityCurveJson: text('equity_curve_json'),
  error: text('error'),
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 【詳細繁體中文註解】：回測交易明細 — 逐筆記錄回測中每次進出場。
// pnl 已扣除進出雙邊手續費與滑價(與 paper_trades.pnl 未扣費不同,對帳時需注意此差異)。
export const backtestTrades = sqliteTable('backtest_trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  backtestId: integer('backtest_id').notNull().references(() => backtests.id),
  // 方向:LONG | SHORT (SHORT 僅回測模擬,現貨實盤不支援做空)
  side: text('side').notNull(),
  entryTime: integer('entry_time').notNull(),
  exitTime: integer('exit_time'),
  entryPrice: real('entry_price').notNull(),
  exitPrice: real('exit_price'),
  quantity: real('quantity').notNull(),
  // 進出雙邊手續費合計 (USDT 或 USD)
  fee: real('fee').default(0).notNull(),
  pnl: real('pnl'),
  pnlPct: real('pnl_pct'),
  // 持倉 K 線根數
  holdingBars: integer('holding_bars'),
  entryReason: text('entry_reason'),
  exitReason: text('exit_reason'),
}, (table) => [
  index('idx_bt_trades').on(table.backtestId),
]);
