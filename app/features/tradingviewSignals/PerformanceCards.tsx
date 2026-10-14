import { tradingviewMarketLabel } from '../../services/tradingview/market';
/** @file TradingView 紙上績效的摘要卡片與個別標的排行；所有分母與缺值都直接呈現，不美化。 */
import type { PerformanceSummary, SymbolPerformance } from '../../services/tradingview/performance';

export const formatTime = (value: number) => new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(value);
export const pct = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
export const rate = (value: number | null) => value == null ? '—' : `${value.toFixed(1)}%`;
export const priceText = (value: number | null, market: string) =>
  value == null ? '—' : `${market === 'tw_stock' ? 'NT$' : '$'}${value.toLocaleString('en-US', { maximumSignificantDigits: 7 })}`;

const tone = (value: number | null) => value == null ? '' : value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-700' : '';

export function PerformanceCards({ summary }: { summary: PerformanceSummary }) {
  return <section className="space-y-3" aria-label="紙上績效摘要">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="rounded-xl border border-black/10 bg-white/60 p-4">
        <p className="text-xs opacity-65">累積報酬（複利）</p>
        <strong className={`mt-2 block text-2xl ${tone(summary.compoundReturn)}`}>{pct(summary.compoundReturn)}</strong>
        <small className="opacity-60">每次全額投入單一部位</small>
      </div>
      <div className="rounded-xl border border-black/10 bg-white/60 p-4">
        <p className="text-xs opacity-65">每筆平均報酬</p>
        <strong className={`mt-2 block text-2xl ${tone(summary.averageReturn)}`}>{pct(summary.averageReturn)}</strong>
        <small className="opacity-60">合計 {pct(summary.sumReturn)}（等權重）</small>
      </div>
      <div className="rounded-xl border border-black/10 bg-white/60 p-4">
        <p className="text-xs opacity-65">勝率</p>
        <strong className="mt-2 block text-2xl">{rate(summary.winRate)}</strong>
        <small className="opacity-60">{summary.winCount}／{summary.closedTrades} 筆已平倉</small>
      </div>
      <div className="rounded-xl border border-black/10 bg-white/60 p-4">
        <p className="text-xs opacity-65">交易筆數</p>
        <strong className="mt-2 block text-2xl">{summary.totalTrades}</strong>
        <small className="opacity-60">未平倉 {summary.openTrades} 筆</small>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
      <p className="rounded-lg bg-black/5 px-3 py-2">最佳單筆 <strong className={tone(summary.bestReturn)}>{pct(summary.bestReturn)}</strong></p>
      <p className="rounded-lg bg-black/5 px-3 py-2">最差單筆 <strong className={tone(summary.worstReturn)}>{pct(summary.worstReturn)}</strong></p>
      <p className="rounded-lg bg-black/5 px-3 py-2">最後平倉 <strong>{summary.lastExitAt ? formatTime(summary.lastExitAt) : '—'}</strong></p>
    </div>
  </section>;
}

export function SymbolTable({ rows }: { rows: SymbolPerformance[] }) {
  if (!rows.length) return null;
  return <section className="rounded-xl border border-black/15 bg-white/70 p-5 space-y-3" aria-labelledby="tv-symbol-title">
    <div><h2 id="tv-symbol-title" className="text-xl font-bold">各標的表現</h2>
      <p className="mt-1 text-xs opacity-65">依累積報酬排序；未平倉部位不計入報酬欄位，只反映在筆數。</p></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
      <thead className="border-b border-black/20"><tr>{['標的', '市場', '累積報酬', '平均報酬', '勝率', '筆數'].map(label =>
        <th key={label} className="py-3 pr-4 font-medium">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.market}:${row.symbol}`} className="border-b border-black/10">
        <td className="py-3 pr-4 font-semibold">{row.symbol}</td>
        <td className="py-3 pr-4">{tradingviewMarketLabel(row.market)}</td>
        <td className={`py-3 pr-4 ${tone(row.compoundReturn)}`}>{pct(row.compoundReturn)}</td>
        <td className={`py-3 pr-4 ${tone(row.averageReturn)}`}>{pct(row.averageReturn)}</td>
        <td className="py-3 pr-4">{rate(row.winRate)}<small className="block opacity-60">n={row.closedTrades}</small></td>
        <td className="py-3">{row.totalTrades}<small className="block opacity-60">未平倉 {row.openTrades}</small></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
