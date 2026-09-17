/** @file 驗證 AIN／PONS 類底部翻綠分級；合成資料不代表真實績效。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPerpSignal, PERP_BEST_SIGNAL_RULES } from '../app/services/binancePerpRadar/quality';
import { formatPerpSignalMessage } from '../app/services/binancePerpRadar/notifications';
import { analyzeBigFish } from '../app/services/potentialRadar/bigFish';
import { QUARTER_MS, type RadarCandle } from '../app/services/potentialRadar/types';

const flatThenBreak = (lastClose: number): RadarCandle[] => Array.from({ length: 400 }, (_, index) => {
  const close = index === 399 ? lastClose : 100;
  return {
    openTime: Date.UTC(2026, 8, 15) + index * QUARTER_MS,
    open: 100,
    high: Math.max(100.1, close),
    low: 99.9,
    close,
    volume: 0,
    turnover: 0,
  };
});

test('長紅後首次翻綠、貼近 EMA200 且觸發前未過熱會列為最佳型', () => {
  const candles = flatThenBreak(101);
  const signal = analyzeBigFish(candles)!;
  const quality = classifyPerpSignal(candles, signal);
  assert.equal(signal.trendLong, true);
  assert.equal(quality.grade, 'BEST');
  assert.ok(quality.priorRedBars >= PERP_BEST_SIGNAL_RULES.minimumPriorRedBars);
  assert.ok(quality.emaDistancePct < PERP_BEST_SIGNAL_RULES.maximumEmaDistancePct);
  assert.equal(quality.prior4hChangePct, 0);
  assert.equal(quality.prior24hChangePct, 0);

  const message = formatPerpSignalMessage({
    ticker: { symbol: 'AINUSDT', baseAsset: 'AIN', price: 101, change24h: 1, quoteVolume24h: 10_000_000 },
    signal,
    quality,
    markPrice: 101,
  });
  assert.match(message, /^⭐/);
  assert.match(message, /最佳型 · 底部紅轉綠/);
  assert.match(message, /前紅/);
});

test('已明顯遠離 EMA200 的翻綠保留通知，但只列趨勢翻綠型', () => {
  const candles = flatThenBreak(112);
  const signal = analyzeBigFish(candles)!;
  const quality = classifyPerpSignal(candles, signal);
  assert.equal(signal.trendLong, true);
  assert.ok(quality.emaDistancePct > PERP_BEST_SIGNAL_RULES.maximumEmaDistancePct);
  assert.equal(quality.grade, 'TREND_FLIP');
});

test('只有 MACD 金叉時保留為一般提早型，不冒充底部翻綠', () => {
  const candles = flatThenBreak(100.5);
  const signal = analyzeBigFish(candles)!;
  const quality = classifyPerpSignal(candles, signal);
  assert.equal(signal.earlyLong, true);
  assert.equal(signal.trendLong, false);
  assert.equal(quality.grade, 'EARLY_MACD');
});
