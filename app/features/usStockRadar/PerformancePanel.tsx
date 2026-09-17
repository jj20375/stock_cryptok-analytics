/** @file 美股雷達條件績效面板；顯示分母，避免用未成熟樣本推定勝率。 */
import { summarizeUsStockPerformance, type UsStockReturnSummary } from '../../services/usStockRadar/performance';
import type { UsStockObservation } from '../../services/usStockRadar/types';

const pct = (value: number | null) => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
function ReturnCell({ value }: { value: UsStockReturnSummary }) {
  return <span>{pct(value.average)}<small className="block opacity-60">正報酬 {value.positiveRate == null ? '—' : `${value.positiveRate.toFixed(1)}%`} · n={value.count}</small></span>;
}

export function UsStockPerformancePanel({ observations, benchmarkLabel = 'SPY' }: {
  observations: UsStockObservation[];
  benchmarkLabel?: string;
}) {
  const groups = summarizeUsStockPerformance(observations, benchmarkLabel);
  return <section className="rounded-xl border border-black/15 bg-white/70 p-5 space-y-4">
    <div><h2 className="text-xl font-bold">條件績效</h2><p className="mt-1 text-xs opacity-65">只計入已到期報酬；條件可重疊，各列不能相加。樣本少時不代表策略已驗證。</p></div>
    {!observations.length ? <p className="text-sm opacity-65">尚無可統計的入選樣本。</p> :
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-black/20"><tr>{['條件', '樣本', '4 小時平均／正報酬', '1 日平均／正報酬', '5 日平均／正報酬', '完整樣本／最差回撤'].map(label =>
          <th key={label} className="py-3 pr-4 font-medium">{label}</th>)}</tr></thead>
        <tbody>{groups.map(group => <tr key={group.key} className="border-b border-black/10">
          <td className="py-3 pr-4 font-semibold">{group.label}</td><td className="py-3 pr-4">{group.sampleCount}</td>
          <td className="py-3 pr-4"><ReturnCell value={group.h4} /></td><td className="py-3 pr-4"><ReturnCell value={group.d1} /></td>
          <td className="py-3 pr-4"><ReturnCell value={group.d5} /></td>
          <td className="py-3">{group.completeCount}／{pct(group.worstDrawdown)}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
