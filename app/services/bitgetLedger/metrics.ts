/** @file 現金損益按事件時間統計；不把轉帳當獲利，也不把缺漏資料假裝成零。 */
import { add, decimal, sum, units } from './decimal';
import { isFundingBill } from './normalize';
import type { Bill, Fill, Session } from './types';
export function computeMetrics(fills: Fill[], bills: Bill[], sessions: Session[], from: number, to: number, complete: boolean) {
  const selected = fills.filter(fill => fill.executedAt >= from && fill.executedAt <= to);
  const funding = bills.filter(bill => isFundingBill(bill) && bill.occurredAt >= from && bill.occurredAt <= to);
  const otherCoins = [...new Set([...selected.flatMap(fill => fill.fees?.map(fee => fee.coin) ?? []), ...funding.map(bill => bill.coin)])].filter(coin => coin !== 'USDT');
  const missingPnl = selected.filter(fill => fill.realizedPnl === null && fill.effect !== 'open').length;
  const missingFees = selected.filter(fill => fill.fees === null).length;
  const realized = sum(selected.map(fill => fill.realizedPnl ?? '0'));
  const fees = sum(selected.flatMap(fill => fill.fees?.filter(fee => fee.coin === 'USDT').map(fee => fee.amount) ?? []));
  const fundingPnl = sum(funding.filter(bill => bill.coin === 'USDT').map(bill => bill.amount));
  const reliable = complete && !missingPnl && !missingFees && !otherCoins.length;
  const events = [...selected.map(fill => ({ time: fill.executedAt, amount: add(fill.realizedPnl ?? '0', sum(fill.fees?.filter(fee => fee.coin === 'USDT').map(fee => fee.amount) ?? [])) })),
    ...funding.filter(bill => bill.coin === 'USDT').map(bill => ({ time: bill.occurredAt, amount: bill.amount }))].sort((a, b) => a.time - b.time);
  const daily = new Map<string, string>();
  for (const event of events) {
    const date = new Date(event.time).toISOString().slice(0, 10);
    daily.set(date, add(daily.get(date) ?? '0', event.amount));
  }
  /** 回撤以觀測到的累計現金損益、USDT 絕對額計算；沒有起始本金就不製造報酬率。 */
  let cumulative = 0n, peak = 0n, maximumDrawdown = 0n;
  const curve = [...daily].map(([date, amount]) => {
    cumulative += units(amount); if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative; if (drawdown > maximumDrawdown) maximumDrawdown = drawdown;
    return { date, pnl: Number(amount), cumulative: Number(decimal(cumulative)), drawdown: Number(decimal(drawdown)) };
  });
  const monthly = new Map<string, string>();
  for (const [date, amount] of daily) monthly.set(date.slice(0, 7), add(monthly.get(date.slice(0, 7)) ?? '0', amount));
  const closed = sessions.filter(session => session.status === 'CLOSED' && session.netPnl !== null && session.closeTime! >= from && session.closeTime! <= to);
  const wins = closed.filter(session => units(session.netPnl!) > 0n);
  const gains = sum(wins.map(session => session.netPnl!));
  const losses = sum(closed.filter(session => units(session.netPnl!) < 0n).map(session => session.netPnl!));
  return { from, to, reliable, fillCount: selected.length, missingPnl, missingFees, otherCoins,
    realized, fees, funding: fundingPnl, net: reliable ? sum([realized, fees, fundingPnl]) : null,
    observedNet: sum([realized, fees, fundingPnl]), closedCount: closed.length,
    excludedCount: sessions.filter(session => session.status === 'CLOSED' && session.netPnl === null && session.closeTime! >= from && session.closeTime! <= to).length,
    winRate: closed.length ? wins.length / closed.length * 100 : null,
    profitFactor: units(losses) < 0n ? Number(gains) / -Number(losses) : null,
    expectancy: closed.length ? Number(sum(closed.map(session => session.netPnl!))) / closed.length : null,
    maximumDrawdown: reliable ? decimal(maximumDrawdown) : null,
    curve, monthly: [...monthly].map(([month, pnl]) => ({ month, pnl: Number(pnl) })),
  };
}
