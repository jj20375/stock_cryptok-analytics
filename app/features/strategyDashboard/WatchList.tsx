/** @file 「已分析但未達候選條件」清單：逐檔列出卡住的條件，明確標示不是推薦；可開 K 線檢查。 */
import { BarChart3 } from 'lucide-react';
import type { DashboardWatchItem } from '../../services/strategyDashboard/types';
import { formatPct, formatPrice, formatTaipei } from './format';

export function WatchList({ items, open, onOpenChart }: {
  items: DashboardWatchItem[];
  /** 沒有候選時預設展開，讓使用者直接看到本輪分析了哪些標的。 */
  open: boolean;
  onOpenChart: (item: DashboardWatchItem) => void;
}) {
  if (!items.length) return null;
  return <details open={open} className="rounded-xl border border-black/15 bg-white/60 p-3 text-sm">
    <summary className="cursor-pointer font-semibold">已分析但尚未達候選條件（{items.length} 檔，非推薦）</summary>
    <p className="mt-2 text-xs opacity-70">以下標的已完成同一套雷達分析，但至少有一項條件未通過；依品質分數排序，只供追蹤觀察，不提供進場區間。</p>
    <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs">
      <thead className="border-b border-black/20"><tr>{['標的', '收盤價', '漲跌', '品質', '目前狀態', '未通過條件', '訊號收盤', ''].map(label =>
        <th key={label} className="py-2 pr-3 font-medium">{label}</th>)}</tr></thead>
      <tbody>{items.map(item => <tr key={item.symbol} className="border-b border-black/10 align-top">
        <td className="py-2 pr-3"><strong>{item.symbol}</strong><p className="max-w-40 truncate opacity-65">{item.name}</p></td>
        <td className="py-2 pr-3 font-mono">{formatPrice(item.market, item.price)}</td>
        <td className={`py-2 pr-3 font-mono ${item.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{item.changeLabel} {formatPct(item.changePct)}</td>
        <td className="py-2 pr-3">{item.score}</td>
        <td className="py-2 pr-3">{item.statusLabel}</td>
        <td className="py-2 pr-3 text-amber-300">{item.blockers.join('；')}</td>
        <td className="py-2 pr-3 opacity-70">{formatTaipei(item.signalClosedAt)}</td>
        <td className="py-2"><button type="button" onClick={() => onOpenChart(item)} aria-label={`查看 ${item.symbol} K 線`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-black/20 px-2 py-1 hover:bg-black/5"><BarChart3 size={12} />K 線</button></td>
      </tr>)}</tbody>
    </table></div>
  </details>;
}
