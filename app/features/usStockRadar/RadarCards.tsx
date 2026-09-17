/** @file 美股雷達卡片與入選追蹤表；只呈現後端保存的已收盤結果。 */
import { BarChart3 } from 'lucide-react';
import { bigFishLabel } from '../../services/potentialRadar/bigFish';
import { US_STOCK_PHASE_LABELS, type UsStockObservation, type UsStockSnapshot } from '../../services/usStockRadar/types';

export const formatTaipeiTime = (time: number) => new Date(time).toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: value >= 100 ? 2 : 4 });
const pct = (value: number | null) => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export function UsStockRadarCard({ snapshot, onOpenChart, marketLabel = 'NASDAQ / NYSE',
  currencyPrefix = '$', benchmarkLabel = 'SPY' }: {
  snapshot: UsStockSnapshot;
  onOpenChart: (snapshot: UsStockSnapshot) => void;
  marketLabel?: string;
  currencyPrefix?: string;
  benchmarkLabel?: string;
}) {
  const signal = snapshot.signal!;
  return <article className="h-full rounded-xl border border-black/15 bg-white/70 p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs tracking-widest opacity-55">{marketLabel}</p>
        <h2 className="mt-1 text-2xl font-bold">{snapshot.symbol}</h2><p className="max-w-56 truncate text-xs opacity-65">{snapshot.name}</p></div>
      <div className="text-right"><strong className="text-2xl">{signal.score}</strong><p className="text-xs opacity-55">品質分數</p></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2 text-xs">
      <span className="rounded-full bg-slate-900 px-3 py-1 text-white">{US_STOCK_PHASE_LABELS[signal.phase]}</span>
      {signal.bigFish.entry && <span className="rounded-full bg-emerald-600 px-3 py-1 text-white">經典吃大魚</span>}
      {signal.dailyTrendUp && <span className="rounded-full border border-emerald-500 px-3 py-1 text-emerald-800">日線順勢</span>}
      {signal.marketTrendUp && <span className="rounded-full border border-blue-500 px-3 py-1 text-blue-800">{benchmarkLabel} 順勢</span>}
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
      <div><dt className="text-xs opacity-55">收盤價</dt><dd className="font-semibold">{currencyPrefix}{number(signal.price)}</dd></div>
      <div><dt className="text-xs opacity-55">當日漲跌</dt><dd className={signal.changeDay >= 0 ? 'text-emerald-700' : 'text-red-700'}>{pct(signal.changeDay)}</dd></div>
      <div><dt className="text-xs opacity-55">4 小時量能</dt><dd>{signal.volumeRatio.toFixed(2)} 倍</dd></div>
      <div><dt className="text-xs opacity-55">20 日相對 {benchmarkLabel}</dt><dd>{pct(signal.relative20d)}</dd></div>
      <div><dt className="text-xs opacity-55">4 小時 EMA200</dt><dd>{currencyPrefix}{number(signal.ema200)}</dd></div>
      <div><dt className="text-xs opacity-55">失效參考</dt><dd>{currencyPrefix}{number(signal.invalidation)}</dd></div>
    </dl>
    <div className="mt-4 border-t border-black/10 pt-3 text-xs leading-5">
      <p className="font-semibold">{bigFishLabel(signal.bigFish)}</p>
      <p className="mt-1 opacity-70">{signal.reasons.slice(0, 2).join('；')}</p>
      {signal.risks.length > 0 && <p className="mt-2 text-amber-800">風險：{signal.risks.slice(0, 2).join('；')}</p>}
    </div>
    <button onClick={() => onOpenChart(snapshot)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded border border-black/20 px-3 py-2 text-sm hover:bg-black/5">
      <BarChart3 size={16} />查看 4 小時／日線 K 線
    </button>
  </article>;
}

export function UsStockObservationTable({ observations }: { observations: UsStockObservation[] }) {
  if (!observations.length) return <p className="text-sm opacity-65">尚無入選樣本；新候選出現後會開始追蹤。</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
    <caption className="pb-3 text-left text-xs opacity-60">以 4 小時訊號收盤為研究價；每日依正常交易時段合成兩根，未扣費用與跳空。</caption>
    <thead className="border-b border-black/20"><tr>{['股票／入選時間', '當時條件', '4 小時', '1 日', '5 日', '最大漲／跌', '狀態'].map(label =>
      <th key={label} className="py-3 pr-4 font-medium">{label}</th>)}</tr></thead>
    <tbody>{observations.map(item => <tr key={item.id} className="border-b border-black/10 align-top">
      <td className="py-3 pr-4"><strong>{item.symbol}</strong><p className="max-w-40 truncate text-xs opacity-60">{item.name}</p><p className="text-xs opacity-60">{formatTaipeiTime(item.detectedAt)}</p></td>
      <td className="py-3 pr-4">{item.signal.bigFish.entry ? '經典吃大魚' : US_STOCK_PHASE_LABELS[item.signal.phase]}／{item.signal.score}</td>
      <td className="py-3 pr-4">{pct(item.returns.h4)}</td><td className="py-3 pr-4">{pct(item.returns.d1)}</td><td className="py-3 pr-4">{pct(item.returns.d5)}</td>
      <td className="py-3 pr-4">{item.returns.h4 != null ? `${pct(item.maxRise)}／${pct(item.maxFall)}` : '待追蹤'}</td>
      <td className="py-3 text-xs">{item.error || (item.complete ? '五日追蹤完成' : '追蹤中')}</td>
    </tr>)}</tbody>
  </table></div>;
}
