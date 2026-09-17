/** @file 更新空窗與真正異常的邊界測試；舊訊號始終不列入最新候選。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextScanAt, scanDueAt, snapshotFresh, snapshotState } from '../app/features/potentialRadar/freshness';
import { QUARTER_MS, type RadarSnapshot, type RadarRun } from '../app/services/potentialRadar/types';

const cutoff = Date.parse('2026-09-10T12:30:00Z');
const snapshot = { symbol: 'BTCUSDT', checkedAt: cutoff - 13 * 60_000, error: null,
  signal: { barTime: cutoff - 2 * QUARTER_MS } } as RadarSnapshot;
const run: RadarRun = { startedAt: snapshot.checkedAt, completedAt: snapshot.checkedAt + 5000,
  eligible: 29, selected: 12, scanned: 12, failed: 0, error: null };

test('20:31 截圖：20:17 成功快照等待 20:32 掃描，不算資料異常且不冒充最新訊號', () => {
  const now = cutoff + 107_000;
  assert.equal(scanDueAt(now), Date.parse('2026-09-10T12:32:00Z'));
  assert.equal(nextScanAt(now), Date.parse('2026-09-10T12:32:00Z'));
  assert.equal(nextScanAt(cutoff + 3 * 60_000), Date.parse('2026-09-10T12:47:00Z'));
  assert.equal(snapshotState(snapshot, now, run), 'WAITING');
  assert.equal(snapshotFresh(snapshot, now), false);
  assert.equal(snapshotState(snapshot, cutoff + 3 * 60_000, run), 'WAITING');
  assert.equal(snapshotState(snapshot, cutoff + 7 * 60_000 + 1, run), 'DELAYED');
});

test('成功、輪替、真實失敗與多輪過期分開判斷', () => {
  const now = cutoff + 4 * 60_000;
  assert.equal(snapshotState({ ...snapshot, signal: { ...snapshot.signal!, barTime: cutoff - QUARTER_MS } }, now, run), 'FRESH');
  assert.equal(snapshotState(snapshot, now, { ...run, startedAt: cutoff + 120_000, completedAt: cutoff + 130_000 }), 'ROTATING');
  assert.equal(snapshotState({ ...snapshot, error: '行情來源失敗' }, now, run), 'ERROR');
  assert.equal(snapshotState({ ...snapshot, signal: null }, now, run), 'ERROR');
  assert.equal(snapshotState({ ...snapshot, signal: null, error: '目前不在流動性合格的可交易現貨池；保留歷史追蹤' }, now, run), 'TRACKING');
  assert.equal(snapshotState(snapshot, now, { ...run, error: '整輪失敗' }), 'DELAYED');
  assert.equal(snapshotState(snapshot, cutoff + QUARTER_MS, run), 'DELAYED');
});
