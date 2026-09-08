import assert from 'node:assert/strict';
import { test } from 'node:test';
import cryptoWave, { analyzeWave, WAVE_INTERVAL_MS, WAVE_PARAMS } from '../app/services/strategy/strategies/cryptoWave';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import type { Candle, StrategyContext } from '../app/services/strategy/types';
import { nextWaveSnapshot, validateWaveCandles } from '../app/services/waveRadar/state';
import { runBacktestEngine } from '../app/services/backtest/engine';
import { WAVE_SYMBOLS } from '../app/services/cryptoUniverse';

import { waveFixture } from './helpers/waveFixture';

const context = (candles: Candle[], index = candles.length - 1): StrategyContext => ({
  candles, index, indicators: new IndicatorCache(candles), position: null, params: { ...WAVE_PARAMS },
});

test('指定幣種包含 ASTER、HYPE、XRP，沒有誤用 HYPER 或 ASTR', () => {
  const symbols = WAVE_SYMBOLS.map(c => c.symbol);
  for (const symbol of ['SUIUSDT', 'ASTERUSDT', 'ADAUSDT', 'DOGEUSDT', 'BNBUSDT', 'HYPEUSDT', 'XRPUSDT']) assert.ok(symbols.includes(symbol));
  assert.equal(new Set(symbols).size, symbols.length);
  assert.ok(!symbols.includes('HYPERUSDT') && !symbols.includes('ASTRUSDT'));
});

test('放量突破才進場，弱量、追價過遠與停損過寬均不進場', () => {
  const candles = waveFixture();
  assert.equal(analyzeWave(context(candles)).phase, 'BREAKOUT');
  candles[359].volume = 100000;
  assert.equal(cryptoWave.evaluate(context(candles)).type, 'HOLD');
  candles[359].volume = 250000;
  candles[359].close += 8;
  candles[359].high = candles[359].close + 1;
  assert.equal(analyzeWave(context(candles)).phase, 'EXTENDED');
  const ctx = context(waveFixture());
  ctx.params.maxStopPct = 2;
  assert.equal(cryptoWave.evaluate(ctx).type, 'HOLD');
});

test('低流動性及非整數回看參數不能產生進場', () => {
  const candles = waveFixture().map(c => ({ ...c, volume: c.volume / 100000 }));
  assert.equal(cryptoWave.evaluate(context(candles)).type, 'HOLD');
  const ctx = context(waveFixture());
  ctx.params.breakoutBars = 20.5;
  assert.equal(cryptoWave.evaluate(ctx).type, 'HOLD');
});

test('回測守住突破位且再過前根高點才產生續強，持有後低量也能出場', () => {
  const candles = waveFixture();
  const first = analyzeWave(context(candles));
  const prev = candles.at(-1)!;
  const retest = { ...prev, openTime: prev.openTime + WAVE_INTERVAL_MS,
    low: first.breakout!, close: prev.high + 0.1, high: prev.high + 0.3, volume: 100000 };
  assert.equal(analyzeWave(context([...candles, retest])).phase, 'RETEST');
  const failed = { ...retest, low: 90, close: 91, volume: 1 };
  const ctx = context([...candles, failed]);
  ctx.position = { side: 'LONG', entryPrice: prev.close, entryTime: prev.openTime, stopLossPrice: 95, quantity: 1 };
  assert.equal(cryptoWave.evaluate(ctx).type, 'EXIT');
});

test('未收盤、過期、缺口與 NaN 資料拒絕，歷史回測允許舊資料', () => {
  const candles = waveFixture();
  const closeTime = candles.at(-1)!.openTime + WAVE_INTERVAL_MS;
  assert.doesNotThrow(() => validateWaveCandles(candles, closeTime));
  assert.throws(() => validateWaveCandles(candles, closeTime - 1));
  assert.throws(() => validateWaveCandles(candles, closeTime + WAVE_INTERVAL_MS));
  assert.doesNotThrow(() => validateWaveCandles(candles, closeTime + 100 * WAVE_INTERVAL_MS, false));
  assert.throws(() => validateWaveCandles(candles.filter((_, i) => i !== 100), closeTime));
  candles[50].volume = NaN;
  assert.throws(() => validateWaveCandles(candles, closeTime));
});

test('加入或改動未來 K 線不改變當時訊號與未完成日線判斷', () => {
  const candles = waveFixture();
  const expected = analyzeWave(context(candles));
  const future = [...candles, { ...candles.at(-1)!, openTime: candles.at(-1)!.openTime + WAVE_INTERVAL_MS, close: 10000, high: 20000 }];
  assert.deepEqual(analyzeWave(context(future, 359)), expected);
  const beforeDailyClose = analyzeWave(context(candles, 358));
  candles[359].close = 100000;
  assert.deepEqual(analyzeWave(context(candles, 358)), beforeDailyClose);
});

test('補看停機期間已觸及停損，即使最後價格恢復也撤銷訊號', () => {
  const candles = waveFixture();
  const initial = nextWaveSnapshot(candles, null);
  assert.ok(initial.tracking);
  const next = { ...candles.at(-1)!, openTime: candles.at(-1)!.openTime + WAVE_INTERVAL_MS, low: initial.tracking!.stopPrice - 1 };
  const recovered = { ...next, openTime: next.openTime + WAVE_INTERVAL_MS, low: candles.at(-1)!.low };
  const result = nextWaveSnapshot([...candles, next, recovered], initial);
  assert.equal(result.signal.phase, 'EXIT');
  assert.equal(result.tracking, null);
});

test('回測在下一根成交、扣雙邊成本且單幣部位不超過 25%', () => {
  const candles = waveFixture();
  const next = { ...candles.at(-1)!, openTime: candles.at(-1)!.openTime + WAVE_INTERVAL_MS, open: 119, close: 120, high: 121, low: 118 };
  const result = runBacktestEngine([...candles, next], cryptoWave, WAVE_PARAMS, {
    initialCapital: 10000, cost: { feeRate: 0.001, slippageBps: 5 }, fillMode: 'nextOpen',
    maxRiskPerTradePct: 1, maxPositionSizePct: 25, defaultStopLossPct: 5, precision: 5,
  }, candles.at(-1)!.openTime);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, next.openTime);
  assert.ok(result.trades[0].fee > 0);
  assert.ok(result.trades[0].entryPrice * result.trades[0].quantity <= 2500.01);
});
