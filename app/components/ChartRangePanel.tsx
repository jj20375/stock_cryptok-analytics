/** @component 共用 K 線觀看控制列；首頁與股票合約沿用相同按鈕、日期覆蓋及載入狀態，資料由頁面提供。 */
import type { StockDataPoint, Timeframe } from '../types';
import { chartDateFormatter, CHART_TIMEZONE_LABELS } from '../utils/chartDate';
import { cn } from '../utils/cn';

export const CHART_TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '1d': '日線', '4h': '4小時線', '60m': '1小時線', '15m': '15分鐘線',
};

export function ChartRangePanel({ timeframe, range, ranges, visibleData, totalCount, timezone, loading,
  ariaLabel, availabilityHint, truncated = false, onTimeframeChange, onRangeChange }: {
  timeframe: Timeframe; range: string; ranges: { value: string; label: string }[];
  visibleData: StockDataPoint[]; totalCount: number; timezone: string; loading: boolean;
  ariaLabel: string; availabilityHint: string; truncated?: boolean;
  onTimeframeChange: (value: Timeframe) => void; onRangeChange: (value: string) => void;
}) {
  const first = visibleData[0], last = visibleData.at(-1);
  const dateFormat = chartDateFormatter(timezone, false);
  return <section aria-label={ariaLabel} className="rounded border border-slate-700 bg-slate-900/80 p-4 text-slate-100">
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div role="group" aria-label="K 線週期" className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-xs text-slate-400">K 線週期</span>
        {(Object.keys(CHART_TIMEFRAME_LABELS) as Timeframe[]).map(value => <button key={value} type="button"
          aria-pressed={timeframe === value} onClick={() => onTimeframeChange(value)}
          className={cn('rounded border px-3 py-2 text-xs transition-colors', timeframe === value
            ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200' : 'border-slate-600 text-slate-300 hover:bg-slate-800')}>
          {CHART_TIMEFRAME_LABELS[value]}
        </button>)}
      </div>
      <div role="group" aria-label="觀看範圍" className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-xs text-slate-400">觀看範圍</span>
        {ranges.map(({ value, label }) => <button key={value} type="button" aria-pressed={range === value}
          disabled={loading || !totalCount} onClick={() => onRangeChange(value)}
          className={cn('rounded border px-3 py-2 text-xs transition-colors disabled:opacity-40', range === value
            ? 'border-emerald-400 bg-emerald-400/15 text-emerald-200' : 'border-slate-600 text-slate-300 hover:bg-slate-800')}>
          {label}
        </button>)}
      </div>
    </div>
    <p className="mt-3 text-xs text-slate-400" aria-live="polite">
      {loading ? '正在讀取行情…' : first && last
        ? `實際顯示：${dateFormat.format(first.timestamp)} ～ ${dateFormat.format(last.timestamp)}（${CHART_TIMEZONE_LABELS[timezone] ?? timezone}），${visibleData.length} 根／已載入 ${totalCount} 根。`
        : '行情載入後可選擇觀看範圍。'}
    </p>
    {truncated && !loading && <p className="mt-2 text-xs text-amber-300" role="status">資料未涵蓋完整所選範圍，目前顯示全部可用 K 線。</p>}
    <p className="mt-2 text-[11px] text-slate-500">{availabilityHint}</p>
  </section>;
}
