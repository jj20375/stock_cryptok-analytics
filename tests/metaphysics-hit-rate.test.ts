/** @file 命中率：實際變盤判定（大波動或連三日同向後反轉）、Wilson 區間、基準對照與時區日期換算。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyOutcomes, dailyBarsFromCandles, summarizeHitRate, wilson } from '../app/services/metaphysics/hitRate';

/** 前 21 根在 100、101 間來回震盪（平均波動約 1%），之後連漲三天再小跌、最後大漲。 */
const closes = [...Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 101)), 102, 103, 104, 103.9, 110];
const bars = closes.map((close, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, close }));

test('實際變盤：大波動、連三日同向後反轉都算；普通漲跌不算；前 21 根資料不足不輸出', () => {
  const outcomes = classifyOutcomes(bars);
  assert.deepEqual(outcomes.map((o) => o.date), ['2026-01-22', '2026-01-23', '2026-01-24', '2026-01-25', '2026-01-26']);
  assert.deepEqual(outcomes.map((o) => o.isTurning), [true, false, false, true, true]);
  assert.equal(outcomes[0].changePct, 2);
});

test('Wilson 95% 區間：30/50 約 0.462–0.724；樣本 0 回傳 null', () => {
  const stat = wilson(30, 50);
  assert.equal(stat.rate, 0.6);
  assert.ok(Math.abs(stat.low! - 0.4618) < 0.001);
  assert.ok(Math.abs(stat.high! - 0.7239) < 0.001);
  assert.deepEqual(wilson(0, 0), { hits: 0, total: 0, rate: null, low: null, high: null });
});

test('命中率摘要：只計有實際結果的列；方向基準是一直猜漲', () => {
  const rows = [
    { turningStrength: 3, directionScore: 40, actualChangePct: 2, isTurningActual: true },
    { turningStrength: 2, directionScore: -35, actualChangePct: 1, isTurningActual: false },
    { turningStrength: 0, directionScore: 5, actualChangePct: -1, isTurningActual: false },
    { turningStrength: 3, directionScore: 50, actualChangePct: null, isTurningActual: null },
  ];
  const summary = summarizeHitRate(rows);
  assert.equal(summary.turning.total, 2);
  assert.equal(summary.turning.hits, 1);
  assert.equal(summary.turningBaseline.total, 3);
  assert.equal(summary.turningBaseline.hits, 1);
  assert.equal(summary.direction.total, 2);
  assert.equal(summary.direction.hits, 1);
  assert.equal(summary.directionBaseline.hits, 2);
  assert.equal(summary.turningDistinguishable, false);
});

test('日線換當地日期：紐約 2026-11-09 01:00 UTC 屬於 11-08', () => {
  const candle = (openTime: number, close: number) => ({ openTime, open: close, high: close, low: close, close, volume: 0 });
  assert.deepEqual(dailyBarsFromCandles([candle(Date.UTC(2026, 10, 9, 14, 30), 6), candle(Date.UTC(2026, 10, 9, 1), 5)], 'America/New_York'),
    [{ date: '2026-11-08', close: 5 }, { date: '2026-11-09', close: 6 }]);
});
