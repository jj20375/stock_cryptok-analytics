/**
 * @file 一般回測的「未進場原因」統計：0 筆或極少成交時，頁面要能說明是哪個策略條件擋掉，
 * 而不是只顯示空白報告（例如 1h→4h 策略的 ATR 波動下限把 BTC 全部濾掉）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBacktestEngine } from '../app/services/backtest/engine';
import type { StrategyModule } from '../app/services/strategy/types';

const HOUR_MS = 3_600_000;
const candles = Array.from({ length: 60 }, (_, i) => ({
  openTime: i * HOUR_MS, closeTime: (i + 1) * HOUR_MS - 1, open: 100, high: 101, low: 99, close: 100, volume: 10,
}));

/** 前 40 根以固定原因拒絕，其後以另一原因拒絕，永遠不進場 */
const alwaysHold: StrategyModule = {
  id: 'test_always_hold', name: '測試', description: '', markets: ['CRYPTO'], supportedIntervals: ['1h'],
  warmupBars: 0, supportsShort: false, defaultParams: {}, paramMeta: [],
  evaluate: (ctx) => ({ type: 'HOLD', reason: ctx.index < 40 ? '波動太低' : '分數未達門檻' }),
} as StrategyModule;

const config = {
  initialCapital: 10_000, cost: { feeRate: 0.0005, slippageBps: 5, sellTaxRate: 0 }, fillMode: 'nextOpen' as const,
  maxRiskPerTradePct: 1, maxPositionSizePct: 50, defaultStopLossPct: 5, precision: 6,
};

test('一般回測 0 筆成交時，回傳研究區間內各未進場原因的根數', () => {
  const result = runBacktestEngine(candles as any, alwaysHold, {}, config as any, 10 * HOUR_MS);
  assert.equal(result.trades.length, 0);
  assert.equal(result.noEntryReasons?.['波動太低'], 30);
  assert.equal(result.noEntryReasons?.['分數未達門檻'], 20);
  assert.equal(result.entryDiagnostics, undefined);
});
