/** Freqtrade 同步資料必須可驗證、可重送，且拒絕不合理績效值。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFreqtradeSignature,
  parseFreqtradeSyncPayload,
  verifyFreqtradeSignature,
} from '../app/services/freqtrade/sync';

const NOW = 1_789_000_000_000;
const validPayload = {
  schemaVersion: 1,
  runId: 'dry_run-wave-radar-15m-v1-20260910',
  mode: 'DRY_RUN',
  strategyVersion: 'wave-radar-15m-v1',
  strategyName: '波段雷達・15m 觸發',
  exchange: 'binance',
  timeframe: '15m',
  status: 'RUNNING',
  generatedAt: NOW,
  metrics: {
    totalTrades: 42,
    winRatePct: 57.1,
    profitFactor: 1.4,
    maxDrawdownPct: 8.6,
    netProfitPct: 12.3,
    openTrades: 1,
  },
};

test('Freqtrade payload 只接受有限且可供戰情室顯示的欄位', () => {
  assert.deepEqual(parseFreqtradeSyncPayload(validPayload, NOW), validPayload);
  assert.throws(
    () => parseFreqtradeSyncPayload({ ...validPayload, metrics: { ...validPayload.metrics, winRatePct: 101 } }, NOW),
    /metrics.winRatePct/
  );
  assert.throws(() => parseFreqtradeSyncPayload({ ...validPayload, runId: '../escape' }, NOW), /runId/);
});

test('HMAC 簽章綁定時間與原始內容，過期或被改寫時拒絕', async () => {
  const rawBody = JSON.stringify(validPayload);
  const timestamp = String(NOW);
  const signature = await createFreqtradeSignature('only-for-test', timestamp, rawBody);
  assert.equal(await verifyFreqtradeSignature('only-for-test', timestamp, signature, rawBody, NOW), true);
  assert.equal(await verifyFreqtradeSignature('only-for-test', timestamp, signature, `${rawBody} `, NOW), false);
  assert.equal(await verifyFreqtradeSignature('only-for-test', String(NOW - 300001), signature, rawBody, NOW), false);
});
