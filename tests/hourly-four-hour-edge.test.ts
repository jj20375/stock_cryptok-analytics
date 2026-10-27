/** @file 1h→4h 方向研究特徵、江恩工具、玄學假設與策略模組的單元測試；只用合成行情，不連網、不下單、不推播。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle, StrategyContext } from '../app/services/strategy/types';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import { FEATURE_IDS, FEATURE_WARMUP_BARS, featureDirection, higherTimeframeTrend, HOUR_MS } from '../app/services/strategy/hourlyEdgeFeatures';
import { gannAngleState, gannTimeReversal, squareOfNineCross, squareOfNineLevel, squareOfNineScalePower } from '../app/services/strategy/gannTools';
import { luckyNumberHourSignal, mercuryRetrogradeSignal, moonAgeDays, moonPhaseSignal } from '../app/services/strategy/esotericCalendar';
import hourlyFourHourEdge from '../app/services/strategy/strategies/hourlyFourHourEdge';
import { getStrategy } from '../app/services/strategy/registry';
import { runBacktestEngine } from '../app/services/backtest/engine';
import { dayBlockBootstrap, benjaminiHochberg, wilsonInterval } from '../scripts/crypto-hourly-edge/stats';

const START = Date.UTC(2025, 0, 1);

/** 帶趨勢與週期波動的合成 1h 行情；seed 固定，數值與策略門檻無關。 */
function syntheticCandles(count: number, drift = 0.0004): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  let state = 12345;
  const random = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < count; i++) {
    const change = drift + Math.sin(i / 37) * 0.004 + (random() - 0.5) * 0.012;
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + random() * 0.004);
    const low = Math.min(open, close) * (1 - random() * 0.004);
    candles.push({ openTime: START + i * HOUR_MS, open, high, low, close, volume: 1000 + random() * 4000 + (i % 97 === 0 ? 20000 : 0) });
    price = close;
  }
  return candles;
}

test('每個特徵只讀 index 以前的資料：截斷未來 K 線後結果完全相同', () => {
  const full = syntheticCandles(1200);
  const fullCache = new IndicatorCache(full);
  for (const index of [FEATURE_WARMUP_BARS, 750, 900, 1100]) {
    const truncated = full.slice(0, index + 1);
    const truncatedCache = new IndicatorCache(truncated);
    for (const id of FEATURE_IDS) {
      assert.equal(featureDirection(id, full, fullCache, index), featureDirection(id, truncated, truncatedCache, index), `${id}@${index}`);
    }
  }
});

test('暖機不足時所有特徵回傳 0', () => {
  const candles = syntheticCandles(FEATURE_WARMUP_BARS);
  const cache = new IndicatorCache(candles);
  for (const id of FEATURE_IDS) assert.equal(featureDirection(id, candles, cache, FEATURE_WARMUP_BARS - 1), 0);
});

test('4h 趨勢只在 4 根 1h 收完後更新，形成中的 4h K 不影響', () => {
  const candles = syntheticCandles(400, 0.002);
  const trend = higherTimeframeTrend(candles);
  for (let i = 1; i < candles.length; i++) {
    const closesBucket = (candles[i].openTime + HOUR_MS) % (4 * HOUR_MS) === 0;
    if (!closesBucket) assert.equal(trend[i], trend[i - 1], `第 ${i} 根不是 4h 收盤，不應改變狀態`);
  }
  assert.equal(trend.at(-1), 1, '持續上漲的序列最終應為 4h 多頭');
});

test('九方圖：45° 一格等於平方根 +0.25，價格縮放到 [100,10000)', () => {
  assert.equal(squareOfNineScalePower(0.00123), 5);
  assert.equal(squareOfNineScalePower(65000), -2);
  assert.equal(squareOfNineLevel(100, 0), 40);
  /** 第 41 格起點 = (41 × 0.25)² = 105.0625。 */
  assert.equal(squareOfNineLevel(105.06, 0), 40);
  assert.equal(squareOfNineLevel(105.07, 0), 41);
  const candles: Candle[] = [100.5, 105.2].map((close, i) => ({ openTime: START + i * HOUR_MS, open: close, high: close, low: close, close, volume: 1 }));
  assert.equal(squareOfNineCross(candles, 1), 1);
  assert.equal(squareOfNineCross([...candles].reverse().map((c, i) => ({ ...c, openTime: START + i * HOUR_MS })), 1), -1);
});

test('江恩角度線與時間平方', () => {
  const bar = (i: number, high: number, low: number, close: number): Candle => ({ openTime: START + i * HOUR_MS, open: close, high, low, close, volume: 1 });
  const atr = Array.from({ length: 80 }, () => 2);
  /** 上漲到第 74 根後橫盤 5 根：收盤仍高於「自高點下降 5×0.25」的 1x1 線，也高於自低點上升的線 → 多方控盤。 */
  const rising = Array.from({ length: 80 }, (_, i) => (i <= 74 ? bar(i, 101 + i, 99 + i, 100.5 + i) : bar(i, 174.9, 173, 174.5)));
  assert.equal(gannAngleState(rising, atr, 79, 72, 0.125), 1);
  /** 鏡像：下跌到第 74 根後橫盤，收盤低於自低點上升的線 → 空方控盤。 */
  const falling = Array.from({ length: 80 }, (_, i) => (i <= 74 ? bar(i, 201 - i, 199 - i, 199.5 - i) : bar(i, 127, 125.1, 125.5)));
  assert.equal(gannAngleState(falling, atr, 79, 72, 0.125), -1);
  /** 第 0 根最低、第 4 根最高，之後橫盤：第 20 根距高點剛好 16 根（4²）→ 押注反轉向上；第 19 根不是平方數 → 0。 */
  const cycle = Array.from({ length: 21 }, (_, i) => (i === 0 ? bar(i, 101, 90, 100) : i === 4 ? bar(i, 120, 100, 110) : bar(i, 105, 95, 100)));
  assert.equal(gannTimeReversal(cycle, 20, 72), 1);
  assert.equal(gannTimeReversal(cycle, 19, 72), 0);
});

test('玄學假設：已知滿月／新月日期與台北時辰', () => {
  /** 2025-01-13 22:27 UTC 滿月、2025-01-29 12:36 UTC 新月（公開天文曆）。 */
  assert.ok(Math.abs(moonAgeDays(Date.UTC(2025, 0, 13, 22, 27)) - 14.77) < 1);
  assert.equal(moonPhaseSignal(Date.UTC(2025, 0, 13, 22)), -1);
  assert.equal(moonPhaseSignal(Date.UTC(2025, 0, 29, 12)), 1);
  assert.equal(moonPhaseSignal(Date.UTC(2025, 0, 21, 12)), 0);
  assert.equal(mercuryRetrogradeSignal(Date.UTC(2025, 2, 20)), -1);
  assert.equal(mercuryRetrogradeSignal(Date.UTC(2025, 5, 1)), 0);
  assert.equal(luckyNumberHourSignal(Date.UTC(2025, 0, 1, 0)), 1, 'UTC 0 點 = 台北 8 點');
  assert.equal(luckyNumberHourSignal(Date.UTC(2025, 0, 1, 6)), -1, 'UTC 6 點 = 台北 14 點');
});

test('統計工具：Wilson、BH 與依日 bootstrap 的基本性質', () => {
  const [low, high] = wilsonInterval(55, 100);
  assert.ok(low < 0.55 && high > 0.55 && low > 0.44 && high < 0.65);
  assert.deepEqual(benjaminiHochberg([0.001, 0.2, 0.03, 0.04], 0.05), [true, false, false, false]);
  const days = Array.from({ length: 200 }, (_, i) => ({ n: 10, longN: 10, hits: i % 10 < 6 ? 6 : 5, sumNet: 0.01, allN: 100, allUp: 50, allDown: 50 }));
  const boot = dayBlockBootstrap(days, 300);
  assert.ok(boot.edgeCi[0] > 0, '每日都贏基準時超額區間應在 0 之上');
  assert.ok(boot.pEdge < 0.05);
});

test('策略模組已註冊、僅限回測且不支援現貨以外的實盤副作用', () => {
  assert.equal(getStrategy('hourly_four_hour_edge'), hourlyFourHourEdge);
  assert.equal(hourlyFourHourEdge.backtestOnly, true);
  assert.deepEqual(hourlyFourHourEdge.supportedIntervals, ['1h']);
  assert.equal(hourlyFourHourEdge.warmupBars >= FEATURE_WARMUP_BARS, true);
});

test('策略持倉滿 holdBars 後出場；成交量不足時不進場', () => {
  const candles = syntheticCandles(900, 0.001);
  const cache = new IndicatorCache(candles);
  const params = { ...hourlyFourHourEdge.defaultParams };
  const position = { side: 'LONG' as const, entryPrice: 100, quantity: 1, stopLossPrice: 90, entryTime: candles[700].openTime, entryIndex: 700 };
  const ctx = (index: number, overrides: Partial<StrategyContext> = {}): StrategyContext => ({ candles, index, indicators: cache, position, params, ...overrides });
  assert.equal(hourlyFourHourEdge.evaluate(ctx(700 + params.holdBars - 2)).type, 'HOLD');
  assert.equal(hourlyFourHourEdge.evaluate(ctx(700 + params.holdBars - 1)).type, 'EXIT');
  const action = hourlyFourHourEdge.evaluate(ctx(800, { position: null, params: { ...params, minQuoteTurnoverUsdt: 1e15 } }));
  assert.equal(action.type, 'HOLD');
});

test('回測引擎整合：nextOpen 成交，持倉根數不超過 holdBars', () => {
  const candles = syntheticCandles(3000, 0.0006);
  const params = { ...hourlyFourHourEdge.defaultParams, minQuoteTurnoverUsdt: 0, entryScore: 0.1 };
  const result = runBacktestEngine(candles, hourlyFourHourEdge, params, { initialCapital: 10_000, cost: { feeRate: 0.0005, slippageBps: 5 },
    fillMode: 'nextOpen', maxRiskPerTradePct: 1, maxPositionSizePct: 50, defaultStopLossPct: 5, precision: 6 }, candles[FEATURE_WARMUP_BARS].openTime);
  for (const trade of result.trades) assert.ok(trade.holdingBars <= params.holdBars, `持倉 ${trade.holdingBars} 根`);
});
