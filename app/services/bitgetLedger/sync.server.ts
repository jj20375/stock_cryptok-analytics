/** @file 每次同步至多三頁；寫入與游標在同一 D1 batch 提交，失敗可安全重抓。 */
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { bitgetLedgerAccounts } from '../../db/schema';
import { fetchLedgerPage, fetchLedgerSnapshot, fetchOpenLedgerOrders, detectLedgerDialect } from './api.server';
import { loadLedgerCredentials, registerLedgerAccount, type LedgerEnv } from './credentials.server';
import { reconcileLocalTrades } from './reconcile.server';
import type { Bill, Dialect, Fill, Order, Scope, Stream, SyncCursor } from './types';
/** API 歷史上限 90 天；七日查詢窗口兼容 Classic 與 UTA，UTC 毫秒。 */
const DAY = 86_400_000, WINDOW = 7 * DAY, OVERLAP = 5 * 60_000;
const streams: Stream[] = ['orders', 'fills', 'bills'];
function newCursor(start: number, now: number): SyncCursor {
  return { start, end: Math.min(start + WINDOW - 1, now), pages: {
    orders: { cursor: null, done: false }, fills: { cursor: null, done: false }, bills: { cursor: null, done: false },
  } };
}
function rowWrite(env: LedgerEnv, scope: Scope, token: string, stream: Stream, row: Fill | Order | Bill) {
  let table: string, columns: string[], values: unknown[], update = '';
  const base = [scope.id + ':' + row.exchangeId, scope.id, row.exchangeId];
  if (stream === 'fills') {
    const r = row as Fill;
    table = 'bitget_ledger_fills';
    columns = ['id','account_id','exchange_id','order_id','client_oid','symbol','side','position_side','effect','price','quantity','realized_pnl','fees_json','executed_at'];
    values = [...base, r.orderId, r.clientOid, r.symbol, r.side, r.positionSide, r.effect, r.price, r.quantity, r.realizedPnl, JSON.stringify(r.fees), r.executedAt];
  } else if (stream === 'bills') {
    const r = row as Bill;
    table = 'bitget_ledger_bills';
    columns = ['id','account_id','exchange_id','symbol','coin','type','amount','balance','occurred_at'];
    values = [...base, r.symbol, r.coin, r.type, r.amount, r.balance, r.occurredAt];
  } else {
    const r = row as Order;
    table = 'bitget_ledger_orders';
    columns = ['id','account_id','exchange_id','client_oid','symbol','side','position_side','status','quantity','filled_quantity','average_price','updated_at'];
    values = [...base, r.clientOid, r.symbol, r.side, r.positionSide, r.status, r.quantity, r.filledQuantity, r.averagePrice, r.updatedAt];
  }
  /** 端點可能補上費用或最終狀態；重抓相同交易所 ID 以最新資料更新，絕不重複計數。 */
  update = columns.slice(3).map(column => `${column}=excluded.${column}`).join(',');
  return env.DB.prepare(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${values.map(() => '?').join(',')}
    WHERE EXISTS (SELECT 1 FROM bitget_ledger_accounts WHERE id=? AND lease_token=? AND lease_until>?)
    ON CONFLICT(id) DO UPDATE SET ${update}${stream === 'orders' ? ' WHERE excluded.updated_at >= bitget_ledger_orders.updated_at' : ''}`).bind(...values, scope.id, token, Date.now());
}
export async function syncLedger(env: LedgerEnv, userId: number, environment: Scope['environment'], days = 30, preferredDialect?: Dialect) {
  const { scope, credentials } = await loadLedgerCredentials(env, userId, environment);
  await registerLedgerAccount(env, scope);
  const db = drizzle(env.DB), token = crypto.randomUUID(), now = Date.now();
  /** 兩分鐘租約涵蓋三頁歷史、待成交狀態與快照請求；失效者無法覆寫新游標。 */
  const lease = await db.update(bitgetLedgerAccounts).set({ leaseUntil: now + 120_000, leaseToken: token, lastAttemptAt: now })
    .where(and(eq(bitgetLedgerAccounts.id, scope.id), sql`${bitgetLedgerAccounts.leaseUntil} <= ${now}`)).returning().get();
  if (!lease) return { accountId: scope.id, busy: true, message: '此帳戶同步中' };
  try {
    const dialect: Dialect = preferredDialect ?? (lease.dialect === 'UTA_V3' || lease.dialect === 'CLASSIC_V2'
      ? lease.dialect : await detectLedgerDialect(credentials, scope));
    const desiredFrom = now - Math.min(89, Math.max(1, days)) * DAY;
    if (!lease.cursorJson && lease.coveredFrom !== null && lease.coveredFrom > desiredFrom + DAY) {
      /** 擴大匯入範圍要重新完成連續覆蓋；既存成交不刪除，去重寫入安全重用。 */
      lease.coveredFrom = null; lease.coveredTo = null;
      await db.update(bitgetLedgerAccounts).set({ coveredFrom: null, coveredTo: null }).where(and(eq(bitgetLedgerAccounts.id, scope.id), eq(bitgetLedgerAccounts.leaseToken, token))).run();
    }
    let cursor: SyncCursor = lease.cursorJson ? JSON.parse(lease.cursorJson) : newCursor(
      lease.coveredTo ? Math.max(lease.coveredTo - OVERLAP, now - 89 * DAY) : now - Math.min(89, Math.max(1, days)) * DAY, now);
    for (const stream of streams) {
      if (cursor.pages[stream].done) continue;
      const page = await fetchLedgerPage(stream, cursor, dialect, credentials, scope);
      cursor = { ...cursor, pages: { ...cursor.pages, [stream]: { cursor: page.next, done: page.done } } };
      const writes = page.rows.map(row => rowWrite(env, scope, token, stream, row));
      writes.push(env.DB.prepare('UPDATE bitget_ledger_accounts SET cursor_json=?,dialect=? WHERE id=? AND lease_token=? AND lease_until>?')
        .bind(JSON.stringify(cursor), dialect, scope.id, token, Date.now()));
      const results = await env.DB.batch(writes);
      if (!results.at(-1)?.meta.changes) throw new Error('同步租約已失效');
    }
    /** 快照只有完整成功才寫入；API 失敗不能視為空倉並關閉本地持倉。 */
    const pendingOrders = await fetchOpenLedgerOrders(dialect, credentials, scope);
    if (pendingOrders.length) await env.DB.batch(pendingOrders.map(row => rowWrite(env, scope, token, 'orders', row)));
    const snapshot = await fetchLedgerSnapshot(dialect, credentials, scope);
    const complete = streams.every(stream => cursor.pages[stream].done);
    const next = complete && cursor.end < now - OVERLAP ? newCursor(cursor.end, now) : complete ? null : cursor;
    const saved = await db.update(bitgetLedgerAccounts).set({ dialect, cursorJson: next ? JSON.stringify(next) : null,
      coveredFrom: complete ? lease.coveredFrom ?? cursor.start : lease.coveredFrom,
      coveredTo: complete ? Math.max(lease.coveredTo ?? 0, cursor.end) : lease.coveredTo,
      lastSyncedAt: Date.now(), error: null, snapshotJson: JSON.stringify(snapshot),
    }).where(and(eq(bitgetLedgerAccounts.id, scope.id), eq(bitgetLedgerAccounts.leaseToken, token), sql`${bitgetLedgerAccounts.leaseUntil} > ${Date.now()}`)).returning().get();
    if (!saved) throw new Error('同步租約已失效');
    await reconcileLocalTrades(env, userId, scope.id);
    return { accountId: scope.id, busy: false, message: next ? '已保存本輪資料，可繼續同步' : '已同步至本輪查詢時間' };
  } catch (error) {
    /** 對外只保存錯誤代碼，交易所訊息可能含請求細節，不儲存原始例外。 */
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code).replace(/[^0-9A-Z_-]/g, '').slice(0, 20) : '';
    const message = `同步未完成${code ? `（Bitget ${code}）` : ''}，已保留游標，請檢查憑證或稍後重試`;
    await db.update(bitgetLedgerAccounts).set({ error: message }).where(and(eq(bitgetLedgerAccounts.id, scope.id), eq(bitgetLedgerAccounts.leaseToken, token))).run();
    throw new Error(message);
  } finally {
    await db.update(bitgetLedgerAccounts).set({ leaseUntil: 0, leaseToken: null })
      .where(and(eq(bitgetLedgerAccounts.id, scope.id), eq(bitgetLedgerAccounts.leaseToken, token))).run();
  }
}
/** 最舊嘗試優先且每輪兩個帳戶，避免單一大量歷史帳戶吃完 Worker 額度。 */
export async function syncRegisteredLedgers(env: LedgerEnv, environment?: Scope['environment']) {
  /** 本機 Demo 排程只查詢模擬帳本；既有雲端呼叫未指定時維持原本範圍。 */
  const due = or(sql`${bitgetLedgerAccounts.lastAttemptAt} IS NULL`, sql`${bitgetLedgerAccounts.lastAttemptAt} < ${Date.now() - 240_000}`);
  const rows = await drizzle(env.DB).select().from(bitgetLedgerAccounts)
    .where(environment ? and(due, eq(bitgetLedgerAccounts.environment, environment)) : due)
    .orderBy(asc(bitgetLedgerAccounts.lastAttemptAt)).limit(2).all();
  for (const row of rows) {
    try {
      const current = await loadLedgerCredentials(env, row.userId, row.environment as Scope['environment']);
      if (current.scope.id !== row.id) {
        await drizzle(env.DB).update(bitgetLedgerAccounts).set({ lastAttemptAt: Date.now(), error: '憑證已變更；此歷史帳戶停止同步' }).where(eq(bitgetLedgerAccounts.id, row.id)).run();
        continue;
      }
      await syncLedger(env, row.userId, current.scope.environment);
    } catch { console.warn('[Bitget Ledger] 一個帳戶同步未完成'); }
  }
}
