/** @file 僅對同指紋、同 entry order 的本系統持倉更新；不下單、不接管其他來源部位。 */
import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { drizzle } from 'drizzle-orm/d1';
import { cryptoAutoOrders, paperTrades } from '../../db/schema';
import { readLedger } from './repository.server';
import { sum, units } from './decimal';
import type { Fill } from './types';
import type { LedgerEnv } from './credentials.server';
import { futuresAuditIsEntry, futuresAuditIsClose } from '../cryptoAutoTrading/types';
export async function reconcileLocalTrades(env: LedgerEnv, userId: number, accountId: string) {
  const data = await readLedger(env, userId, accountId), db = drizzle(env.DB);
  if (data.truncated || !data.snapshot || Date.now() - data.snapshot.observedAt > 120_000) return;
  const localTrades = await db.select().from(paperTrades).where(and(eq(paperTrades.userId, userId), eq(paperTrades.ledgerAccountId, accountId), eq(paperTrades.status, 'OPEN'))).all();
  const localMap = new Map(localTrades.map(trade => [trade.id, trade]));
  const orderMap = new Map(data.orders.map(order => [order.exchangeId, order]));
  const fillMap = new Map<string, Fill[]>();
  for (const fill of data.fills) { const rows = fillMap.get(fill.orderId) ?? []; rows.push(fill); fillMap.set(fill.orderId, rows); }
  /** 每帳戶一輪最多二十筆，以最近最久未檢查排序；歷史已結案交易不反覆寫入。 */
  const candidates = data.audits.filter(audit => audit.paperTradeId && localMap.has(audit.paperTradeId) ||
    audit.bitgetOrderId && !['FILLED', 'CANCELED', 'PARTIAL_CANCELED', 'IGNORED', 'REJECTED'].includes(audit.status))
    .sort((a, b) => a.updatedAt - b.updatedAt).slice(0, 20);
  const writes: BatchItem<'sqlite'>[] = [];
  for (const audit of candidates) {
    const order = orderMap.get(audit.bitgetOrderId ?? ''), fills = fillMap.get(audit.bitgetOrderId ?? '') ?? [];
    /** 缺頁只標部分，不偽造平均成交價；部分成交撤單不能以尚未抓到 fills 當作零成交。 */
    const filled = sum(fills.map(fill => fill.quantity)), target = order?.quantity ?? audit.requestedQuantity;
    const status = order && ['canceled', 'cancelled', 'rejected'].includes(order.status) ? (units(filled) > 0n || units(order.filledQuantity) > 0n ? 'PARTIAL_CANCELED' : 'CANCELED')
      : target && units(filled) >= units(target) && units(filled) > 0n ? 'FILLED' : units(filled) > 0n ? 'PARTIALLY_FILLED' : null;
    if (!['REJECTED', 'IGNORED'].includes(audit.status)) writes.push(db.update(cryptoAutoOrders)
      .set({ status: status ?? audit.status, bitgetOrderId: audit.bitgetOrderId, updatedAt: Date.now() })
      .where(and(eq(cryptoAutoOrders.id, audit.id), eq(cryptoAutoOrders.userId, userId), eq(cryptoAutoOrders.status, audit.status))));
    const current = audit.paperTradeId ? localMap.get(audit.paperTradeId) : null;
    if (!futuresAuditIsEntry(audit.action) || !current) continue;
    const side = audit.action === 'OPEN_SHORT' ? 'short' : 'long';
    const linked = data.sessions.filter(session => session.side === side && session.fills.some(fill => fill.orderId === audit.bitgetOrderId));
    if (linked.length !== 1) {
      if (status === 'CANCELED' && !fills.length) writes.push(db.update(paperTrades).set({ status: 'CANCELED', reconciliationStatus: 'CANCELED' })
        .where(and(eq(paperTrades.id, current.id), eq(paperTrades.userId, userId), eq(paperTrades.ledgerAccountId, accountId),
          eq(paperTrades.status, 'OPEN'), eq(paperTrades.reconciliationStatus, current.reconciliationStatus))));
      continue;
    }
    const session = linked[0];
    /** 尚可能繼續成交的 entry 委託不可釋放風控槽，避免平倉後殘餘委託又開倉。 */
    if (session.status === 'CLOSED' && status !== 'FILLED' && status !== 'PARTIAL_CANCELED') continue;
    const sessionOrders = new Set(session.fills.map(fill => fill.orderId));
    const owners = data.audits.filter(row => futuresAuditIsEntry(row.action) && row.bitgetOrderId && sessionOrders.has(row.bitgetOrderId));
    const ownedOrders = new Set(owners.map(row => row.bitgetOrderId));
    const foreignEntries = session.fills.some(fill => fill.effect === 'open' && !ownedOrders.has(fill.orderId));
    /** 手動加倉或多個本地 reservation 混在同一倉位時，不把整倉分配給其中一筆。 */
    if (session.issues.length || owners.some(owner => owner.paperTradeId !== audit.paperTradeId) || foreignEntries) continue;
    const position = data.snapshot.positions.find(row => row.symbol === session.symbol && row.side === side);
    if (session.status === 'CLOSED' && position || session.status === 'OPEN' && (!position || units(position.quantity) !== units(session.remainingQuantity))) continue;
    const latestClose = data.audits.filter(row => futuresAuditIsClose(row.action) && row.paperTradeId === audit.paperTradeId).at(-1);
    const closeOrder = orderMap.get(latestClose?.bitgetOrderId ?? '');
    const confirmedCanceledClose = closeOrder && ['canceled', 'cancelled', 'rejected'].includes(closeOrder.status);
    const pendingClose = current.reconciliationStatus === 'CLOSE_PENDING' && !confirmedCanceledClose;
    const pendingEntry = !status || status === 'PARTIALLY_FILLED';
    /** 成交、費用、帳單齊備且快照一致才宣告平倉；未成交量繼續保留風控額度。 */
    writes.push(db.update(paperTrades).set({ entryPrice: position?.averagePrice ?? session.averageEntry,
      amount: session.status === 'CLOSED' ? session.quantity : pendingEntry && audit.requestedQuantity ? audit.requestedQuantity : session.remainingQuantity,
      status: session.status, reconciliationStatus: session.status === 'CLOSED' ? 'RECONCILED' : pendingClose ? 'CLOSE_PENDING' : pendingEntry ? 'PARTIAL' : 'RECONCILED',
      exitPrice: session.status === 'CLOSED' ? session.averageExit : null, pnl: session.netPnl,
      closedAt: session.closeTime ? new Date(session.closeTime).toISOString() : null,
    }).where(and(eq(paperTrades.id, current.id), eq(paperTrades.userId, userId), eq(paperTrades.ledgerAccountId, accountId),
      eq(paperTrades.reconciliationStatus, current.reconciliationStatus), eq(paperTrades.status, 'OPEN'))));
  }
  /** 合併本地稽核與部位更新，避免逐筆往返耗盡排程子請求額度。 */
  const [first, ...rest] = writes;
  if (first) await db.batch([first, ...rest]);
}
