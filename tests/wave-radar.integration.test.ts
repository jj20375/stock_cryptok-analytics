import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { runWaveRadar, type WaveEnv } from '../app/services/waveRadar/scanner';
import { WAVE_INTERVAL_MS } from '../app/services/strategy/strategies/cryptoWave';
import { WAVE_SYMBOLS } from '../app/services/cryptoUniverse';
import { waveFixture } from './helpers/waveFixture';

test('D1 排程：逐幣隔離、HYPE 現貨來源、失敗補送、階段去重與重疊租約', async () => {
  // 使用暫存 D1 與攔截的 Slack/行情；此測試絕不發送真實訊息或讀寫正式資料庫。
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  const originalFetch = globalThis.fetch;
  try {
    const binding = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0011_wave_radar.sql', import.meta.url), 'utf8');
    await binding.batch(migration.split('--> statement-breakpoint').map(sql => binding.prepare(sql.trim())));
    let slackAvailable = false;
    let badAster = true;
    let marketRequests = 0;
    let sent = 0;
    let lastMessage = '';
    let hypeHost = '';
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'slack.com') {
        if (!slackAvailable) return Response.json({ ok: false, error: 'ratelimited' });
        sent++;
        lastMessage = JSON.parse(init?.body as string).text;
        return Response.json({ ok: true });
      }
      if (url.pathname === '/api/v3/klines' || url.pathname === '/v5/market/kline') {
        marketRequests++;
        const symbol = url.searchParams.get('symbol');
        if (symbol === 'HYPEUSDT') hypeHost = url.hostname;
        if (symbol === 'ASTERUSDT' && badAster) return new Response('unavailable', { status: 503 });
        const lastOpen = Math.floor(Date.now() / WAVE_INTERVAL_MS) * WAVE_INTERVAL_MS - WAVE_INTERVAL_MS;
        const rows = waveFixture(lastOpen).map(c => [c.openTime, `${c.open}`, `${c.high}`, `${c.low}`, `${c.close}`, `${c.volume}`]);
        return url.hostname === 'api.bybit.com'
          ? Response.json({ retCode: 0, retMsg: 'OK', result: { list: rows.reverse() } })
          : Response.json(rows);
      }
      return originalFetch(input, init);
    };
    const env: WaveEnv = { DB: binding as unknown as WaveEnv['DB'], WAVE_RADAR_ENABLED: 'true', SLACK_API_TOKEN: 'test-token', SLACK_CHANNEL_ID: 'test-channel' };
    await runWaveRadar({ ...env, WAVE_RADAR_ENABLED: 'false' });
    assert.equal(marketRequests, 0);
    await runWaveRadar(env);
    const rows = await binding.prepare('SELECT * FROM wave_radar').all();
    assert.equal(rows.results.length, WAVE_SYMBOLS.length);
    assert.ok(JSON.parse(rows.results.find(r => r.symbol === 'ASTERUSDT')!.snapshot_json as string).error);
    assert.equal(hypeHost, 'api.binance.us');
    const queued = await binding.prepare('SELECT COUNT(*) AS n FROM wave_notifications WHERE sent_at IS NULL').first<{ n: number }>();
    assert.equal(queued!.n, WAVE_SYMBOLS.length - 1);
    assert.equal(sent, 0);
    slackAvailable = true;
    badAster = false;
    const requestsBeforeRetry = marketRequests;
    await runWaveRadar(env);
    assert.equal(marketRequests - requestsBeforeRetry, 1);
    assert.equal(sent, WAVE_SYMBOLS.length);
    const requestsAfterRetry = marketRequests;
    await runWaveRadar(env);
    assert.equal(sent, WAVE_SYMBOLS.length);
    assert.equal(marketRequests, requestsAfterRetry);
    await binding.prepare('INSERT INTO wave_lease (id, owner, expires_at) VALUES (?, ?, ?)').bind('scan', 'another-worker', Date.now() + 60000).run();
    await runWaveRadar(env);
    assert.equal(sent, WAVE_SYMBOLS.length);
    assert.equal((await binding.prepare('SELECT owner FROM wave_lease').first<{ owner: string }>())!.owner, 'another-worker');
    await binding.prepare('DELETE FROM wave_lease').run();
    await binding.prepare('INSERT INTO wave_notifications (id, message, created_at) VALUES (?, ?, ?)')
      .bind('historical-event', 'test historical signal', Date.now() - 5 * 3600000).run();
    await runWaveRadar(env);
    assert.ok(lastMessage.startsWith('*延遲補送：'));
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});
