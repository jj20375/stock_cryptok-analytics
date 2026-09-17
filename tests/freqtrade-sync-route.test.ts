/** 同步端點只接受通過 HMAC 的研究資料，且可安全覆寫同一個 runId。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { action } from '../app/routes/api.freqtrade.sync';
import { createFreqtradeSignature } from '../app/services/freqtrade/sync';

const payload = {
  schemaVersion: 1,
  runId: 'dry-run-wave-radar-15m-v1-20260910',
  mode: 'DRY_RUN',
  strategyVersion: 'wave-radar-15m-v1',
  strategyName: '波段雷達・15m 觸發',
  exchange: 'binance',
  timeframe: '15m',
  status: 'RUNNING',
  // 路由會拒絕超過一年以前的研究快照，因此整合測試使用執行當下的時間。
  generatedAt: Date.now(),
  metrics: { totalTrades: 8, winRatePct: 62.5, profitFactor: 1.5, maxDrawdownPct: 4.2, netProfitPct: 3.1, openTrades: 1 },
};

test('同步端點驗證簽章後寫入 D1，無效簽章不寫入', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0013_freqtrade_pilot.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(sql => db.prepare(sql.trim())));
    const raw = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = await createFreqtradeSignature('test-sync-secret', timestamp, raw);
    const env = { DB: db, FREQTRADE_SYNC_SECRET: 'test-sync-secret' };
    const response = await action({
      request: new Request('https://example.test/api/freqtrade/sync', { method: 'POST', body: raw, headers: {
        'content-type': 'application/json', 'x-freqtrade-timestamp': timestamp, 'x-freqtrade-signature': signature,
      } }),
      context: { cloudflare: { env } },
      params: {},
    } as any);
    assert.equal(response.status, 200);
    assert.equal((await db.prepare('SELECT * FROM freqtrade_runs').all()).results.length, 1);
    /** 舊封包雖有正確簽章，也不可倒退目前模擬服務的心跳與績效快照。 */
    const olderPayload = { ...payload, generatedAt: payload.generatedAt - 1_000,
      metrics: { ...payload.metrics, totalTrades: 999 } };
    const olderRaw = JSON.stringify(olderPayload);
    const olderTimestamp = String(Date.now());
    const olderSignature = await createFreqtradeSignature('test-sync-secret', olderTimestamp, olderRaw);
    const olderResponse = await action({
      request: new Request('https://example.test/api/freqtrade/sync', { method: 'POST', body: olderRaw, headers: {
        'content-type': 'application/json', 'x-freqtrade-timestamp': olderTimestamp, 'x-freqtrade-signature': olderSignature,
      } }),
      context: { cloudflare: { env } }, params: {},
    } as any);
    assert.equal(olderResponse.status, 200);
    assert.equal((await olderResponse.json() as { updated: boolean }).updated, false);
    assert.equal((await db.prepare('SELECT metrics_json FROM freqtrade_runs').first() as { metrics_json: string }).metrics_json.includes('999'), false);
    const rejected = await action({
      request: new Request('https://example.test/api/freqtrade/sync', { method: 'POST', body: raw, headers: {
        'content-type': 'application/json', 'x-freqtrade-timestamp': timestamp, 'x-freqtrade-signature': '0'.repeat(64),
      } }),
      context: { cloudflare: { env } },
      params: {},
    } as any);
    assert.equal(rejected.status, 401);
    assert.equal((await db.prepare('SELECT * FROM freqtrade_runs').all()).results.length, 1);
  } finally {
    await mf.dispose();
  }
});
