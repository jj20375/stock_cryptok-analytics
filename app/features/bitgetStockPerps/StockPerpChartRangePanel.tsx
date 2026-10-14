/** @component 股票永續觀看控制列；以共用 UI 呈現週期選項、真實 UTC 日期與資料不足提示。 */
import type { StockDataPoint, Timeframe } from '../../types';
import { ChartRangePanel } from '../../components/ChartRangePanel';
import { STOCK_PERP_CHART_RANGES, STOCK_PERP_RANGE_OPTIONS, type StockPerpChartRange } from './chart-range';

export function StockPerpChartRangePanel({ timeframe, range, visibleData, totalCount, truncated, loading, onTimeframeChange, onRangeChange }: {
  timeframe: Timeframe; range: StockPerpChartRange; visibleData: StockDataPoint[]; totalCount: number;
  truncated: boolean; loading: boolean; onTimeframeChange: (value: Timeframe) => void;
  onRangeChange: (value: StockPerpChartRange) => void;
}) {
  return <ChartRangePanel ariaLabel="股票合約 K 線觀看範圍" timeframe={timeframe} range={range}
    ranges={STOCK_PERP_RANGE_OPTIONS[timeframe].map(value => ({ value, label: STOCK_PERP_CHART_RANGES[value].label }))}
    visibleData={visibleData} totalCount={totalCount} timezone="Etc/UTC" loading={loading} truncated={truncated}
    onTimeframeChange={onTimeframeChange} onRangeChange={value => onRangeChange(value as StockPerpChartRange)}
    availabilityHint="全部＝此週期已取得的資料；日線最多讀取近 1 年，短週期最多近 320 根。商品上架較晚時，歷史區間可能較短。" />;
}
