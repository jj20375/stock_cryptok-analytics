import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWaveRotation } from '../app/features/tradingDashboard/waveRotation';
import type { WaveSnapshot } from '../app/services/waveRadar/state';

const BAR_TIME = Date.UTC(2026, 8, 10, 12);

function snapshot(closes: number[], dailyTrend = true, barTime = BAR_TIME): WaveSnapshot {
  return {
    signal: { phase: 'WAIT', reason: '測試', price: closes.at(-1)!, barTime, breakout: 110,
      volumeRatio: 1.3, stopLossPct: 4, dailyTrend },
    tracking: null, error: null,
    analysis: { version: 'quality-v2', setup: 'NONE', checks: [], changePct: 0, closes,
      closeStrength: 0.8, distanceAtr: 0.2, stopPrice: 96, target1R: 104, target2R: 108,
      reference: 100, pullbackStage: 'NONE', pullbackMa20: 99, pullbackChecks: [], nextStep: '測試' },
  };
}

test('相對強勢榜只排列同時在 4h、24h 領先 BTC 的日線多頭', () => {
  const btc = snapshot([100, 100, 100, 100, 100, 100, 101]);
  const sol = snapshot([100, 100, 101, 102, 103, 104, 108]);
  const eth = snapshot([100, 100, 100, 101, 102, 103, 105]);
  const weak = snapshot([100, 100, 100, 100, 100, 99, 99]);
  const bearish = snapshot([100, 100, 101, 102, 103, 104, 110], false);
  const snapshots = new Map([['BTCUSDT', btc], ['SOLUSDT', sol], ['ETHUSDT', eth], ['DOGEUSDT', weak], ['XRPUSDT', bearish]]);
  const result = buildWaveRotation(snapshots, new Set(snapshots.keys()));

  assert.equal(result.get('SOLUSDT')?.rank, 1);
  assert.equal(result.get('ETHUSDT')?.rank, 2);
  assert.equal(result.get('SOLUSDT')?.candidate, true);
  assert.equal(result.get('DOGEUSDT')?.rank, null);
  assert.equal(result.get('XRPUSDT')?.rank, null);
});

test('不同收盤時間或過期標的不能進入輪動榜', () => {
  const btc = snapshot([100, 100, 100, 100, 100, 100, 101]);
  const mismatched = snapshot([100, 100, 101, 102, 103, 104, 108], true, BAR_TIME - 4 * 60 * 60 * 1000);
  const current = snapshot([100, 100, 101, 102, 103, 104, 108]);
  const result = buildWaveRotation(new Map([['BTCUSDT', btc], ['SOLUSDT', mismatched], ['ETHUSDT', current]]), new Set(['BTCUSDT']));

  assert.equal(result.get('SOLUSDT')?.score, null);
  assert.equal(result.get('ETHUSDT')?.candidate, false);
});

test('BTC 基準不健康時整個輪動榜保持空白', () => {
  const btc = snapshot([100, 100, 100, 100, 100, 100, 101]);
  const sol = snapshot([100, 100, 101, 102, 103, 104, 108]);
  const result = buildWaveRotation(new Map([['BTCUSDT', btc], ['SOLUSDT', sol]]), new Set(['SOLUSDT']));

  assert.equal(result.get('SOLUSDT')?.score, null);
  assert.equal(result.get('SOLUSDT')?.candidate, false);
});
