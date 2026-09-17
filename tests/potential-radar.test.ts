/** @file 驗證多週期時間邊界、量價分類與研究績效，避免前視和假突破。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, analyzePotential, analyzeTrendConfirmation, closedSeries, updateObservation } from '../app/services/potentialRadar/analysis';
import { selectCandidates } from '../app/services/potentialRadar/market';
import { DAY_MS, QUARTER_MS, type MarketTicker, type RadarObservation } from '../app/services/potentialRadar/types';
import { healthyDepth, potentialFixture } from './helpers/potentialFixture';

const cutoff = Date.UTC(2026, 8, 9, 12);

test('已收盤資料：忽略盤中暴漲，拒絕歷史不足、缺口、重複、非法價格與過期', () => {
  const candles = potentialFixture(cutoff);
  const current = { ...candles.at(-1)!, openTime: cutoff, close: 999, high: 999 };
  assert.deepEqual(closedSeries([...candles, current], cutoff), candles);
  assert.throws(() => closedSeries(candles.slice(0, 300), cutoff), /歷史不足/);
  assert.throws(() => closedSeries(candles.filter((_, i) => i !== 40), cutoff), /缺口/);
  assert.throws(() => closedSeries([...candles, candles[80]], cutoff), /缺口/);
  assert.throws(() => closedSeries(candles.map((c, i) => i === 100 ? { ...c, close: -1 } : c), cutoff), /無效/);
  assert.throws(() => closedSeries(candles.slice(0, -1), cutoff), /最新/);
});

test('聚合只產生 UTC 對齊完整 1h／4h，不把 12:15 當成 16:00 收盤', () => {
  const candles = potentialFixture(cutoff + QUARTER_MS);
  const hourly = aggregate(candles, 4);
  const fourHourly = aggregate(candles, 16);
  assert.equal(hourly.at(-1)!.openTime + 4 * QUARTER_MS, cutoff);
  assert.equal(fourHourly.at(-1)!.openTime + 16 * QUARTER_MS, cutoff);
  assert.equal(hourly.at(-1)!.turnover, 400_000);
  assert.equal(fourHourly.at(-1)!.turnover, 1_600_000);
  const withGap = candles.filter(c => c.openTime !== cutoff - 2 * QUARTER_MS);
  assert.ok(aggregate(withGap, 4).at(-1)!.openTime < cutoff - 4 * QUARTER_MS);
});

test('趨勢共振要求 4h MA20 回踩轉強與日線 MA7 同時向上；不足八根日線保留未知', () => {
  const candle = (close: number, openTime: number) => ({ openTime, open: close, high: close + 0.005,
    low: close - 0.1, close, volume: 1000, turnover: 100_000 });
  /** 緩慢上行讓最新收盤仍貼近 MA20；最後一根突破前根高點才算回踩轉強。 */
  const fourHourly = Array.from({ length: 22 }, (_, i) => candle(100 + i * 0.01, i * 16 * QUARTER_MS));
  const daily = Array.from({ length: 8 }, (_, i) => candle(100 + i * 0.1, i * DAY_MS));
  const confirmed = analyzeTrendConfirmation(fourHourly, daily);
  assert.equal(confirmed.fourHourPullback, 'CONFIRMED');
  assert.equal(confirmed.dailyTrend, true);
  assert.equal(confirmed.confirmed, true);
  const insufficient = analyzeTrendConfirmation(fourHourly, daily.slice(0, 7));
  assert.equal(insufficient.dailyTrend, null);
  assert.equal(insufficient.confirmed, false);
});

test('15 分放量突破、BTC 相對強度、過熱與流動性硬門檻', () => {
  const candles = potentialFixture(cutoff);
  const btc = potentialFixture(cutoff, false);
  const signal = analyzePotential(candles, btc, healthyDepth);
  assert.equal(signal.phase, 'BREAKOUT');
  assert.equal(signal.breakout, 101);
  assert.ok(Math.abs(signal.relative1h - 1.2) < 1e-8);
  assert.ok(Math.abs(signal.volumeRatio - 3.036) < 1e-8);
  assert.equal(signal.hourlyUp, true);
  assert.equal(signal.fourHourlyUp, true);
  const thin = analyzePotential(candles, btc, { ...healthyDepth, bid: 1 });
  assert.equal(thin.phase, 'EXCLUDED');
  assert.equal(thin.score, 0);
  assert.equal(analyzePotential(candles, btc, { ...healthyDepth, spreadPct: 1 }).phase, 'EXCLUDED');
  const lowVolume = candles.map(c => ({ ...c, turnover: 1 }));
  assert.equal(analyzePotential(lowVolume, btc, healthyDepth).phase, 'EXCLUDED');
  const hot = candles.map((c, i) => i === candles.length - 1 ? { ...c, close: 140, high: 140 } : c);
  assert.equal(analyzePotential(hot, btc, healthyDepth).phase, 'EXTENDED');
  assert.throws(() => analyzePotential(candles, potentialFixture(cutoff - QUARTER_MS), healthyDepth), /時間不一致/);
});

test('提前關注不必突破；回踩續強守住原突破位，跌破後不誤判', () => {
  const candles = potentialFixture(cutoff);
  candles[candles.length - 1] = { ...candles.at(-1)!, close: 100.8, high: 101, turnover: 250_000 };
  assert.equal(analyzePotential(candles, potentialFixture(cutoff, false), healthyDepth).phase, 'WATCH');
  const retest = potentialFixture(cutoff);
  const n = retest.length;
  retest[n - 3] = { ...retest[n - 3], close: 101.5, high: 102, turnover: 400_000 };
  retest[n - 2] = { ...retest[n - 2], open: 101.5, close: 101.2, high: 101.6, low: 101 };
  retest[n - 1] = { ...retest[n - 1], open: 101.2, close: 101.7, high: 101.8, low: 101, turnover: 250_000 };
  const signal = analyzePotential(retest, potentialFixture(cutoff, false), healthyDepth);
  assert.equal(signal.phase, 'RETEST');
  assert.equal(signal.breakout, 101);
  retest[n - 2].close = 100;
  retest[n - 2].low = 99;
  assert.notEqual(analyzePotential(retest, potentialFixture(cutoff, false), healthyDepth).phase, 'RETEST');
});

test('24h 流動性用 96 根真實成交額，不沿用其他週期的六根近似量', () => {
  const candles = potentialFixture(cutoff);
  candles.slice(-96, -6).forEach(c => { c.turnover = 1; });
  assert.equal(analyzePotential(candles, potentialFixture(cutoff, false), healthyDepth).phase, 'EXCLUDED');
});

test('追蹤排除入選當根極值，計算固定時間報酬並標記缺口', () => {
  const signal = analyzePotential(potentialFixture(cutoff), potentialFixture(cutoff, false), healthyDepth);
  const observation: RadarObservation = { id: 'fixture', symbol: 'XYZUSDT', enteredAt: cutoff, detectedAt: cutoff + 120_000,
    entryPrice: 100, signal, checkedThrough: cutoff, returns: { h24: null, h72: null, d7: null }, maxRise: 0, maxFall: 0, complete: false, error: null };
  const candles = potentialFixture(cutoff + 7 * DAY_MS, false, 673);
  candles[0].high = 999;
  candles[0].low = 1;
  candles.find(c => c.openTime + QUARTER_MS === cutoff + DAY_MS)!.close = 110;
  candles.find(c => c.openTime + QUARTER_MS === cutoff + DAY_MS)!.high = 112;
  const next = updateObservation(observation, candles);
  assert.ok(Math.abs(next.returns.h24! - 10) < 1e-8);
  assert.equal(next.returns.h72, 0);
  assert.equal(next.returns.d7, 0);
  assert.ok(Math.abs(next.maxRise - 12) < 1e-8);
  assert.ok(Math.abs(next.maxFall + 1) < 1e-8);
  assert.equal(next.complete, true);
  assert.deepEqual(updateObservation(next, candles), next);
  const missed = updateObservation(observation, candles.slice(10));
  assert.ok(missed.error);
  assert.equal(missed.complete, false);
});

test('動態初篩保留輪替探索，限制十二檔並去重', () => {
  const universe: MarketTicker[] = Array.from({ length: 40 }, (_, i) => ({ symbol: `COIN${i}USDT`, price: 1,
    turnover24h: 10_000_000 + i, change24h: i / 2, spreadPct: 0.01 }));
  const first = selectCandidates(universe, cutoff);
  assert.equal(first.length, 12);
  assert.equal(new Set(first.map(c => c.symbol)).size, 12);
  assert.notDeepEqual(first, selectCandidates(universe, cutoff + QUARTER_MS));
  assert.deepEqual(selectCandidates([], cutoff), []);
});
