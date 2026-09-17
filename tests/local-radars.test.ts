/** @file 以假時鐘及假掃描器驗證本機更新；不連外、不寫入資料庫。 */
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createLocalRadars } from '../dev/localRadars';

test('波段掃描卡住時潛力幣仍可更新，同一時間格會重新載入新版而不重疊', async t => {
  let tick: () => void = () => {};
  let close: () => void = () => {};
  let potentialCalls = 0;
  let waveCalls = 0;
  let releaseWave: () => void = () => {};
  const wavePending = new Promise<void>(resolve => { releaseWave = resolve; });
  t.mock.method(Date, 'now', () => Date.UTC(2026, 8, 14, 1, 47));
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => {
    tick = callback;
    return { unref() {} };
  });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const local = createLocalRadars();
  (local.plugin.configureServer as Function)({
    httpServer: { once(_event: string, callback: () => void) { close = callback; } },
    async ssrLoadModule(path: string) {
      if (path.includes('potentialRadar')) return { async runPotentialRadar() { potentialCalls++; } };
      return { async runWaveRadar(_env: unknown, options: unknown) {
        waveCalls++;
        assert.deepEqual(options, { notifications: false });
        await wavePending;
      } };
    },
  });
  local.start({ DB: {}, POTENTIAL_RADAR_ENABLED: 'true', WAVE_RADAR_ENABLED: 'true' });
  await setImmediate();
  assert.equal(potentialCalls, 1);
  assert.equal(waveCalls, 1);
  tick();
  tick();
  await setImmediate();
  assert.equal(potentialCalls, 2);
  assert.equal(waveCalls, 1);
  close();
  releaseWave();
  await setImmediate();
  tick();
  await setImmediate();
  assert.equal(potentialCalls, 2);
});

test('收盤前兩分鐘等待；單輪失敗不占住本時間格，下次可重試', async t => {
  let tick: () => void = () => {};
  let calls = 0;
  let now = Date.UTC(2026, 8, 14, 1, 46);
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => {
    tick = callback;
    return { unref() {} };
  });
  const local = createLocalRadars();
  (local.plugin.configureServer as Function)({
    async ssrLoadModule(path: string) {
      if (path.includes('potentialRadar')) return { async runPotentialRadar() {
        calls++;
        if (calls === 1) throw new Error('測試用暫時失敗');
      } };
      return { async runWaveRadar() {} };
    },
  });
  local.start({ DB: {} });
  await setImmediate();
  assert.equal(calls, 0);
  now += 60_000;
  tick();
  await setImmediate();
  assert.equal(calls, 1);
  tick();
  await setImmediate();
  assert.equal(calls, 2);
});
