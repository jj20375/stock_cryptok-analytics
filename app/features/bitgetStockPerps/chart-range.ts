/** @file 股票永續觀看區間；以最後一根已收盤 K 線為基準裁切顯示，不改策略暖機與行情資料。 */
import type { StockDataPoint, Timeframe } from '../../types';
import { STOCK_PERP_INTERVALS } from '../../services/bitgetStockPerps/market';

/** 區間以 UTC 曆日計算；短週期選項限制在目前取得的 320 根附近，避免承諾不存在的多年分鐘線。 */
export const STOCK_PERP_CHART_RANGES = {
  '1D': { label: '1天', days: 1 }, '3D': { label: '3天', days: 3 }, '1W': { label: '1週', days: 7 },
  '1M': { label: '1個月', days: 30 }, '3M': { label: '3個月', days: 90 }, '6M': { label: '6個月', days: 180 },
  '1Y': { label: '1年', days: 365 }, ALL: { label: '全部', days: null },
} as const;
export type StockPerpChartRange = keyof typeof STOCK_PERP_CHART_RANGES;
export const STOCK_PERP_RANGE_OPTIONS: Record<Timeframe, StockPerpChartRange[]> = {
  '1d': ['1M', '3M', '6M', '1Y', 'ALL'], '4h': ['1W', '1M', 'ALL'],
  '60m': ['1D', '3D', '1W', 'ALL'], '15m': ['1D', '3D', 'ALL'],
};
export const STOCK_PERP_DEFAULT_RANGES: Record<Timeframe, StockPerpChartRange> = {
  '1d': '3M', '4h': '1M', '60m': '1W', '15m': '1D',
};

/** 保留完整 K 線供均線及策略計算；只回傳觀看根數及 viewport，不因範圍按鈕重抓 API。 */
export function selectStockPerpChartRange(data: StockDataPoint[], timeframe: Timeframe, range: StockPerpChartRange) {
  const first = data[0], last = data.at(-1);
  if (!first || !last) return { data: [], visibleRange: undefined, truncated: false };
  const interval = STOCK_PERP_INTERVALS[timeframe].duration;
  const days = STOCK_PERP_CHART_RANGES[range].days;
  /** 最後一根的收盤毫秒為觀看區間終點，避免當根未收盤或瀏覽器時區造成少一根。 */
  const cutoff = days == null ? first.timestamp : last.timestamp + interval - days * 86_400_000;
  const visibleData = data.filter(candle => candle.timestamp >= cutoff);
  const start = visibleData[0] ?? last;
  return {
    data: visibleData,
    /** 右側保留兩根空白以容納策略文字標籤；價格縮放仍由 Vela 計算。 */
    visibleRange: { from: start.timestamp, to: last.timestamp + interval * 2 },
    truncated: days != null && first.timestamp > cutoff + interval,
  };
}
