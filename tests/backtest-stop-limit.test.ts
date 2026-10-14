/** @file 幣價100%停損與75倍研究上限的邊界、出場及合約攔截；純合成行情，不發送交易。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bigFish from '../app/services/strategy/strategies/bigFishTrend';
import { strategyParamError } from '../app/services/strategy/parameters';
import { resolveEntryRisk } from '../app/services/backtest/entryExecution';
import { futuresLeverageForStop, futuresEntryRisk } from '../app/services/backtest/futures';
import { runBacktestEngine } from '../app/services/backtest/engine';
import type { Candle, StrategyModule } from '../app/services/strategy/types';

test('固定百分比可到100，結構停損及超界值仍拒絕', () => {
  const cost = { feeRate: 0, slippageBps: 0 };
  assert.equal(strategyParamError(bigFish, { stopLossPct: 100 }), null);
  assert.ok(strategyParamError(bigFish, { stopLossPct: 100.5 }));
  for (const price of [100, 0.253676]) assert.deepEqual(resolveEntryRisk('LONG', price, 100, undefined, cost), { stopLossPct: 100, stopLossPrice: 0 });
  assert.deepEqual(resolveEntryRisk('SHORT', 100, 100, undefined, cost), { stopLossPct: 100, stopLossPrice: 200 });
  for (const pct of [0, -1, 100.5, NaN, Infinity]) assert.ok('error' in resolveEntryRisk('LONG', 100, pct, undefined, cost));
  assert.ok('error' in resolveEntryRisk('LONG', 100, 5, { stopDistance: 100 }, cost));
  const risk = futuresLeverageForStop('LONG', 100, 1, 0, 0.0006, [{ min: 0, max: 10000, rate: 0.01, maxLeverage: 50 }], 3);
  assert.ok('error' in risk);
  if ('error' in risk) assert.match(risk.error, /強平安全距離/);
});

test('100%多單停損價為0，99%跌幅不提前停損，但策略仍能出場', () => {
  const candles: Candle[] = [100, 100, 1, 1].map((price, i) => ({ openTime: i * 3600000,
    open: price, high: price, low: price, close: price, volume: 1000 }));
  const strategy: StrategyModule = { ...bigFish, warmupBars: 0, evaluate: ctx => ctx.index === 0
    ? { type: 'ENTRY', side: 'LONG', stopLossPct: 100, reason: '合成進場' }
    : ctx.index === 2 && ctx.position ? { type: 'EXIT', reason: '策略出場' } : { type: 'HOLD' } };
  const result = runBacktestEngine(candles, strategy, { stopLossPct: 100 }, { initialCapital: 10000,
    maxRiskPerTradePct: 1, maxPositionSizePct: 100, defaultStopLossPct: 5, precision: 6,
    cost: { feeRate: 0, slippageBps: 0 }, fillMode: 'nextOpen', captureEvents: true }, 0);
  assert.equal(result.events.find(e => e.type === 'ENTRY')?.stopLossPrice, 0);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitReason, '策略出場');
  assert.equal(result.trades[0].exitTime, candles[3].openTime);
  assert.equal(result.trades[0].pnl, -99);
});

test('75倍上限有效，但仍受商品級距限制且不放大名目倉位', () => {
  const cost = { feeRate: 0.0006, slippageBps: 5 };
  const tiers = [{ min: 0, max: 10000, rate: 0.005, maxLeverage: 75 }];
  const chosen = futuresLeverageForStop('LONG', 100, 1, 99.75, cost.feeRate, tiers, 75);
  assert.ok('leverage' in chosen); if ('leverage' in chosen) assert.equal(chosen.leverage, 75);
  const limited = futuresLeverageForStop('LONG', 100, 1, 99.75, cost.feeRate, [{ ...tiers[0], maxLeverage: 50 }], 75);
  assert.ok('leverage' in limited); if ('leverage' in limited) assert.equal(limited.leverage, 50);
  for (const cap of [0, 76, 75.5]) assert.ok('error' in futuresLeverageForStop('LONG', 100, 1, 99.75, cost.feeRate, tiers, cap));
  const low = futuresEntryRisk('LONG', 100, undefined, cost, 10000, 0.25, 5, 6, 3);
  const high = futuresEntryRisk('LONG', 100, undefined, cost, 10000, 0.25, 5, 6, 75);
  assert.ok('quantity' in low && 'quantity' in high);
  if ('quantity' in low && 'quantity' in high) assert.equal(low.quantity, high.quantity);
  assert.ok('error' in futuresEntryRisk('LONG', 100, undefined, cost, 10000, 0.25, 5, 6, 76));
});
