/** @file TradingView 訊號落地與紙上配對的資料庫副作用；失敗一律吞掉，不得影響 Slack 推播或回應狀態。 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { tradingviewSignals, tradingviewTrades } from '../../db/tradingviewSchema';
import { resolveTradeEffect, type OpenTrade } from './pairing';

export interface TradingviewLogEnv {
  DB?: Parameters<typeof drizzle>[0];
}

/** 區分「根本沒送到」與「送到但被擋」，這是排查 webhook 沒反應時唯一的依據。 */
export type SignalStatus = 'ACCEPTED' | 'REJECTED_AUTH' | 'REJECTED_JSON' | 'NO_CHANNEL';

export interface SignalLogInput {
  receivedAt: number;
  market: string;
  symbol: string;
  action: string | null;
  price: number | null;
  note: string | null;
  status: SignalStatus;
  slackOk: boolean | null;
  rawBody: string;
  error?: string | null;
}

/** 原始 payload 只留開頭片段；完整內容對排查沒有額外幫助，卻會讓資料表快速膨脹。 */
const RAW_BODY_LIMIT = 500;
/** 原始 log 保留兩個月；配對後的交易紀錄極小，保留一年以維持長期績效統計。 */
export const SIGNAL_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
export const TRADE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
/**
 * 密鑰錯誤的請求也要留痕才能排查，但端點是公開網址，無條件寫入等於把 D1 寫入額度
 * 交給任何掃描者消耗。這裡以 isolate 層級節流：同一個 isolate 每分鐘最多記一筆。
 */
const REJECTION_THROTTLE_MS = 60_000;
let lastRejectionLoggedAt = 0;

export function shouldLogRejection(now: number) {
  if (now - lastRejectionLoggedAt < REJECTION_THROTTLE_MS) return false;
  lastRejectionLoggedAt = now;
  return true;
}

async function findOpenTrade(db: ReturnType<typeof drizzle>, market: string, symbol: string): Promise<OpenTrade | null> {
  const rows = await db.select().from(tradingviewTrades)
    .where(and(eq(tradingviewTrades.market, market), eq(tradingviewTrades.symbol, symbol), eq(tradingviewTrades.closed, 0)))
    .orderBy(desc(tradingviewTrades.entryAt)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, direction: row.direction === 'SHORT' ? 'SHORT' : 'LONG', entryPrice: row.entryPrice };
}

/**
 * 寫入一筆訊號紀錄，並在訊號有效時更新紙上部位。
 * 回傳人類可讀的配對結果字串（同時存進 log），讓頁面能解釋「為什麼這筆沒有算進績效」。
 */
export async function recordTradingviewSignal(env: TradingviewLogEnv, input: SignalLogInput): Promise<string | null> {
  if (!env.DB) return null;
  try {
    const db = drizzle(env.DB);
    let effectLabel: string | null = null;

    /** 通過驗證且能解析的訊號都要配對；Slack 頻道沒設定只是通知漏掉，不影響訊號本身的有效性。 */
    if (input.status === 'ACCEPTED' || input.status === 'NO_CHANNEL') {
      const openTrade = await findOpenTrade(db, input.market, input.symbol);
      const effect = resolveTradeEffect({ action: input.action, price: input.price }, openTrade);
      if (effect.kind === 'OPEN') {
        await db.insert(tradingviewTrades).values({
          id: crypto.randomUUID(), market: input.market, symbol: input.symbol, direction: effect.direction,
          entryAt: input.receivedAt, entryPrice: input.price as number, entryNote: input.note, closed: 0,
        });
        effectLabel = `建立${effect.direction === 'LONG' ? '多單' : '空單'}部位`;
      } else if (effect.kind === 'CLOSE') {
        await db.update(tradingviewTrades).set({
          exitAt: input.receivedAt, exitPrice: input.price, exitNote: input.note,
          returnPct: effect.returnPct, closed: 1,
        }).where(eq(tradingviewTrades.id, effect.tradeId));
        effectLabel = `平倉，報酬 ${effect.returnPct >= 0 ? '+' : ''}${effect.returnPct.toFixed(2)}%`;
      } else {
        effectLabel = `未計入績效：${effect.reason}`;
      }
    }

    await db.insert(tradingviewSignals).values({
      id: crypto.randomUUID(), receivedAt: input.receivedAt, market: input.market, symbol: input.symbol,
      action: input.action, price: input.price, note: input.note, status: input.status,
      slackOk: input.slackOk == null ? null : (input.slackOk ? 1 : 0), tradeEffect: effectLabel,
      rawBody: input.rawBody.slice(0, RAW_BODY_LIMIT), error: input.error ?? null,
    });
    return effectLabel;
  } catch (error) {
    /** 落地失敗不能影響已經送出的 Slack 通知，也不能讓 TradingView 收到非 2xx 而重試轟炸。 */
    console.error('🔥 [TradingView Webhook] 訊號紀錄寫入失敗:', error);
    return null;
  }
}

/** 由每日排程呼叫；原始 log 與已平倉交易分開設定保留期限，未平倉部位永不清除。 */
export async function pruneTradingviewData(env: TradingviewLogEnv, now = Date.now()) {
  if (!env.DB) return;
  try {
    const db = drizzle(env.DB);
    await db.delete(tradingviewSignals).where(lt(tradingviewSignals.receivedAt, now - SIGNAL_RETENTION_MS));
    await db.delete(tradingviewTrades).where(and(
      eq(tradingviewTrades.closed, 1), lt(tradingviewTrades.entryAt, now - TRADE_RETENTION_MS)));
  } catch (error) {
    console.error('🔥 [TradingView Webhook] 舊資料清理失敗:', error);
  }
}
