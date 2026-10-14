/** @file 新策略的數值、防前視、成交風險與圖表整合檢查；只用合成已收盤行情，不發送交易或通知。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAdx, calculateBollinger, calculateWidthThreshold } from '../app/services/strategy/advancedIndicators';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import squeeze from '../app/services/strategy/strategies/volatilitySqueezeBreakout';
import range from '../app/services/strategy/strategies/rangeMeanReversion';
import type { Candle, StrategyContext, StrategyModule, OpenPositionState } from '../app/services/strategy/types';
import { runBacktestEngine, type EngineConfig } from '../app/services/backtest/engine';
import { resolveEntryRisk } from '../app/services/backtest/entryExecution';
import { calculateFee } from '../app/services/backtest/costs';
import { buildStrategyLayers } from '../app/features/home/strategy-overlays';
import { confirmedStrategyCandles } from '../app/features/home/strategy-candles';
import { getSignalAction, groupChartSignals } from '../app/features/home/signal-display';
import { strategyParamError } from '../app/services/strategy/parameters';
import { listStrategies } from '../app/services/strategy/registry';
import type { StockDataPoint } from '../app/types';

const DAY = 86_400_000;
const bar = (i: number, close: number, volume = 1000): Candle => ({ openTime: Date.UTC(2024, 0, 1) + i * DAY,
  open: close, high: close + 0.1, low: close - 0.1, close, volume });
const config: EngineConfig = { initialCapital: 1_000_000, cost: { feeRate: 0, slippageBps: 5, sellTaxRate: 0 },
  fillMode: 'nextOpen', maxRiskPerTradePct: 1, maxPositionSizePct: 50, defaultStopLossPct: 5,
  precision: 4, captureEvents: true, closeAtEnd: false };
const chartData = (candles: Candle[]): StockDataPoint[] => candles.map(c => ({ ...c, date: '', timestamp: c.openTime, price: c.close, currency: 'USD', isMock: false }));
const context = (candles: Candle[], module: StrategyModule, index = candles.length - 1): StrategyContext => ({
  candles, index, indicators: new IndicatorCache(candles), params: { ...module.defaultParams }, position: null });

/** 大幅來回波動後縮成窄幅，最後一根放量突破；價格及成交量不用反向從策略門檻推導。 */
function squeezeFixture() {
  const candles = Array.from({ length: 170 }, (_, i) => bar(i, 100 + (i < 150 ? (i % 2 ? 2 : -2) : (i % 2 ? 0.03 : -0.03))));
  candles.push(bar(170, 100.45, 2000));
  return candles;
}

test('BB 使用母體標準差，ADX Wilder 暖機與單邊手算值一致', () => {
  const bb = calculateBollinger([1, 2, 3, 4, 5], 3, 2);
  assert.ok(Number.isNaN(bb.basis[1]));
  assert.equal(bb.basis[2], 2);
  assert.ok(Math.abs(bb.upper[2] - (2 + 2 * Math.sqrt(2 / 3))) < 1e-12);
  const bars = Array.from({ length: 6 }, (_, i) => ({ ...bar(i, 10 + i), high: 11 + i, low: 9 + i }));
  const adx = calculateAdx(bars, 2);
  assert.ok(Number.isNaN(adx.adx[2]));
  assert.equal(adx.adx[3], 100); assert.equal(adx.plusDi[3], 50); assert.equal(adx.minusDi[3], 0);
});

test('帶寬百分位只讀前根；未來極端值不能改寫過去門檻', () => {
  const values = [1, 2, 3, 4, 1000];
  const threshold = calculateWidthThreshold(values, 3, 50);
  assert.equal(threshold[3], 2); assert.equal(threshold[4], 3);
  assert.deepEqual(calculateWidthThreshold([...values, -1000], 3, 50).slice(0, values.length), threshold);
});

test('收斂突破真的產生進場、鎖定訊號 ATR，沒有收斂或缺量則不進場', () => {
  const candles = squeezeFixture(), ctx = context(candles, squeeze), action = squeeze.evaluate(ctx);
  assert.equal(action.type, 'ENTRY');
  if (action.type !== 'ENTRY') return;
  assert.equal(action.side, 'LONG');
  assert.equal(action.entryPlan!.stopDistance, ctx.indicators.atr(14)[ctx.index] * 2);
  const lowVolume = candles.map(c => ({ ...c })); lowVolume.at(-1)!.volume = 1000;
  assert.equal(squeeze.evaluate(context(lowVolume, squeeze)).type, 'HOLD');
  const noCompression = context(candles, squeeze);
  const state = noCompression.indicators.squeeze(20, 2, 120, 20, 3, 5);
  noCompression.indicators.squeeze = () => ({ ...state, setupIndex: state.setupIndex.map(() => -1) });
  assert.equal(squeeze.evaluate(noCompression).type, 'HOLD');
});

test('追加未來 K 不會改寫兩個策略的過去判斷或快照', () => {
  const candles = squeezeFixture();
  const future = [...candles, bar(171, 500, 999999), bar(172, 1, 1)];
  for (const module of [squeeze, range]) assert.deepEqual(module.evaluate(context(future, module, candles.length - 1)), module.evaluate(context(candles, module)));
});

test('突破進場後假突破於下一根開盤退出，圖表與同設定回測逐筆相同', () => {
  const candles = [...squeezeFixture(), { ...bar(171, 100.5), open: 100.5 }, { ...bar(172, 100.05), open: 100.5, high: 100.6 }, bar(173, 100.05)];
  const result = runBacktestEngine(candles, squeeze, squeeze.defaultParams, config, 0);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, candles[171].openTime);
  assert.equal(result.trades[0].exitTime, candles[173].openTime);
  assert.match(result.trades[0].exitReason, /假突破/);
  const layer = buildStrategyLayers(chartData(candles), { market: 'US', timeframe: '1d', now: Date.UTC(2026, 0, 1) })
    .find(l => l.strategyId === 'volatility_squeeze_breakout')!;
  assert.deepEqual(layer.events.filter(e => !e.pending).map(e => [e.timestamp, e.price, e.type, e.reason]),
    result.events.map(e => [e.timestamp, e.price, e.type, e.reason]));
});

test('開盤超出追價界線取消，不會把下一根的 high 或 close 當作成交條件', () => {
  const candles = [...squeezeFixture(), { ...bar(171, 103), open: 103 }];
  const result = runBacktestEngine(candles, squeeze, squeeze.defaultParams, config, 0);
  assert.equal(result.events.filter(e => e.type === 'ENTRY').length, 0);
  assert.match(result.events[0].reason, /進場取消.*追價/);
  assert.equal(result.events[0].cancelled, true);
  const layer = buildStrategyLayers(chartData(candles), { market: 'US', timeframe: '1d', now: Date.UTC(2026, 0, 1) })
    .find(l => l.strategyId === 'volatility_squeeze_breakout')!;
  assert.equal(getSignalAction(layer.events.find(event => event.cancelled)!), '進場取消');
});

test('絕對 ATR 距離按真正成交價設停損，價格目標不足或壞成本拒絕進場', () => {
  assert.deepEqual(resolveEntryRisk('LONG', 102, 5, { stopDistance: 4 }, config.cost), { stopLossPct: 4 / 102 * 100, stopLossPrice: 98 });
  assert.match((resolveEntryRisk('LONG', 100, 5, { stopDistance: 2, targetPrice: 102.5, minRewardRisk: 1.2 },
    { feeRate: 0.001425, slippageBps: 5, sellTaxRate: 0.003 }) as { error: string }).error, /目標空間不足/);
  assert.match((resolveEntryRisk('LONG', 100, 5, { stopDistance: NaN }, config.cost) as { error: string }).error, /快照/);
  assert.match((resolveEntryRisk('LONG', 100, 5, undefined, { feeRate: -1, slippageBps: 0 }) as { error: string }).error, /成本/);
  assert.equal(calculateFee(100, 10, { feeRate: 0.001, slippageBps: 0, sellTaxRate: 0.003 }, 'BUY'), 1);
  assert.equal(calculateFee(100, 10, { feeRate: 0.001, slippageBps: 0, sellTaxRate: 0.003 }, 'SELL'), 4);
});

/** 指標數值另有手算檢查；此分支檢查只固定市場狀態，讓區間假設及出場門檻可獨立被破壞。 */
function rangeContext(): StrategyContext {
  const candles = Array.from({ length: 152 }, (_, i) => bar(i, 95)); candles[150] = bar(150, 92);
  const size = candles.length, fill = (v: number) => Array(size).fill(v);
  const rsi = fill(38); rsi[150] = 30;
  const lower = fill(93), basis = fill(100), adx = fill(18);
  const direction = { adx, plusDi: fill(20), minusDi: fill(20) };
  const compression = { active: Array<boolean>(size).fill(false), threshold: fill(0.1), setupIndex: fill(-1) };
  const indicators = { atr: () => fill(2), ma: () => basis, rsi: () => rsi,
    bollinger: () => ({ basis, lower, upper: fill(107), width: fill(0.14) }),
    adx: () => direction,
    squeeze: () => compression,
  } as unknown as IndicatorCache;
  return { candles, index: 151, indicators, params: { ...range.defaultParams }, position: null };
}

test('區間需重返帶內、弱趨勢與 RSI 回升；收斂觀察或仍在軌外不進場', () => {
  const ctx = rangeContext(), action = range.evaluate(ctx);
  assert.equal(action.type, 'ENTRY');
  if (action.type !== 'ENTRY') return;
  assert.equal(action.entryPlan!.targetPrice, 100); assert.equal(action.entryPlan!.stopDistance, 3);
  assert.ok(!('error' in resolveEntryRisk('LONG', 95, 5, action.entryPlan, config.cost)));
  ctx.candles[151] = bar(151, 92);
  assert.equal(range.evaluate(ctx).type, 'HOLD');
  const trend = rangeContext(); trend.indicators.adx(14).adx[151] = 30;
  assert.equal(range.evaluate(trend).type, 'HOLD');
  const compressed = rangeContext(); compressed.indicators.squeeze(20, 2, 120, 20, 3, 5).active[150] = true;
  assert.equal(range.evaluate(compressed).type, 'HOLD');
});

test('區間目標鎖定在進場快照；時間到期及方向轉空均出場', () => {
  const ctx = rangeContext();
  ctx.position = { side: 'LONG', entryPrice: 95, quantity: 1, stopLossPrice: 92, entryTime: ctx.candles[149].openTime,
    entryIndex: 149, entryPlan: { stopDistance: 3, targetPrice: 100, minRewardRisk: 1.2 } };
  ctx.indicators.ma(20)[151] = 94;
  assert.equal(range.evaluate(ctx).type, 'HOLD');
  ctx.candles[151] = bar(151, 100);
  assert.match((range.evaluate(ctx) as { reason: string }).reason, /固定均值目標 100/);
  ctx.candles[151] = bar(151, 95); ctx.position.entryIndex = 141;
  assert.match((range.evaluate(ctx) as { reason: string }).reason, /時間到期/);
  ctx.position.entryIndex = 149;
  ctx.indicators.adx(14).adx[151] = 30; ctx.indicators.adx(14).minusDi[151] = 35;
  assert.match((range.evaluate(ctx) as { reason: string }).reason, /區間失效/);
});

test('真實指標序列也能產生區間進出場，較高台股成本會取消同一狹窄目標', () => {
  const candles = Array.from({ length: 250 }, (_, i) => bar(i, 100 + (i < 160 ? 0.1 : 0.3) * (i % 2 ? 1 : -1)));
  candles.push(bar(250, 96), bar(251, 97.8), { ...bar(252, 99.8), open: 97.7, low: 97.6 }, bar(253, 99.9));
  const result = runBacktestEngine(candles, range, range.defaultParams, config, 0);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, candles[252].openTime);
  assert.equal(result.trades[0].exitTime, candles[253].openTime);
  assert.match(result.trades[0].exitReason, /固定均值目標/);
  const expensive = runBacktestEngine(candles, range, range.defaultParams, { ...config,
    cost: { feeRate: 0.001425, slippageBps: 5, sellTaxRate: 0.003 } }, 0);
  assert.equal(expensive.trades.length, 0);
  assert.match(expensive.events[0].reason, /扣成本後目標空間不足/);
});

test('全額現貨部位會先保留買入費用，不讓模擬帳戶透支', () => {
  let quantity = 0;
  const module: StrategyModule = { ...squeeze, warmupBars: 0, warmupBarsForParams: undefined, evaluate(ctx) {
    if (ctx.position) quantity = ctx.position.quantity;
    return ctx.index === 0 ? { type: 'ENTRY', side: 'LONG', stopLossPct: 1, reason: '資金檢查' } : { type: 'HOLD' };
  } };
  const candles = [bar(0, 100), bar(1, 100)];
  const result = runBacktestEngine(candles, module, {}, { ...config, initialCapital: 100, maxPositionSizePct: 100,
    cost: { feeRate: 0.01, slippageBps: 0 }, precision: 8 }, 0);
  assert.ok(quantity * 100 * 1.01 <= 100);
  assert.ok(result.equityCurve.at(-1)!.equity - quantity * 100 >= -1e-8);
});

test('引擎實際持倉保存原始快照，跳空停損以較差開盤價成交', () => {
  let held: OpenPositionState | null = null;
  const module: StrategyModule = { ...squeeze, id: 'execution-test', warmupBars: 0, warmupBarsForParams: undefined,
    evaluate: ctx => {
      if (ctx.position) held = ctx.position;
      return ctx.index === 0 ? { type: 'ENTRY', side: 'LONG', entryPlan: { stopDistance: 2, targetPrice: 105 }, reason: '已確認' } : { type: 'HOLD' };
    } };
  const bars = [bar(0, 100), bar(1, 101), { ...bar(2, 96), open: 96 }];
  const result = runBacktestEngine(bars, module, {}, { ...config, cost: { feeRate: 0, slippageBps: 0 } }, 0);
  assert.equal((held as OpenPositionState | null)?.stopLossPrice, 99);
  assert.equal((held as OpenPositionState | null)?.entryPlan?.targetPrice, 105);
  assert.equal(result.trades[0].exitPrice, 96);
  assert.throws(() => runBacktestEngine(bars, squeeze, squeeze.defaultParams, { ...config, fillMode: 'close' }, 0), /下一根開盤/);
});

test('七圖層、暖機提示、股票日線限制、未收盤排除與等待標籤完整', () => {
  const candles = squeezeFixture(), layers = buildStrategyLayers(chartData(candles), { market: 'US', timeframe: '1d', now: Date.UTC(2026, 0, 1) });
  assert.equal(layers.length, 7);
  const latest = layers.find(l => l.strategyId === 'volatility_squeeze_breakout')!.events.at(-1)!;
  assert.equal(latest.pending, true); assert.equal(getSignalAction(latest), '待確認');
  const short = buildStrategyLayers(chartData(candles.slice(0, 60)), { market: 'US', timeframe: '1d' });
  assert.match(short.find(l => l.strategyId === 'range_mean_reversion')!.statusHint!, /需至少 151 根/);
  const crypto = buildStrategyLayers(chartData(candles), { market: 'CRYPTO', timeframe: '4h' });
  assert.match(crypto.find(l => l.strategyId === 'volatility_squeeze_breakout')!.statusHint!, /不支援/);
  const data = chartData(candles), now = candles.at(-1)!.openTime + 2 * 3_600_000;
  assert.equal(confirmedStrategyCandles(data, { market: 'US', timeframe: '1d', now }).length, candles.length - 1);
  const incomplete = buildStrategyLayers(data, { market: 'US', timeframe: '1d', now });
  assert.equal(incomplete.find(l => l.strategyId === 'volatility_squeeze_breakout')!.events.length, 0);
  assert.equal(listStrategies().filter(s => ['volatility_squeeze_breakout', 'range_mean_reversion'].includes(s.id)).length, 2);
});

test('做空進場在上方、回補在下方，錯誤週期步長與 NaN 參數拒絕', () => {
  const event = { id: 'a', strategyId: 'extreme_reversal' as const, strategyName: '極值', timestamp: 1,
    price: 100, type: 'ENTRY' as const, side: 'SHORT' as const, label: '', reason: '', icon: '' };
  const groups = groupChartSignals([event, { ...event, id: 'b', type: 'EXIT' }]);
  assert.equal(groups.find(g => g.items[0].type === 'ENTRY')!.below, false);
  assert.equal(groups.find(g => g.items[0].type === 'EXIT')!.below, true);
  assert.ok(strategyParamError(squeeze, { ...squeeze.defaultParams, bbPeriod: 20.5 }));
  assert.ok(strategyParamError(range, { ...range.defaultParams, stopAtr: NaN }));
  assert.equal(squeeze.warmupBarsForParams!({ ...squeeze.defaultParams, bbPeriod: 60, widthLookback: 240 }), 303);
});
