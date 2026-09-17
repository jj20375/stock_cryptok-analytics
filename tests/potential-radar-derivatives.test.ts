/** @file Gate 永續籌碼分類離線測試；只使用合成統計，不連接交易所或下單。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeGateDerivatives, fetchGateDerivativeSignal, type GateContractStatRow, type GateFundingRow } from '../app/services/potentialRadar/derivatives';

const checkedAt = Date.UTC(2026, 8, 15, 4);

function stats(oiStart: number, oiEnd: number, topRatio = 1): GateContractStatRow[] {
  return Array.from({ length: 16 }, (_, index) => ({
    time: checkedAt / 1000 - (15 - index) * 5 * 60,
    open_interest_usd: oiStart + (oiEnd - oiStart) * index / 15,
    lsr_taker: 1.1,
    lsr_account: 1.05,
    top_lsr_account: topRatio,
    long_liq_usd_new: index === 15 ? 20_000 : 0,
    short_liq_usd_new: index === 15 ? 80_000 : 0,
  }));
}

function funding(latest = 0): GateFundingRow[] {
  return Array.from({ length: 100 }, (_, index) => ({ t: checkedAt / 1000 - (99 - index) * 8 * 60 * 60,
    r: index === 99 ? latest : index / 1_000_000 }));
}

test('價格與 OI 同漲且費率不擁擠時為健康趨勢', () => {
  const signal = analyzeGateDerivatives(stats(100_000_000, 103_000_000), funding(0), 1.2, checkedAt);
  assert.equal(signal.status, 'HEALTHY_TREND');
  assert.ok(signal.openInterestChange1hPct! > 2);
  assert.equal(signal.fundingRate, 0);
  assert.equal(signal.shortLiquidationUsd1h, 80_000);
});

test('區分軋空、多頭擁擠、新增空單與去槓桿', () => {
  assert.equal(analyzeGateDerivatives(stats(103_000_000, 100_000_000), funding(), 1.2, checkedAt).status, 'SHORT_SQUEEZE');
  assert.equal(analyzeGateDerivatives(stats(100_000_000, 103_000_000, 1.6), funding(0.001), 1.2, checkedAt).status, 'CROWDED_LONG');
  assert.equal(analyzeGateDerivatives(stats(100_000_000, 103_000_000), funding(), -1.2, checkedAt).status, 'NEW_SHORTS');
  assert.equal(analyzeGateDerivatives(stats(103_000_000, 100_000_000), funding(), -1.2, checkedAt).status, 'DELEVERAGING');
});

test('OI 歷史不足時回傳不可用，不以零變化冒充中性', () => {
  const signal = analyzeGateDerivatives(stats(100, 101).slice(-2), [], 1, checkedAt);
  assert.equal(signal.status, 'UNAVAILABLE');
  assert.equal(signal.openInterestChange1hPct, null);
  assert.match(signal.reasons[0], /至少 45 分鐘/);
});

test('Gate 服務失敗時保留不可用結果，不讓附加確認中斷現貨掃描', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const signal = await fetchGateDerivativeSignal('SOLUSDT', 1, checkedAt);
  assert.equal(signal.status, 'UNAVAILABLE');
  assert.match(signal.reasons[0], /暫時無法使用/);
});
