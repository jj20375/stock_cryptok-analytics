/** @file 以固定 UTC K 線檢查觀看範圍、短歷史提示與原始暖機資料保留，無網路或交易副作用。 */
import assert from 'node:assert/strict';
import { selectStockPerpChartRange, STOCK_PERP_RANGE_OPTIONS } from '../app/features/bitgetStockPerps/chart-range';
import { STOCK_PERP_INTERVALS } from '../app/services/bitgetStockPerps/market';
import type { StockDataPoint, Timeframe } from '../app/types';

const end = Date.UTC(2026, 9, 8);
const fixture = (timeframe: Timeframe, length: number): StockDataPoint[] => Array.from({ length }, (_, i) => ({
  timestamp: end - (length - i) * STOCK_PERP_INTERVALS[timeframe].duration,
  date: '', price: 100, open: 100, close: 100, high: 101, low: 99, volume: 100, currency: 'USDT', isMock: false,
}));
const daily = fixture('1d', 365);
for (const [range, length] of [['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365], ['ALL', 365]] as const) {
  const selection = selectStockPerpChartRange(daily, '1d', range);
  assert.equal(selection.data.length, length);
  assert.equal(selection.visibleRange?.from, end - length * 86_400_000);
  assert.equal(selection.truncated, false);
}
assert.equal(daily.length, 365, '範圍切換不得移除暖機用的歷史 K 線');
const recent = fixture('1d', 20);
assert.equal(selectStockPerpChartRange(recent, '1d', '6M').truncated, true);
assert.equal(selectStockPerpChartRange(recent, '1d', 'ALL').truncated, false);
assert.equal(selectStockPerpChartRange([], '1d', '3M').visibleRange, undefined);
for (const [timeframe, range, length] of [['15m', '1D', 96], ['60m', '1W', 168], ['4h', '1M', 180]] as const) {
  const selection = selectStockPerpChartRange(fixture(timeframe, 320), timeframe, range);
  assert.equal(selection.data.length, length);
  assert.equal(selection.visibleRange?.to, end + STOCK_PERP_INTERVALS[timeframe].duration);
  assert.equal(selection.truncated, false);
  assert.ok(STOCK_PERP_RANGE_OPTIONS[timeframe].includes(range));
}
console.log('股票永續日線與短週期觀看範圍、資料不足提示、暖機資料保留檢查通過');
