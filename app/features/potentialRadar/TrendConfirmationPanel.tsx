/** @file 呈現 4h 回踩與日線趨勢共振；只讀雷達快照，不計算或改變候選資格。 */
import type { RadarSignal, TrendConfirmation } from '../../services/potentialRadar/types';

const PULLBACK_LABELS: Record<TrendConfirmation['fourHourPullback'], string> = {
  CONFIRMED: '已確認回踩轉強', FORMING: '回踩形成中', NONE: '尚未出現回踩', UNAVAILABLE: '4h 歷史不足',
};
const formatPrice = (value: number | null) => value == null ? '—' : value.toLocaleString('en-US', { maximumSignificantDigits: 7 });

export function TrendConfirmationPanel({ signal }: { signal: RadarSignal }) {
  const trend = signal.trendConfirmation;
  if (!trend) return <p className="rounded bg-black/5 p-3 text-xs">趨勢共振：此筆尚未計算，等待新版掃描。</p>;
  const tone = trend.confirmed ? 'border-cyan-300 bg-cyan-50 text-cyan-950' : 'border-black/10 bg-black/5';
  const daily = trend.dailyTrend == null ? '完整日線不足八根' : trend.dailyTrend ? '日線 MA7 向上' : '日線 MA7 未向上';
  return <section aria-label="中週期趨勢共振" className={`rounded-lg border p-3 space-y-2 text-sm ${tone}`}>
    <p className="font-semibold">趨勢共振 · 4h MA20＋日線 MA7</p>
    <p>{trend.confirmed ? '已確認：4h 回踩 MA20 後轉強，且日線趨勢向上' : `${PULLBACK_LABELS[trend.fourHourPullback]}｜${daily}`}</p>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      <dt>4h MA20</dt><dd className="text-right">{formatPrice(trend.fourHourMa20)} · {trend.fourHourMa20Rising == null ? '—' : trend.fourHourMa20Rising ? '上升' : '未上升'}</dd>
      <dt>日線 MA7</dt><dd className="text-right">{formatPrice(trend.dailyMa7)} · {daily}</dd>
    </dl>
    <p className="text-xs opacity-65">只使用同一來源已收盤 15 分 K 線聚合；此為排序與觀察確認，不是下單或勝率保證。</p>
  </section>;
}
