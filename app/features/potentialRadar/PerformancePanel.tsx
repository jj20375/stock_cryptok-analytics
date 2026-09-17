/** @file 最近入選樣本的條件績效比較；所有分母與資料成熟度都直接呈現。 */
import { summarizePotentialPerformance, type ReturnSummary } from '../../services/potentialRadar/performance';
import type { RadarObservation } from '../../services/potentialRadar/types';

const pct = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const rate = (value: number | null) => value == null ? '—' : `${value.toFixed(1)}%`;

function ReturnCell({ summary }: { summary: ReturnSummary }) {
  return <span>{pct(summary.average)}<small className="block opacity-60">正報酬 {rate(summary.positiveRate)} · n={summary.count}</small></span>;
}

export function PerformancePanel({ observations }: { observations: RadarObservation[] }) {
  const groups = summarizePotentialPerformance(observations);
  const all = groups[0];
  if (!observations.length) return <section className="rounded-xl border border-black/15 bg-white/70 p-5 space-y-2">
    <h2 className="text-xl font-bold">條件績效</h2>
    <p className="text-sm opacity-70">尚無可統計的入選樣本；雷達建立研究紀錄後會自動顯示。</p>
  </section>;
  return <section className="rounded-xl border border-black/15 bg-white/70 p-5 space-y-4" aria-labelledby="potential-performance-title">
    <div><h2 id="potential-performance-title" className="text-xl font-bold">條件績效</h2>
      <p className="mt-1 text-xs opacity-65">最近 {observations.length} 筆入選紀錄；條件可重疊，各列不可相加。只計入已到期的報酬，n 為各指標實際分母。</p></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {[['入選樣本', all.sampleCount], ['24h 已成熟', all.h24.count], ['72h 已成熟', all.h72.count], ['7 天完整', all.completedCount]].map(([label, value]) =>
        <div key={label} className="rounded-lg border border-black/10 bg-white/60 p-3"><p className="text-xs opacity-65">{label}</p><strong className="mt-1 block text-xl">{value}</strong></div>)}
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm">
      <thead className="border-b border-black/20"><tr>{['條件', '樣本', '24h 平均／正報酬', '72h 平均／正報酬', '7 天平均／正報酬', '7 天 1R 達標', '7 天最差回撤'].map(label =>
        <th key={label} className="py-3 pr-4 font-medium">{label}</th>)}</tr></thead>
      <tbody>{groups.map(group => <tr key={group.key} className="border-b border-black/10 align-top">
        <td className="py-3 pr-4"><strong>{group.label}</strong><small className="mt-1 block max-w-56 opacity-60">{group.description}</small></td>
        <td className="py-3 pr-4">{group.sampleCount}</td>
        <td className="py-3 pr-4"><ReturnCell summary={group.h24} /></td>
        <td className="py-3 pr-4"><ReturnCell summary={group.h72} /></td>
        <td className="py-3 pr-4"><ReturnCell summary={group.d7} /></td>
        <td className="py-3 pr-4">{rate(group.oneRHitRate)}<small className="block opacity-60">n={group.oneREligibleCount}</small></td>
        <td className="py-3">{pct(group.worstDrawdown)}<small className="block opacity-60">完整 n={group.completedCount}</small></td>
      </tr>)}</tbody>
    </table></div>
    <p className="text-xs opacity-65">1R＝入選收盤到當時結構失效價的風險距離；達標表示七天內最大漲幅曾達同等距離。未扣手續費與滑價，樣本少時不代表已驗證勝率。</p>
  </section>;
}
