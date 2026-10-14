/** @file 以手算序列及 EMA 閉式加權和驗證自算吃大魚；不是 TradingView 實際歷史逐根對帳。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeBigFish, bigFishSupertrend, BIG_FISH_RULES } from '../app/services/strategy/bigFish';
import type { Candle } from '../app/services/strategy/types';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const candle = (close: number, index: number): Candle => ({
  openTime: index * 14_400_000, open: close, high: close + 1, low: close - 1, close, volume: 1_000,
});

/** 用完整加權和而非正式程式的逐根遞迴，獨立驗證首根種子與 alpha=2/(period+1)。 */
function closedFormEma(values: number[], period: number) {
  const alpha = 2 / (period + 1);
  const decay = 1 - alpha;
  const last = values.length - 1;
  return values[0] * decay ** last + values.slice(1)
    .reduce((sum, value, index) => sum + alpha * value * decay ** (last - index - 1), 0);
}

test('不依賴外部警報，自算 EMA200 與 MACD 12/26/9 符合獨立閉式加權和', () => {
  const candles = Array.from({ length: 320 }, (_, index) => candle(100 + Math.sin(index / 7) * 8 + index * 0.02, index));
  const closes = candles.map(bar => bar.close);
  const dif = closes.map((_, index) => closedFormEma(closes.slice(0, index + 1), 12) - closedFormEma(closes.slice(0, index + 1), 26));
  const signal = analyzeBigFish(candles)!;
  near(signal.ema200, closedFormEma(closes, 200));
  near(signal.macdLine, dif.at(-1)!);
  near(signal.signalLine, closedFormEma(dif, 9));
});

test('已收盤金叉只觸發一根，MACD 及 Supertrend 維持 OR，而不是額外要求兩者同時成立', () => {
  const flat = Array.from({ length: 240 }, (_, index) => candle(100, index));
  flat.at(-1)!.close = 100.1;
  const signal = analyzeBigFish(flat)!;
  assert.equal(signal.earlyLong, true);
  assert.equal(signal.trendLong, false);
  assert.equal(signal.entry, true);
  assert.equal(signal.direction, 1);
  assert.equal(analyzeBigFish([...flat, candle(100.1, 240)])!.entry, false);
  assert.equal(analyzeBigFish(flat.slice(0, 200)), null);
  assert.equal(BIG_FISH_RULES.emaTolerance, 0.98);
});

test('ATR 首十根平均與 Wilder 平滑的手算基準，綠為 -1、紅為 1', () => {
  const bars = Array.from({ length: 10 }, (_, index) => candle(100, index));
  bars.push({ ...candle(110, 10), open: 100, high: 110, low: 99 });
  bars.push(candle(110, 11));
  bars.push({ ...candle(90, 12), open: 110, high: 110, low: 89 });
  const trend = bigFishSupertrend(bars);
  assert.ok(trend.line.slice(0, 9).every(Number.isNaN));
  assert.deepEqual(trend.direction.slice(9), [1, -1, -1, 1]);
  // 手算 ATR 2、2.9、2.81、4.629，加上上下軌遞迴得到下列防守線。
  [108, 92.9, 98.76, 118.016].forEach((expected, index) => near(trend.line[index + 9], expected));
});
