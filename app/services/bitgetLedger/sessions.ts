/** @file 由成交而非委託回執重建倉位；多空分帳、部分平倉與單向反手使用定點數。 */
import { add, decimal, divide, multiply, subtract, sum, units } from './decimal';
import { isFundingBill } from './normalize';
import type { Attribution, Bill, Fill, Order, Session } from './types';
type WorkingSession = Session & { entryValue: string; exitValue: string; closedQuantity: string };
function createSession(fill: Fill, side: Session['side'], attribution?: Attribution): WorkingSession {
  return {
    id: `${fill.exchangeId}:${side}`, symbol: fill.symbol, side, openTime: fill.executedAt, closeTime: null,
    quantity: '0', remainingQuantity: '0', averageEntry: '0', averageExit: null,
    realizedPnl: '0', feePnl: '0', fundingPnl: '0', netPnl: null,
    status: 'OPEN', issues: [], fills: [], bills: [], strategy: attribution?.label ?? '交易所其他交易',
    source: attribution?.source ?? 'EXCHANGE', snapshot: attribution?.snapshot ?? null,
    referencePrice: attribution?.referencePrice ?? null,
    entryValue: '0', exitValue: '0', closedQuantity: '0',
  };
}
function attachFill(session: WorkingSession, fill: Fill, opening: boolean) {
  session.fills.push(fill);
  if (opening) {
    session.quantity = add(session.quantity, fill.quantity);
    session.remainingQuantity = add(session.remainingQuantity, fill.quantity);
    session.entryValue = add(session.entryValue, multiply(fill.price, fill.quantity));
    session.averageEntry = divide(session.entryValue, session.quantity);
  } else {
    session.remainingQuantity = subtract(session.remainingQuantity, fill.quantity);
    session.closedQuantity = add(session.closedQuantity, fill.quantity);
    session.exitValue = add(session.exitValue, multiply(fill.price, fill.quantity));
    session.averageExit = divide(session.exitValue, session.closedQuantity);
    if (fill.realizedPnl === null) {
      session.realizedPnl = null;
      session.issues.push('缺少已實現損益');
    } else if (session.realizedPnl !== null) session.realizedPnl = add(session.realizedPnl, fill.realizedPnl);
    if (units(session.remainingQuantity) <= 0n) {
      session.status = 'CLOSED'; session.closeTime = fill.executedAt;
      if (units(session.remainingQuantity) < 0n) session.issues.push('平倉數量超過已知持倉');
      session.remainingQuantity = '0';
    }
  }
  if (fill.fees === null || fill.fees.some(fee => fee.coin !== 'USDT')) {
    session.feePnl = null;
    session.issues.push(fill.fees === null ? '缺少成交手續費' : '含非 USDT 手續費，尚未換匯');
  } else if (session.feePnl !== null) session.feePnl = add(session.feePnl, sum(fill.fees.map(fee => fee.amount)));
}
export function buildSessions(fills: Fill[], bills: Bill[], orders: Order[], attributions: Attribution[], coverage: { from: number | null; to: number | null; through: number }) {
  const active = new Map<string, WorkingSession>(), sessions: WorkingSession[] = [];
  const orderMap = new Map(orders.map(order => [order.exchangeId, order]));
  const attributionMap = new Map(attributions.map(row => [row.orderId, row]));
  const ordered = [...fills].sort((a, b) => a.executedAt - b.executedAt || a.exchangeId.localeCompare(b.exchangeId));
  for (const original of ordered) {
    const order = orderMap.get(original.orderId);
    const fill = { ...original, positionSide: original.positionSide === 'net' ? order?.positionSide ?? 'net' : original.positionSide };
    const net = fill.positionSide === 'net';
    const key = `${fill.symbol}:${net ? 'net' : fill.positionSide}`;
    let session = active.get(key);
    const direction = fill.side === 'buy' ? 'long' : 'short';
    const opening = fill.effect === 'open' || (fill.effect === 'unknown' && (!session || session.side === direction));
    if (opening) {
      if (!session) {
        session = createSession(fill, net ? direction : fill.positionSide as Session['side'], attributionMap.get(fill.orderId));
        if (fill.effect === 'unknown') session.issues.push('首筆開倉方向未由交易所明確確認');
        sessions.push(session); active.set(key, session);
      }
      if (session.side !== direction) session.issues.push('成交方向與持倉衝突');
      attachFill(session, fill, true);
      continue;
    }
    if (!session) {
      session = createSession(fill, net ? direction === 'long' ? 'short' : 'long' : fill.positionSide as Session['side']);
      session.issues.push('缺少開倉歷史'); sessions.push(session);
      attachFill(session, fill, false);
      continue;
    }
    /** 單向超額反手拆成平倉及新倉；費用按數量拆分後以差額補齊，避免精度殘差。 */
    if (net && units(fill.quantity) > units(session.remainingQuantity) && fill.effect === 'unknown') {
      const closeQuantity = session.remainingQuantity, remainder = subtract(fill.quantity, closeQuantity);
      const closeFees = fill.fees?.map(fee => ({ ...fee, amount: multiply(fee.amount, divide(closeQuantity, fill.quantity)) })) ?? null;
      const openFees = fill.fees?.map((fee, index) => ({ ...fee, amount: subtract(fee.amount, closeFees![index].amount) })) ?? null;
      attachFill(session, { ...fill, quantity: closeQuantity, fees: closeFees }, false);
      const next = createSession(fill, direction, attributionMap.get(fill.orderId));
      attachFill(next, { ...fill, quantity: remainder, realizedPnl: '0', fees: openFees }, true);
      sessions.push(next); active.set(key, next);
    } else {
      attachFill(session, fill, false);
      if (session.status === 'CLOSED') active.delete(key);
    }
  }
  const unallocatedFunding: Bill[] = [];
  for (const bill of bills.filter(isFundingBill)) {
    const activeAtTime = sessions.filter(session => session.openTime <= bill.occurredAt &&
      (session.closeTime === null || session.closeTime >= bill.occurredAt));
    const candidates = activeAtTime.filter(session => session.symbol === bill.symbol);
    /** 雙向持倉且帳單未標側時不可任意分攤；保留帳戶總成本，標示各倉位未知。 */
    if (candidates.length !== 1 || bill.coin !== 'USDT') {
      unallocatedFunding.push(bill);
      for (const session of bill.symbol === null ? activeAtTime : candidates) session.issues.push('資金費率無法唯一歸屬此倉位');
      continue;
    }
    candidates[0].bills.push(bill);
    candidates[0].fundingPnl = add(candidates[0].fundingPnl, bill.amount);
  }
  return { sessions: sessions.map(({ entryValue: _entry, exitValue: _exit, closedQuantity: _closed, ...session }): Session => {
    const latestEvent = Math.max(session.fills.at(-1)!.executedAt, ...session.bills.map(bill => bill.occurredAt));
    if (coverage.from === null || coverage.to === null || session.openTime < coverage.from ||
      (session.closeTime ?? latestEvent) > coverage.to || session.status === 'OPEN' && coverage.to < coverage.through - 300_000) {
      session.issues.push('該倉位區間尚未完成三類資料對帳');
    }
    session.issues = [...new Set(session.issues)];
    session.netPnl = session.issues.length || session.realizedPnl === null || session.feePnl === null ? null
      : decimal(units(session.realizedPnl) + units(session.feePnl) + units(session.fundingPnl));
    return session;
  }), unallocatedFunding };
}
