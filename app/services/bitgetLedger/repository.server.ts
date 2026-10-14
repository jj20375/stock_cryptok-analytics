/** @file 所有查詢先驗證帳戶所屬使用者，僅傳回帳本資料，不輸出憑證或租約。 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { bitgetLedgerAccounts, bitgetLedgerFills, bitgetLedgerOrders, bitgetLedgerBills, bitgetJournalReports, cryptoAutoOrders } from '../../db/schema';
import { digestText, type LedgerEnv } from './credentials.server';
import { buildSessions } from './sessions';
import { computeMetrics } from './metrics';
import type { Attribution, Bill, Fill, Order, Snapshot } from './types';
import { futuresAuditIsEntry } from '../cryptoAutoTrading/types';
/** 限制單次 Workers 記憶體；超出上限時不提供完整績效，避免截尾造成假獲利。 */
const ROW_LIMIT = 20_000;
export async function readLedger(env: LedgerEnv, userId: number, accountId: string) {
  const db = drizzle(env.DB);
  const account = await db.select().from(bitgetLedgerAccounts).where(and(eq(bitgetLedgerAccounts.id, accountId), eq(bitgetLedgerAccounts.userId, userId))).get();
  if (!account) throw new Response('找不到此帳戶', { status: 404 });
  const [fillRows, billRows, orderRows, audits] = await Promise.all([
    db.select().from(bitgetLedgerFills).where(eq(bitgetLedgerFills.accountId, accountId)).orderBy(asc(bitgetLedgerFills.executedAt)).limit(ROW_LIMIT + 1).all(),
    db.select().from(bitgetLedgerBills).where(eq(bitgetLedgerBills.accountId, accountId)).orderBy(asc(bitgetLedgerBills.occurredAt)).limit(ROW_LIMIT + 1).all(),
    db.select().from(bitgetLedgerOrders).where(eq(bitgetLedgerOrders.accountId, accountId)).orderBy(asc(bitgetLedgerOrders.updatedAt)).limit(ROW_LIMIT + 1).all(),
    db.select().from(cryptoAutoOrders).where(and(eq(cryptoAutoOrders.userId, userId), eq(cryptoAutoOrders.ledgerAccountId, accountId))).orderBy(asc(cryptoAutoOrders.createdAt)).limit(ROW_LIMIT + 1).all(),
  ]);
  const truncated = [fillRows, billRows, orderRows, audits].some(rows => rows.length > ROW_LIMIT);
  const ordersByClient = new Map<string, typeof orderRows>();
  for (const row of orderRows) {
    if (!row.clientOid) continue;
    const key = `${row.clientOid}:${row.symbol}`, rows = ordersByClient.get(key) ?? [];
    rows.push(row); ordersByClient.set(key, rows);
  }
  /** 網路逾時可能尚未保存 orderId；僅用本系統既有唯一 clientOid 找回相同帳戶委託。 */
  for (const audit of audits) {
    if (audit.bitgetOrderId || !audit.bitgetClientOid) continue;
    const matches = ordersByClient.get(`${audit.bitgetClientOid}:${audit.symbol}`) ?? [];
    if (matches.length === 1) audit.bitgetOrderId = matches[0].exchangeId;
  }
  const fills: Fill[] = fillRows.slice(0, ROW_LIMIT).map(row => ({ ...row,
    side: row.side as Fill['side'], positionSide: row.positionSide as Fill['positionSide'], effect: row.effect as Fill['effect'], fees: JSON.parse(row.feesJson),
  }));
  /** 舊 BUY／SELL 與新四種合約意圖共同補齊成交方向；只接受相同帳戶指紋稽核。 */
  const auditMap = new Map(audits.filter(row => row.bitgetOrderId).map(row => [row.bitgetOrderId!, row]));
  for (const fill of fills) {
    const audit = auditMap.get(fill.orderId);
    if (audit && fill.effect === 'unknown') fill.effect = futuresAuditIsEntry(audit.action) ? 'open' : 'close';
    if (audit?.action === 'OPEN_SHORT' || audit?.action === 'CLOSE_SHORT') fill.positionSide = 'short';
  }
  const bills = billRows.slice(0, ROW_LIMIT) as Bill[];
  const orders = orderRows.slice(0, ROW_LIMIT) as Order[];
  const attributions: Attribution[] = audits.filter(row => row.bitgetOrderId && futuresAuditIsEntry(row.action)).map(row => {
    let label = row.source;
    try { label = String(JSON.parse(row.strategySnapshotJson ?? '{}').label ?? row.source).slice(0, 100); } catch { /* 舊紀錄缺快照時保留來源。 */ }
    return { orderId: row.bitgetOrderId!, source: row.source, label, referencePrice: row.referencePrice,
      snapshot: row.strategySnapshotJson, paperTradeId: row.paperTradeId };
  });
  const { sessions, unallocatedFunding } = buildSessions(fills, bills, orders, attributions, {
    from: account.coveredFrom, to: truncated ? null : account.coveredTo, through: Date.now(),
  });
  const snapshot: Snapshot | null = account.snapshotJson ? JSON.parse(account.snapshotJson) : null;
  /** 以 fresh 快照檢查最後未平倉重建；尚在匯入的帳戶一定保留差異提示。 */
  const mismatches = snapshot?.positions.filter(position => !sessions.some(session => session.status === 'OPEN' &&
    session.symbol === position.symbol && session.side === position.side && session.remainingQuantity === position.quantity)) ?? [];
  const missingPositions = snapshot ? sessions.filter(session => session.status === 'OPEN' && !snapshot.positions.some(position =>
    position.symbol === session.symbol && position.side === session.side && position.quantity === session.remainingQuantity)) : [];
  const version = await digestText(JSON.stringify({ coverage: [account.coveredFrom, account.coveredTo], error: Boolean(account.error),
    mismatches: mismatches.length + missingPositions.length, fills, bills, orders, attributions, truncated }));
  return { account, fills, bills, orders, audits, sessions, attributions, snapshot, mismatches, missingPositions, unallocatedFunding, truncated, version };
}
export async function journalPageData(env: LedgerEnv, userId: number, accountId: string | null, days: number) {
  const db = drizzle(env.DB);
  const accounts = await db.select({ id: bitgetLedgerAccounts.id, environment: bitgetLedgerAccounts.environment,
    coveredFrom: bitgetLedgerAccounts.coveredFrom, coveredTo: bitgetLedgerAccounts.coveredTo,
    lastSyncedAt: bitgetLedgerAccounts.lastSyncedAt, error: bitgetLedgerAccounts.error, dialect: bitgetLedgerAccounts.dialect,
    importing: bitgetLedgerAccounts.cursorJson,
  }).from(bitgetLedgerAccounts).where(eq(bitgetLedgerAccounts.userId, userId)).orderBy(desc(bitgetLedgerAccounts.createdAt)).all();
  const selected = accountId ?? accounts[0]?.id;
  if (!selected) return { accounts: accounts.map(row => ({ ...row, importing: Boolean(row.importing) })), selected: null, journal: null };
  const data = await readLedger(env, userId, selected);
  const to = Date.now(), from = to - days * 86_400_000;
  /** 輪詢最新一輪允許五分鐘延遲；更舊的末端必須明示未完整。 */
  const complete = !data.truncated && !data.account.cursorJson && !data.account.error &&
    data.account.coveredFrom !== null && data.account.coveredFrom <= from && data.account.coveredTo !== null && data.account.coveredTo >= to - 300_000;
  const metrics = computeMetrics(data.fills, data.bills, data.sessions, from, to, complete);
  const reports = await db.select({ id: bitgetJournalReports.id, content: bitgetJournalReports.content, createdAt: bitgetJournalReports.createdAt, dataVersion: bitgetJournalReports.dataVersion,
    periodFrom: bitgetJournalReports.periodFrom, periodTo: bitgetJournalReports.periodTo,
  }).from(bitgetJournalReports).where(eq(bitgetJournalReports.accountId, selected)).orderBy(desc(bitgetJournalReports.createdAt)).limit(1).all();
  return { accounts: accounts.map(row => ({ ...row, importing: Boolean(row.importing) })), selected, journal: {
    metrics, truncated: data.truncated, mismatchCount: data.mismatches.length + data.missingPositions.length,
    unallocatedFundingCount: data.unallocatedFunding.length,
    snapshot: data.snapshot, report: reports[0] ?? null, version: data.version,
    sessions: data.sessions.filter(session => (session.closeTime ?? to) >= from).sort((a, b) => b.openTime - a.openTime)
      .slice(0, 200).map(session => ({ ...session, fills: session.fills.slice(0, 500), bills: session.bills.slice(0, 100),
        fillCount: session.fills.length, billCount: session.bills.length })),
    orders: data.orders.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100),
  } };
}
