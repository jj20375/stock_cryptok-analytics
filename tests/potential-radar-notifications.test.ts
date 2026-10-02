/** @file 驗證候選通知只在新事件建立，並保留吃大魚與風控內容。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzePotential } from '../app/services/potentialRadar/analysis';
import { analyzeBigFish } from '../app/services/potentialRadar/bigFish';
import { formatPotentialMessage, selectPotentialNotice } from '../app/services/potentialRadar/notifications';
import { FOUR_HOUR_MS, RADAR_RULES, type RadarSnapshot } from '../app/services/potentialRadar/types';
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
  const signal = analyzePotential(candles, potentialFixture(cutoff, false), healthyDepth,
    close != null ? analyzeBigFish(candles) : null);
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
  const previous = { ...fish, signal: { ...fish.signal!, phase: 'WATCH' as const, bigFish: { ...fish.signal!.bigFish!, entry: false } } };
  assert.deepEqual(selectPotentialNotice(fish, previous), { key: 'BIG_FISH' });
  const message = formatPotentialMessage(fish);
  assert.match(message, /FISHUSDT｜吃大魚進場/);
  assert.match(message, /Bybit 現貨/);
  assert.match(message, /失效參考/);
  assert.match(message, /健康趨勢/);
  assert.match(message, /非下單指令/);
});

test('4 小時吃大魚整根內只通知一次，且收盤後超過一小時才算到的標的不推播舊進場', () => {
  const base = snapshot('FOURHUSDT', 100.1);
  const barTime = Date.UTC(2026, 8, 14, 8);
  const fish4h = { ...base.signal!.bigFish!, timeframe: '4h' as const, barTime };
  const closeAt = barTime + FOUR_HOUR_MS;
  const at = (checkedAt: number): RadarSnapshot => ({ ...base, checkedAt,
    signal: { ...base.signal!, trendConfirmation: confirmedTrend, bigFish: fish4h } });

  /** 收盤後幾分鐘第一次算到：通知。 */
  const first = at(closeAt + 5 * 60_000);
  assert.deepEqual(selectPotentialNotice(first, null), { key: 'BIG_FISH' });
  /** 15 分鐘後沿用同一根 4 小時結果：不得重複通知。 */
  assert.notDeepEqual(selectPotentialNotice(at(closeAt + 20 * 60_000), first), { key: 'BIG_FISH' });
  /** 輪替到很晚才第一次算到：已超過通知時窗，不推播舊進場價。 */
  assert.notDeepEqual(selectPotentialNotice(at(closeAt + RADAR_RULES.bigFishNoticeWindowMs + 60_000), null), { key: 'BIG_FISH' });
  /** 下一根 4 小時又出現進場：視為新事件。 */
  const nextBar = { ...first, checkedAt: closeAt + FOUR_HOUR_MS + 5 * 60_000,
    signal: { ...first.signal!, bigFish: { ...fish4h, barTime: barTime + FOUR_HOUR_MS } } };
  assert.deepEqual(selectPotentialNotice(nextBar, first), { key: 'BIG_FISH' });
  /** 卡片顯示 4 小時收盤時間，而非 15 分掃描根。 */
  assert.match(formatPotentialMessage(first), /4 小時收盤/);
});
