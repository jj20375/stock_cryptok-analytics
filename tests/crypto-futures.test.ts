/** @file 合約策略、資金模型與下單方向的最小檢查；全程合成行情／攔截 fetch，不送真實或 Demo 委託。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runBacktestEngine } from '../app/services/backtest/engine';
import { futuresEntryRisk, futuresLeverageForStop, knownFundingBudget, liquidationEstimate } from '../app/services/backtest/futures';
import { futuresRegime, futuresEntryIndex, HOUR_MS } from '../app/services/strategy/futuresRegime';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import trend from '../app/services/strategy/strategies/futuresTrendRetest';
import range from '../app/services/strategy/strategies/futuresRangeReclaim';
import type { Candle, StrategyModule } from '../app/services/strategy/types';
import { futuresSignalIsEntry, futuresSignalSide, futuresAuditIsEntry } from '../app/services/cryptoAutoTrading/types';
import { placeBitgetFuturesLong, closeBitgetFuturesLong } from '../app/services/bitgetService';
import { bitgetPublic } from '../app/services/cryptoFutures/market.server';

const cost = { feeRate: 0.0006, slippageBps: 5 };
const tiers = [{ min: 0, max: 1e9, rate: 0.004, maxLeverage: 50 }];
const candle = (i: number, price: number): Candle => ({ openTime: i * HOUR_MS, open: price, close: price, high: price + 1, low: price - 1, volume: 1000 });

test('Bitget 憑證錯誤明確回報且不改用其他行情來源', async () => {
  const previous = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('certificate verification failed'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });
  };
  try {
    await assert.rejects(bitgetPublic('market/contracts', { symbol: 'BTCUSDT', productType: 'USDT-FUTURES' }), /憑證驗證失敗/);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]).hostname, 'api.bitget.com');
  } finally { globalThis.fetch = previous; }
});

test('風險包含成本、槓桿不增加名目部位、結構跳空與費率前視皆被擋', () => {
  const plan = { stopDistance: 2, stopPrice: 98, minStopDistance: 2, maxStopDistance: 4, targetMultiple: 2, minRewardRisk: 1.5, minPrice: 99, maxPrice: 101 };
  const a = futuresEntryRisk('LONG', 100, plan, cost, 1000, 0.25, 5, 6, 3);
  const b = futuresEntryRisk('LONG', 100, plan, cost, 1000, 0.25, 5, 6, 20);
  assert.ok('quantity' in a && 'quantity' in b);
  assert.equal(a.quantity, b.quantity); assert.ok(a.riskUsdt <= 2.5); assert.ok(a.quantity * 100 <= 50);
  assert.ok('error' in futuresEntryRisk('LONG', 102, plan, cost, 1000, 0.25, 5, 6, 3));
  assert.ok('error' in futuresEntryRisk('LONG', 100, plan, { feeRate: 0.02, slippageBps: 50 }, 1000, 0.25, 5, 6, 3));
  assert.equal(knownFundingBudget([{ time: 0, rate: 0.001 }, { time: HOUR_MS, rate: 0.5 }], 0, 'LONG', 1), 0.001);
  assert.ok(liquidationEstimate('LONG', 100, 1, 10, 0, 0.0006, tiers)! < 98);
  assert.ok(liquidationEstimate('SHORT', 100, 1, 10, 0, 0.0006, tiers)! > 102);
});

test('槓桿上限內依停損選倍數，保留緩衝且不改數量；最低倍數不符時拒絕', () => {
  for (const side of ['LONG', 'SHORT'] as const) {
    const stop = side === 'LONG' ? 95 : 105;
    const chosen = futuresLeverageForStop(side, 100, 1, stop, cost.feeRate, tiers, 50);
    assert.ok(!('error' in chosen));
    assert.ok(chosen.leverage < 50 && chosen.leverage >= 1);
    assert.equal(chosen.margin, 100 / chosen.leverage);
    const distance = side === 'LONG' ? stop - chosen.liquidationPrice! : chosen.liquidationPrice! - stop;
    assert.ok(distance >= 2.5);
    assert.equal((futuresLeverageForStop(side, 100, 1, stop, cost.feeRate, tiers, 3) as { leverage: number }).leverage, 3);
    assert.ok('error' in futuresLeverageForStop(side, 100, 1, stop, cost.feeRate, tiers, 3, 4));
  }
});

test('4H 只用已收盤資料，趨勢回踩同時支援多空，衝擊與缺口禁止新倉', () => {
  const bars = Array.from({ length: 850 }, (_, i) => candle(i, 100 + i * 0.1));
  assert.equal(futuresEntryIndex(bars, bars.at(-1)!.openTime + 5 * 60_000), bars.length - 1);
  const retest = [[182.9, 185.2, 182.8, 185], [185, 185.1, 183.8, 184.4], [184.4, 184.6, 183.9, 184.2], [184.2, 185.2, 184, 185]];
  retest.forEach(([open, high, low, close], j) => { bars[830 + j] = { ...bars[830 + j], open, high, low, close }; });
  const ctx = { candles: bars, index: 833, indicators: new IndicatorCache(bars), position: null, params: trend.defaultParams };
  assert.equal(futuresRegime(ctx).phase, 'UP');
  assert.equal(trend.evaluate(ctx).type, 'ENTRY');
  /** 回踩已發生於前根；確認根不必再次碰線，且先前收盤回落不代表確認根失效。 */
  const delayed = bars.map(c => ({ ...c }));
  delayed[831] = { ...delayed[831], low: 183.5, close: 183.8 };
  delayed[833] = { ...delayed[833], open: 184.9, low: 184.8 };
  assert.equal(trend.evaluate({ ...ctx, candles: delayed, indicators: new IndicatorCache(delayed) }).type, 'ENTRY');
  const prefix = bars.slice(0, 834), before = trend.evaluate({ ...ctx, candles: prefix, indicators: new IndicatorCache(prefix) });
  const changed = bars.map((c, i) => i > 833 ? { ...c, close: 100000, high: 100001 } : c);
  assert.deepEqual(trend.evaluate({ ...ctx, candles: changed, indicators: new IndicatorCache(changed) }), before);
  const reverse = bars.map(c => ({ ...c, open: 400 - c.open, close: 400 - c.close, high: 400 - c.low, low: 400 - c.high }));
  const short = trend.evaluate({ ...ctx, candles: reverse, indicators: new IndicatorCache(reverse) });
  assert.ok(short.type === 'ENTRY' && short.side === 'SHORT');
  const shock = bars.map((c, i) => i === 833 ? { ...c, low: c.low - 30 } : c);
  assert.equal(futuresRegime({ ...ctx, candles: shock, indicators: new IndicatorCache(shock) }).phase, 'SHOCK');
  const gap = bars.filter((_, i) => i !== 832);
  assert.equal(futuresRegime({ ...ctx, candles: gap, index: 832, indicators: new IndicatorCache(gap) }).phase, 'WAIT');
});

test('區間假突破需下一根確認，固定目標與時間出場不被進場條件阻擋', () => {
  const bars = Array.from({ length: 850 }, (_, i) => candle(i, 100 + Math.sin(i * Math.PI / 8) * 4));
  bars[848] = { ...bars[848], open: 95.5, low: 94.8, high: 95.8, close: 95.7 };
  bars[849] = { ...bars[849], open: 95.7, low: 95.6, high: 96.4, close: 96.2 };
  const ctx = { candles: bars, index: 849, indicators: new IndicatorCache(bars), position: null, params: range.defaultParams };
  assert.equal(futuresRegime(ctx).phase, 'RANGE');
  const action = range.evaluate(ctx); assert.equal(action.type, 'ENTRY');
  /** 下一根極值突破且收盤同向推進即可；不再額外要求收盤跨過整根上影線。 */
  const confirmed = bars.map(c => ({ ...c })); confirmed[849].close = 95.75;
  assert.equal(range.evaluate({ ...ctx, candles: confirmed, indicators: new IndicatorCache(confirmed) }).type, 'ENTRY');
  if (action.type !== 'ENTRY') return;
  assert.ok(action.entryPlan!.targetPrice! > bars[849].close);
  const exit = range.evaluate({ ...ctx, position: { side: 'LONG', entryTime: 0, entryPrice: 96.2, quantity: 1, stopLossPrice: 94, entryIndex: 840, entryPlan: action.entryPlan } });
  assert.equal(exit.type, 'EXIT');
});

test('多空永續資金費率、資金曲線、保證金與停損優先一致', () => {
  for (const side of ['LONG', 'SHORT'] as const) {
    const bars = Array.from({ length: 5 }, (_, i) => candle(i, 100));
    const strategy: StrategyModule = { ...trend, futuresOnly: true, warmupBars: 0, evaluate: ctx => ctx.index === 0 ? { type: 'ENTRY', side, stopLossPct: 5, reason: '合成訊號' } : { type: 'HOLD' } };
    const config = { initialCapital: 1000, cost: { feeRate: 0, slippageBps: 0 }, fillMode: 'nextOpen' as const, maxRiskPerTradePct: 0.25, maxPositionSizePct: 5, defaultStopLossPct: 5, precision: 6,
      futures: { leverage: 3, funding: [{ time: 2 * HOUR_MS, rate: 0.001 }], marks: bars, tiers, tiersObservedAt: 0, fundingComplete: true } };
    const result = runBacktestEngine(bars, strategy, strategy.defaultParams, config, 0);
    assert.equal(result.trades.length, 1);
    assert.equal(result.entryDiagnostics?.signals, 1); assert.equal(result.entryDiagnostics?.filled, 1);
    assert.equal(result.entryDiagnostics?.cancelled, 0);
    assert.equal(result.trades[0].fundingPnl! > 0, side === 'SHORT');
    assert.ok(Math.abs(result.equityCurve.at(-1)!.equity - 1000 - result.trades[0].pnl) < 1e-8);
    assert.ok(result.trades[0].initialMargin! > 0);
    assert.throws(() => runBacktestEngine(bars, strategy, strategy.defaultParams, { ...config, futures: undefined }, 0));
  }
});

test('新開空與平空不混淆；攔截 UTA／Classic 委託確認方向，沒有外部送單', async () => {
  assert.equal(futuresSignalIsEntry({ action: 'SELL', intent: 'OPEN_SHORT' }), true);
  assert.equal(futuresSignalIsEntry({ action: 'BUY', intent: 'CLOSE_SHORT' }), false);
  assert.equal(futuresSignalSide({ action: 'BUY', intent: 'CLOSE_SHORT' }), 'short');
  assert.equal(futuresAuditIsEntry('OPEN_SHORT'), true);
  const previous = globalThis.fetch, calls: Array<{ path: string; body: any; headers: Headers }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: url, body, headers: new Headers(init?.headers) });
    return Response.json({ code: '00000', data: url.includes('account/settings') ? { holdMode: 'one_way_mode' } : { orderId: 'fake-order' } });
  };
  try {
    for (const apiDialect of ['UTA_V3', 'CLASSIC_V2'] as const) {
      await placeBitgetFuturesLong({ environment: 'DEMO', symbol: 'BTCUSDT', quantity: 0.001, quantityPrecision: 6, stopLossPrice: 102,
        pricePrecision: 2, positionMode: 'hedge_mode', apiDialect, clientOid: 'test-only', apiKey: 'fake-key', apiSecret: 'fake-secret', passphrase: 'fake-pass', positionSide: 'short' });
      assert.equal(calls.at(-1)!.body.side, 'sell'); assert.equal(calls.at(-1)!.headers.get('paptrading'), '1');
    }
    await closeBitgetFuturesLong('DEMO', 'BTCUSDT', '0.001', 'fake-key', 'fake-secret', 'fake-pass', 'test-close', 'short');
    assert.equal(calls.at(-1)!.body.side, 'buy'); assert.equal(calls.at(-1)!.body.reduceOnly, 'yes');
  } finally { globalThis.fetch = previous; }
});
