/** @file 共用觀看列與行情卡片的最小渲染檢查；使用固定行情，確認選取、載入、缺值與美東日期。 */
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartRangePanel } from '../app/components/ChartRangePanel';
import { MarketQuoteCards } from '../app/features/home/components/MarketQuoteCards';

const candle = { timestamp: Date.parse('2026-10-08T00:30:00Z'), date: '', price: 336.67, close: 336.67,
  open: 336.96, high: 338.67, low: 332.78, volume: 34128200, currency: 'USD', isMock: false };
const props = { timeframe: '1d' as const, range: '3M', ranges: [{ value: '3M', label: '3個月' }], visibleData: [candle],
  totalCount: 500, timezone: 'America/New_York', loading: false, ariaLabel: '首頁 K 線觀看範圍', availabilityHint: '實際行情資料',
  onTimeframeChange: () => {}, onRangeChange: () => {} };
const panel = renderToStaticMarkup(createElement(ChartRangePanel, props));
assert.match(panel, /3個月/); assert.match(panel, /aria-pressed="true"/);
assert.match(panel, /2026年10月7日/); assert.match(panel, /美東時間/); assert.match(panel, /1 根／已載入 500 根/);
assert.match(renderToStaticMarkup(createElement(ChartRangePanel, { ...props, loading: true })), /disabled=""/);
assert.match(renderToStaticMarkup(createElement(ChartRangePanel, { ...props, visibleData: [], totalCount: 0 })), /行情載入後/);
const quoteProps = { latestData: candle, currentPrice: 336.67, priceChange: 3.04, priceChangePercent: 0.91,
  market: 'US' as const, loading: false };
const quotes = renderToStaticMarkup(createElement(MarketQuoteCards, quoteProps));
assert.match(quotes, /336\.67/); assert.match(quotes, /3\.04（0\.91%）/); assert.match(quotes, /34,128,200/);
assert.match(quotes, /開盤／最高／最低/); assert.match(quotes, /2026年10月7日/);
assert.match(renderToStaticMarkup(createElement(MarketQuoteCards, { ...quoteProps, priceChange: 3.039995 })), /3\.04（0\.91%）/);
assert.doesNotMatch(renderToStaticMarkup(createElement(MarketQuoteCards, { ...quoteProps, latestData: null })), /336\.67/);
assert.doesNotMatch(renderToStaticMarkup(createElement(MarketQuoteCards, { ...quoteProps, loading: true })), /336\.67/);
console.log('共用圖表控制列與行情卡片渲染檢查通過');
