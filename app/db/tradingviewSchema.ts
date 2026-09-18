/** @file TradingView 外部訊號紀錄與紙上配對交易；只存訊號內容與公開行情價格，不含帳戶或憑證。 */
import { integer, real, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

/** 每一次進入端點的請求（含被拒絕者）都留痕，才能回答「TradingView 到底有沒有送出」。 */
export const tradingviewSignals = sqliteTable('tradingview_signals', {
  id: text('id').primaryKey(),
  receivedAt: integer('received_at').notNull(),
  market: text('market').notNull(),
  symbol: text('symbol').notNull(),
  action: text('action'),
  price: real('price'),
  note: text('note'),
  /** ACCEPTED／REJECTED_AUTH／REJECTED_JSON／NO_CHANNEL，用來區分「沒送到」與「送到但被擋」。 */
  status: text('status').notNull(),
  slackOk: integer('slack_ok'),
  tradeEffect: text('trade_effect'),
  rawBody: text('raw_body'),
  error: text('error'),
}, table => [index('tradingview_signals_received_idx').on(table.receivedAt)]);

/** 進出場配對後的紙上交易；未平倉時 exit 欄位保持 null，不可用 0 代替缺值。 */
export const tradingviewTrades = sqliteTable('tradingview_trades', {
  id: text('id').primaryKey(),
  market: text('market').notNull(),
  symbol: text('symbol').notNull(),
  direction: text('direction').notNull(),
  entryAt: integer('entry_at').notNull(),
  entryPrice: real('entry_price').notNull(),
  entryNote: text('entry_note'),
  exitAt: integer('exit_at'),
  exitPrice: real('exit_price'),
  exitNote: text('exit_note'),
  returnPct: real('return_pct'),
  closed: integer('closed').notNull().default(0),
}, table => [
  index('tradingview_trades_open_idx').on(table.market, table.symbol, table.closed),
  index('tradingview_trades_entry_idx').on(table.entryAt),
]);
