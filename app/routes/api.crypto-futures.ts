/** @file 登入者合約預覽與手動 Demo 入口；同源、限流、伺服器重算且不能選 LIVE。 */
import type { ActionFunctionArgs } from 'react-router';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users, cryptoAutoOrders } from '../db/schema';
import { getUserId } from '../utils/auth';
import { validFuturesSymbol } from '../services/cryptoFutures/market.server';
import { futuresSnapshot } from '../services/cryptoFutures/snapshot.server';
import { processCryptoDemoSignal } from '../services/cryptoAutoTrading/engine';
import { cryptoNewEntriesAllowed } from '../services/cryptoActivityPolicy';
import type { FuturesIntent } from '../services/cryptoAutoTrading/types';
import { FUTURES_AUTO_STRATEGIES, FUTURES_PREVIEW_SYMBOLS, futuresFundingHours } from '../services/cryptoFutures/automation';
import { readSyncBody } from '../services/freqtrade/body.server';

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context as any).cloudflare.env;
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const userId = await getUserId(request, env);
  if (!userId) return reply({ error: '請先登入' }, 401);
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(request.url).origin || !request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: '請從本站提交 JSON 請求' }, 403);
  try {
    const raw = await readSyncBody(request, 2048);
    const body = JSON.parse(raw), { symbol, strategyId } = body;
    if (!validFuturesSymbol(symbol) || !(FUTURES_PREVIEW_SYMBOLS as readonly string[]).includes(symbol) || !FUTURES_AUTO_STRATEGIES.some(strategy => strategy.id === strategyId)
      || !['preview', 'execute', 'close'].includes(body.action)) return reply({ error: 'Demo 預覽支援 BTC／ETH／SOL／ADA 與選單中的合約策略' }, 400);
    /** 原子限流為所有 Worker 共用，不能用並行請求重複抓取行情或送單。 */
    const now = Date.now();
    const lease = await env.DB.prepare(`INSERT INTO crypto_futures_rate_limits(user_id,next_at) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET next_at=excluded.next_at WHERE next_at<=? RETURNING user_id`).bind(userId, now + 10_000, now).first();
    if (!lease) return reply({ error: '請等十秒後再操作' }, 429);
    const db = drizzle(env.DB), user = await db.select().from(users).where(eq(users.id, userId)).get();
    const entriesEnabled = cryptoNewEntriesAllowed(env) && !!user?.internalDemoAutoTradingEnabled;
    if (body.action === 'execute' && !entriesEnabled) return reply({ error: '新倉目前停用，請先於設定與部署政策啟用 Demo 新倉' }, 409);
    const feeRate = Number(body.feeRate ?? 0.0006);
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.01) return reply({ error: '合約費率無效' }, 400);
    const snapshot = await futuresSnapshot(env, userId, symbol, strategyId, feeRate);
    if (body.action === 'preview') return reply({ ...snapshot, entriesEnabled });
    let intent: FuturesIntent;
    if (body.action === 'close') {
      if (!snapshot.position) return reply({ error: '沒有本系統的 Demo 持倉' }, 409);
      intent = snapshot.position.side === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    } else {
      if (snapshot.action.type !== 'ENTRY' || snapshot.signalAt !== Number(body.signalAt) || now - snapshot.signalAt > 30 * 60_000) return reply({ error: '訊號已失效、過期或未確認，請重新預覽' }, 409);
      intent = snapshot.action.side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT';
    }
    /** 平倉五分鐘內共用 ID；未知結果由 CLOSE_PENDING 擋重送，明確失敗則下一窗口可重試。 */
    const id = `futures:${strategyId}:${symbol}:${intent}:${body.action === 'close' ? `${snapshot.position!.entryTime}:${Math.floor(now / 300_000)}` : snapshot.signalAt}`;
    const intentLabel: Record<FuturesIntent, string> = { OPEN_LONG: '開多', OPEN_SHORT: '開空', CLOSE_LONG: '平多', CLOSE_SHORT: '平空' };
    await processCryptoDemoSignal(env, { id, source: 'INTERNAL', symbol, intent, action: ['OPEN_LONG', 'CLOSE_SHORT'].includes(intent) ? 'BUY' : 'SELL',
      signalAt: snapshot.signalAt, referencePrice: snapshot.metadata.price, label: `${snapshot.strategyName}・${intentLabel[intent]}`, strategyId, strategyParams: snapshot.strategyParams,
      entryPlan: snapshot.action.type === 'ENTRY' ? snapshot.action.entryPlan : undefined, feeRate,
      fundingBudgetRate: Math.max(0, snapshot.metadata.fundingRate * (intent === 'OPEN_SHORT' ? -1 : 1)) * Math.ceil(futuresFundingHours(strategyId, snapshot.strategyParams) / snapshot.metadata.fundingInterval) }, userId);
    const audit = await db.select().from(cryptoAutoOrders).where(and(eq(cryptoAutoOrders.userId, userId), eq(cryptoAutoOrders.sourceEventId, id), eq(cryptoAutoOrders.executionMode, 'DEMO'))).get();
    return audit ? reply({ status: audit.status, reason: audit.reason, orderId: audit.bitgetOrderId }) : reply({ error: 'Demo 未送單，請檢查 Demo 憑證與來源授權' }, 409);
  } catch (error) {
    const message = error instanceof Error ? error.message : '合約操作失敗';
    /** 其他資料表缺漏不能誤報成限流遷移；本機與正式 D1 需分別套用。 */
    return reply({ error: /no such table:\s*crypto_futures_rate_limits\b/i.test(message)
      ? '此環境尚未套用合約限流資料庫更新，請聯絡管理者完成更新。' : message }, 400);
  }
}
