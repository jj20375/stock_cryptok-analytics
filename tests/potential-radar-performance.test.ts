/** @file 驗證條件績效的分母、重疊分組、缺值與 1R 定義；資料均為合成研究樣本。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PerformancePanel } from '../app/features/potentialRadar/PerformancePanel';
import { summarizePotentialPerformance } from '../app/services/potentialRadar/performance';
import type { RadarObservation } from '../app/services/potentialRadar/types';

function observation(overrides: Partial<RadarObservation> & { id: string }): RadarObservation {
  return {
    id: overrides.id, symbol: `${overrides.id}USDT`, enteredAt: 1, detectedAt: 2, entryPrice: 100,
    signal: { phase: 'WAIT', bigFish: null, trendConfirmation: null, invalidation: 90 } as RadarObservation['signal'],
    checkedThrough: 1, returns: { h24: null, h72: null, d7: null }, maxRise: 0, maxFall: 0,
    complete: false, error: null, ...overrides,
  };
}

test('績效分組保留重疊樣本，平均與正報酬率只使用已成熟分母', () => {
  const rows = [
    observation({ id: 'A', returns: { h24: 10, h72: 20, d7: 30 }, maxRise: 40, maxFall: -5, complete: true,
      signal: { phase: 'BREAKOUT', bigFish: { entry: true }, trendConfirmation: { confirmed: true }, invalidation: 90 } as RadarObservation['signal'] }),
    observation({ id: 'B', returns: { h24: -10, h72: null, d7: null }, maxRise: 2, maxFall: -3,
      signal: { phase: 'WAIT', bigFish: { entry: true }, trendConfirmation: { confirmed: false }, invalidation: 90 } as RadarObservation['signal'] }),
    observation({ id: 'C', returns: { h24: 5, h72: 0, d7: -2 }, maxRise: 5, maxFall: -12, complete: true,
      signal: { phase: 'RETEST', bigFish: null, trendConfirmation: { confirmed: false }, invalidation: 95 } as RadarObservation['signal'] }),
  ];
  const groups = summarizePotentialPerformance(rows);
  const all = groups.find(group => group.key === 'ALL')!;
  assert.equal(all.sampleCount, 3);
  assert.equal(all.h24.count, 3);
  assert.ok(Math.abs(all.h24.average! - 5 / 3) < 1e-9);
  assert.ok(Math.abs(all.h24.positiveRate! - 200 / 3) < 1e-9);
  assert.equal(all.h72.count, 2);
  assert.equal(all.completedCount, 2);
  assert.equal(all.oneRHitRate, 100);
  assert.equal(all.worstDrawdown, -12);
  const fish = groups.find(group => group.key === 'BIG_FISH')!;
  assert.equal(fish.sampleCount, 2);
  assert.equal(fish.h24.average, 0);
  assert.equal(fish.h24.positiveRate, 50);
  assert.equal(groups.find(group => group.key === 'TREND_CONFIRMED')!.sampleCount, 1);
  assert.equal(groups.find(group => group.key === 'STRUCTURE')!.sampleCount, 2);
});

test('沒有成熟資料時回傳 null，不用 0 偽裝報酬或達標率', () => {
  const all = summarizePotentialPerformance([observation({ id: 'PENDING' })])[0];
  assert.equal(all.h24.count, 0);
  assert.equal(all.h24.average, null);
  assert.equal(all.h24.positiveRate, null);
  assert.equal(all.oneRHitRate, null);
  assert.equal(all.worstDrawdown, null);
});

test('績效表呈現每項實際分母、重疊提醒與風險定義', () => {
  const row = observation({ id: 'SOL', returns: { h24: 2.5, h72: null, d7: null },
    signal: { phase: 'BREAKOUT', bigFish: { entry: true }, trendConfirmation: { confirmed: true }, invalidation: 95 } as RadarObservation['signal'] });
  const html = renderToStaticMarkup(createElement(PerformancePanel, { observations: [row] }));
  assert.ok(html.includes('最近 1 筆入選紀錄'));
  assert.ok(html.includes('+2.50%'));
  assert.ok(html.includes('正報酬 100.0% · n=1'));
  assert.ok(html.includes('條件可重疊'));
  assert.ok(html.includes('1R＝入選收盤到當時結構失效價'));
  assert.ok(html.includes('overflow-x-auto'));
});
