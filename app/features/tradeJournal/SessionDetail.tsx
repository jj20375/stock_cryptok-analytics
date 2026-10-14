/** @file 原始成交精度直接呈現，摘要快照與實際成交分列。 */
import type { Session } from '../../services/bitgetLedger/types';
import { money } from './JournalPerformance';
export function SessionDetail({ session }: { session: Session & { fillCount?: number; billCount?: number } }) {
  let snapshot: Record<string, unknown> | null = null;
  try { snapshot = session.snapshot ? JSON.parse(session.snapshot) : null; } catch { /* 舊資料不完整時顯示未保存。 */ }
  const details = [ ['平均進場', session.averageEntry], ['平均平倉', session.averageExit ?? '未平倉'],
    ['累計開倉量', session.quantity], ['剩餘持倉量', session.remainingQuantity],
    ['已實現損益 USDT', money(session.realizedPnl)], ['手續費現金流 USDT', money(session.feePnl)],
    ['資金費率現金流 USDT', money(session.fundingPnl)], ['淨損益 USDT', money(session.netPnl)],
  ];
  return <div className="space-y-4">
    {session.issues.length > 0 && <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">{session.issues.join('；')}</p>}
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{details.map(([label, value]) => <div key={label}><dt className="text-xs text-gray-500">{label}</dt><dd className="mt-1 font-mono text-sm">{value}</dd></div>)}</dl>
    <details className="rounded border p-3 text-xs"><summary className="cursor-pointer">進場時策略與風控快照</summary><pre className="mt-3 whitespace-pre-wrap break-words">{snapshot ? JSON.stringify(snapshot, null, 2) : '此交易未保存系統策略快照（例如手動下單或歷史匯入）'}</pre></details>
    <div className="max-h-72 overflow-auto"><h3 className="mb-2 text-sm font-medium">成交明細（{session.fillCount ?? session.fills.length} 筆；最多呈現 500 筆）</h3><table className="w-full whitespace-nowrap text-left text-xs"><thead><tr>{['時間（台北）', '方向', '成交量', '價格', '損益', '費用'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>
      {session.fills.map((fill, index) => <tr key={`${fill.exchangeId}:${index}`} className="border-t"><td className="p-2">{new Date(fill.executedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</td><td className="p-2">{fill.side === 'buy' ? '買' : '賣'} · {fill.effect === 'open' ? '開倉' : fill.effect === 'close' ? '平倉' : '單向成交'}</td><td className="p-2 font-mono">{fill.quantity}</td><td className="p-2 font-mono">{fill.price}</td><td className="p-2">{fill.realizedPnl ?? '尚未取得'}</td><td className="p-2">{fill.fees?.map(fee => `${fee.amount} ${fee.coin}`).join('、') ?? '尚未取得'}</td></tr>)}
    </tbody></table></div>
    {session.bills.length > 0 && <details className="rounded border p-3 text-xs"><summary className="cursor-pointer">資金費率（{session.billCount ?? session.bills.length} 筆；最多呈現 100 筆）</summary>{session.bills.map(bill => <p key={bill.exchangeId} className="mt-2">{new Date(bill.occurredAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} · {bill.amount} {bill.coin}</p>)}</details>}
  </div>;
}
