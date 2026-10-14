/** @file TradingView 訊號績效頁資料；登入後才讀取 D1，且不回傳密鑰或頻道 ID。 */
import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { tradingviewSignals, tradingviewTrades } from '../../db/tradingviewSchema';
import { getUserId } from '../../utils/auth';
import { SIGNAL_RETENTION_MS, TRADE_RETENTION_MS } from './signalLog';
import type { TradeRecord } from './performance';

export interface SignalLogRow {
  id: string;
  receivedAt: number;
  market: string;
  symbol: string;
  action: string | null;
  price: number | null;
  status: string;
  slackOk: boolean | null;
  tradeEffect: string | null;
  error: string | null;
}

/** 明細上限避免單頁塞入整季資料；統計本身仍以完整交易紀錄計算。 */
const SIGNAL_LOG_LIMIT = 80;
const TRADE_LIMIT = 500;

export async function loadTradingviewSignals({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: Record<string, any> } }).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  const base = {
    now: Date.now(),
    signalRetentionDays: Math.round(SIGNAL_RETENTION_MS / 86_400_000),
    tradeRetentionDays: Math.round(TRADE_RETENTION_MS / 86_400_000),
    /** 只揭露是否已設定，token 與頻道 ID 絕不傳給瀏覽器。 */
    webhookEnabled: env.TRADINGVIEW_WEBHOOK_ENABLED === 'true',
    webhookConfigured: env.TRADINGVIEW_WEBHOOK_ENABLED === 'true' && Boolean(env.TRADINGVIEW_WEBHOOK_SECRET),
  };
  try {
    const db = drizzle(env.DB);
    const [tradeRows, signalRows] = await Promise.all([
      db.select().from(tradingviewTrades).orderBy(desc(tradingviewTrades.entryAt)).limit(TRADE_LIMIT),
      db.select().from(tradingviewSignals).orderBy(desc(tradingviewSignals.receivedAt)).limit(SIGNAL_LOG_LIMIT),
    ]);
    const trades: TradeRecord[] = tradeRows.map(row => ({
      id: row.id, market: row.market, symbol: row.symbol,
      direction: row.direction === 'SHORT' ? 'SHORT' : 'LONG',
      entryAt: row.entryAt, entryPrice: row.entryPrice, entryNote: row.entryNote,
      exitAt: row.exitAt, exitPrice: row.exitPrice, returnPct: row.returnPct, closed: row.closed === 1,
    }));
    const signals: SignalLogRow[] = signalRows.map(row => ({
      id: row.id, receivedAt: row.receivedAt, market: row.market, symbol: row.symbol,
      action: row.action, price: row.price, status: row.status,
      slackOk: row.slackOk == null ? null : row.slackOk === 1,
      tradeEffect: row.tradeEffect, error: row.error,
    }));
    return { ...base, trades, signals, error: null as string | null };
  } catch {
    return { ...base, trades: [] as TradeRecord[], signals: [] as SignalLogRow[],
      error: 'TradingView 訊號資料尚未就緒，請確認資料庫 migration 已套用。' };
  }
}
