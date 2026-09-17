/** @file 驗證候選通知只在新事件建立，並保留吃大魚與風控內容。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzePotential } from '../app/services/potentialRadar/analysis';
import { formatPotentialMessage, selectPotentialNotice } from '../app/services/potentialRadar/notifications';
import type { RadarSnapshot } from '../app/services/potentialRadar/types';
import { healthyDepth, healthyDerivatives, potentialFixture } from './helpers/potentialFixture';

const cutoff = Date.UTC(2026, 8, 14, 12);
const confirmedTrend = {
  version: '4h-ma20-daily-ma7-v1' as const, fourHourMa20: 100, fourHourMa20Rising: true,
  fourHourPullback: 'CONFIRMED' as const, dailyMa7: 100, dailyTrend: true, confirmed: true,
};
function snapshot(symbol: string, close?: number): RadarSnapshot {
  /** 預設使用放量突破樣本；指定 close 時改用 MACD 金叉樣本驗證吃大魚通知。 */
  const candles = potentialFixture(cutoff, close == null);
  if (close != null) candles.at(-1)!.close = close;
  const signal = analyzePotential(candles, potentialFixture(cutoff, false), healthyDepth);
  signal.source = 'BYBIT_SPOT';
  return { symbol, checkedAt: cutoff + 120_000, signal, error: null };
}

test('首次候選通知一次；持續候選不洗版，過熱與流動性失格不通知', () => {
  const base = snapshot('BREAKUSDT');
  /** 突破分類本身可通知；此樣本移除同根吃大魚，隔離兩種事件的優先順序。 */
  const first = { ...base, signal: { ...base.signal!, bigFish: null, trendConfirmation: confirmedTrend } };
  assert.equal(first.signal!.phase, 'BREAKOUT');
  assert.deepEqual(selectPotentialNotice(first, null), { key: 'CANDIDATE' });
  assert.equal(selectPotentialNotice(first, first), null);
  assert.equal(selectPotentialNotice({ ...first, signal: { ...first.signal!, phase: 'EXTENDED' } }, null), null);
  assert.equal(selectPotentialNotice({ ...first, signal: { ...first.signal!, phase: 'EXCLUDED' } }, null), null);
  assert.equal(selectPotentialNotice({ ...first, signal: { ...first.signal!, trendConfirmation: { ...confirmedTrend, confirmed: false } } }, null), null);
});

test('吃大魚新觸發在既有候選中仍通知，內容包含來源與風控參考', () => {
  const base = snapshot('FISHUSDT', 100.1);
  const fish = { ...base, signal: { ...base.signal!, trendConfirmation: confirmedTrend } };
  fish.signal!.derivatives = healthyDerivatives;
  assert.equal(fish.signal!.phase, 'WAIT');
  assert.equal(fish.signal!.bigFish!.entry, true);
  const previous = { ...fish, signal: { ...fish.signal!, phase: 'WATCH', bigFish: { ...fish.signal!.bigFish!, entry: false } } };
  assert.deepEqual(selectPotentialNotice(fish, previous), { key: 'BIG_FISH' });
  const message = formatPotentialMessage(fish);
  assert.match(message, /FISHUSDT｜吃大魚進場/);
  assert.match(message, /Bybit 現貨/);
  assert.match(message, /失效參考/);
  assert.match(message, /健康趨勢/);
  assert.match(message, /非下單指令/);
});
