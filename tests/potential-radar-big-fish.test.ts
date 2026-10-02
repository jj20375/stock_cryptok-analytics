/** @file 以合成行情及手算值驗證吃大魚的邊界、Wilder 平滑、獨立入榜與收盤限制。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeBigFish, bigFishSupertrend } from '../app/services/potentialRadar/bigFish';
import { analyzePotential, closedFourHourSeries, closedSeries } from '../app/services/potentialRadar/analysis';
import { FOUR_HOUR_MS, isRadarCandidate, QUARTER_MS, type RadarCandle } from '../app/services/potentialRadar/types';
import { healthyDepth, potentialFixture } from './helpers/potentialFixture';

const cutoff = Date.UTC(2026, 8, 14, 12);
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const bar = (close: number, i: number): RadarCandle => ({ openTime: i * QUARTER_MS,
  open: close, high: close + 1, low: close - 1, close, volume: 1000, turnover: 100_000 });

test('Supertrend 第十根起有線位；手算 ATR 2 → 2.9 → 2.81 → 4.629，且翻綠與翻紅正確', () => {
  const candles = Array.from({ length: 10 }, (_, i) => bar(100, i));
  candles.push({ ...bar(110, 10), open: 100, high: 110, low: 99 });
  candles.push(bar(110, 11));
  candles.push({ ...bar(90, 12), open: 110, high: 110, low: 89 });
  const result = bigFishSupertrend(candles);
  assert.ok(result.line.slice(0, 9).every(Number.isNaN));
  assert.deepEqual(result.direction.slice(9), [1, -1, -1, 1]);
  [108, 92.9, 98.76, 118.016].forEach((value, i) => near(result.line[i + 9], value));
  assert.deepEqual(bigFishSupertrend(candles.slice(0, 12)).line, result.line.slice(0, 12));
});

test('前根 MACD 相等也算金叉；持續在線上不重複觸發，EMA 使用首根種子', () => {
  const candles = potentialFixture(cutoff, false);
  candles.at(-1)!.close = 100.1;
  const fish = analyzeBigFish(candles)!;
  assert.equal(fish.earlyLong, true);
  assert.equal(fish.trendLong, false);
  assert.equal(fish.entry, true);
  near(fish.ema200, 100 + 0.1 * 2 / 201);
  near(fish.macdLine, 0.1 * (2 / 13 - 2 / 27));
  near(fish.signalLine, fish.macdLine * 2 / 10);
  assert.equal(fish.exitLong, true);
  const next = [...candles, { ...candles.at(-1)!, openTime: cutoff }];
  assert.equal(analyzeBigFish(next)!.earlyLong, false);
  assert.equal(analyzeBigFish(next)!.entry, false);
  assert.equal(analyzeBigFish(candles.slice(0, 200)), null);
});

test('MACD 金叉低於 EMA200 容忍範圍不得提早進場；翻綠獨立成立', () => {
  const below = Array.from({ length: 400 }, (_, i) => bar(i < 380 ? 100 : 90, i));
  below.at(-1)!.close = 91;
  const fish = analyzeBigFish(below)!;
  assert.ok(fish.macdLine > fish.signalLine);
  assert.ok(below.at(-1)!.close < fish.ema200 * 0.98);
  assert.equal(fish.earlyLong, false);
  assert.equal(fish.entry, false);
  const flip = Array.from({ length: 1000 }, (_, i) => bar(i < 900 ? 200 : 100, i));
  flip[999] = bar(120, 999);
  const trend = analyzeBigFish(flip)!;
  assert.ok(120 < trend.ema200 * 0.98);
  assert.equal(trend.earlyLong, false);
  assert.equal(trend.trendLong, true);
  assert.equal(trend.entry, true);
  assert.equal(trend.exitLong, false);
  const continued = [...flip, bar(120, 1000)];
  assert.equal(analyzeBigFish(continued)!.trendLong, false);
  const red = analyzeBigFish([...continued, bar(80, 1001)])!;
  assert.equal(red.flippedRed, true);
  assert.equal(red.exitLong, true);
});

test('獨立吃大魚可讓 WAIT 入選，但不改分數、不繞過流動性或過熱限制，舊資料相容', () => {
  const candles = potentialFixture(cutoff, false);
  candles.at(-1)!.close = 100.1;
  const btc = potentialFixture(cutoff, false);
  /** 正式掃描以 4 小時 K 另算吃大魚後傳入；計算函式不綁週期，這裡直接用同一組合成序列。 */
  const fish = analyzeBigFish(candles);
  const signal = analyzePotential(candles, btc, healthyDepth, fish);
  assert.equal(signal.phase, 'WAIT');
  assert.equal(isRadarCandidate(signal), true);
  assert.equal(signal.score, Object.values(signal.parts).reduce((sum, value) => sum + value, 0));
  assert.equal(isRadarCandidate({ ...signal, bigFish: undefined }), false);
  assert.equal(isRadarCandidate({ ...signal, phase: 'BREAKOUT', bigFish: undefined }), true);
  const thin = analyzePotential(candles, btc, { ...healthyDepth, bid: 0 }, fish);
  assert.equal(thin.bigFish!.entry, true);
  assert.equal(isRadarCandidate(thin), false);
  const hot = candles.map((c, i) => i === candles.length - 1 ? { ...c, close: 140, high: 140 } : c);
  const overheated = analyzePotential(hot, btc, healthyDepth, analyzeBigFish(hot));
  assert.equal(overheated.bigFish!.entry, true);
  assert.equal(isRadarCandidate(overheated), false);
  /** 未傳入 4 小時結果代表本輪尚未算到，不能推定為未觸發。 */
  assert.equal(analyzePotential(candles, btc, healthyDepth).bigFish, undefined);
});

test('4 小時序列驗證：要求 UTC 4 小時對齊、無缺口、最新根已收盤且至少 201 根', () => {
  const fourHourCutoff = Date.UTC(2026, 8, 14, 12);
  const series = potentialFixture(fourHourCutoff, false, 300, FOUR_HOUR_MS);
  assert.equal(closedFourHourSeries(series, fourHourCutoff).length, 300);
  /** 盤中未收盤的那根會被忽略，不能提前判斷。 */
  const live = { ...series.at(-1)!, openTime: fourHourCutoff };
  assert.equal(closedFourHourSeries([...series, live], fourHourCutoff).length, 300);
  assert.throws(() => closedFourHourSeries(series.slice(0, 200), fourHourCutoff), /歷史不足/);
  assert.throws(() => closedFourHourSeries(series, fourHourCutoff + FOUR_HOUR_MS), /最新已收盤/);
  const gap = series.filter((_, i) => i !== 150);
  assert.throws(() => closedFourHourSeries(gap, fourHourCutoff), /缺口/);
  /** 15 分間距的序列不得被當成 4 小時線。 */
  assert.throws(() => closedFourHourSeries(potentialFixture(fourHourCutoff, false, 400), fourHourCutoff), /缺口|無效/);
});

test('盤中金叉不進榜；最新收盤才觸發，下一根已收盤不延續前根事件', () => {
  const candles = potentialFixture(cutoff, false);
  const live = { ...candles.at(-1)!, openTime: cutoff, close: 100.1 };
  assert.equal(analyzeBigFish(closedSeries([...candles, live], cutoff))!.entry, false);
  assert.equal(analyzeBigFish(closedSeries([...candles, live], cutoff + QUARTER_MS))!.entry, true);
  const next = { ...live, openTime: cutoff + QUARTER_MS };
  assert.equal(analyzeBigFish(closedSeries([...candles, live, next], cutoff + 2 * QUARTER_MS))!.entry, false);
});
