import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
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
