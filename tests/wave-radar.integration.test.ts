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
    const lastOpenTime = () => Math.floor(Date.now() / WAVE_INTERVAL_MS) * WAVE_INTERVAL_MS - WAVE_INTERVAL_MS;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'slack.com') {
        if (!slackAvailable) return Response.json({ ok: false, error: 'ratelimited' });
        sent++;
        lastMessage = JSON.parse(init?.body as string).text;
        return Response.json({ ok: true });
      }
      // Gate.io 備援來源：欄位順序為 [秒級時間, 計價幣成交額, 收, 高, 低, 開, 基礎幣成交量, 是否已收盤]
      if (url.pathname === '/api/v4/spot/candlesticks') {
        marketRequests++;
        const pair = url.searchParams.get('currency_pair');
        // ASTER 設定為所有來源皆失敗，驗證「單幣全滅仍逐幣隔離、不影響其他幣」
        if (pair === 'ASTER_USDT' && badAster) return new Response('unavailable', { status: 503 });
        return Response.json(waveFixture(lastOpenTime()).map(c =>
          [`${c.openTime / 1000}`, '0', `${c.close}`, `${c.high}`, `${c.low}`, `${c.open}`, `${c.volume}`, 'true']));
      }
      if (url.pathname === '/api/v3/klines' || url.pathname === '/v5/market/kline') {
        marketRequests++;
        const symbol = url.searchParams.get('symbol');
        if (symbol === 'HYPEUSDT') hypeHost = url.hostname;
        if (symbol === 'ASTERUSDT' && badAster) return new Response('unavailable', { status: 503 });
        // ZEC 主來源故障但 Gate.io 正常，驗證備援切換會成功而非讓整檔停擺
        if (symbol === 'ZECUSDT') return new Response('unavailable', { status: 503 });
        const rows = waveFixture(lastOpenTime()).map(c => [c.openTime, `${c.open}`, `${c.high}`, `${c.low}`, `${c.close}`, `${c.volume}`]);
        return url.hostname === 'api.bybit.com'
          ? Response.json({ retCode: 0, retMsg: 'OK', result: { list: rows.reverse() } })
          : Response.json(rows);
      }
      return originalFetch(input, init);
    };
    const env: WaveEnv = { DB: binding as unknown as WaveEnv['DB'], WAVE_RADAR_ENABLED: 'true', SLACK_API_TOKEN: 'test-token', SLACK_CHANNEL_ID: 'test-channel' };
    await runWaveRadar({ ...env, WAVE_RADAR_ENABLED: 'false' });
    assert.equal(marketRequests, 0);
    // 幣數超過單輪上限時需要多輪才會掃完(受 Cloudflare subrequest 額度限制)，
    // 依 checked_at 輪替排序確保每輪處理不同的幣，最終覆蓋整份名單。
    for (let round = 0; round < Math.ceil(WAVE_SYMBOLS.length / 12) + 1; round++) {
      await runWaveRadar(env);
    }
    const rows = await binding.prepare('SELECT * FROM wave_radar').all();
    assert.equal(rows.results.length, WAVE_SYMBOLS.length);
    // ASTER 所有來源皆故障：仍記錄錯誤且不影響其他幣種(逐幣隔離)
    assert.ok(JSON.parse(rows.results.find(r => r.symbol === 'ASTERUSDT')!.snapshot_json as string).error);
    // ZEC 主來源故障但備援成功：不得記錄錯誤，且必須標示實際採用的來源為 Gate.io
    const zec = JSON.parse(rows.results.find(r => r.symbol === 'ZECUSDT')!.snapshot_json as string);
    assert.equal(zec.error, null);
    assert.equal(zec.source, 'GATE_SPOT');
    assert.equal(hypeHost, 'api.binance.us');
    const queued = await binding.prepare('SELECT COUNT(*) AS n FROM wave_notifications WHERE sent_at IS NULL').first<{ n: number }>();
    assert.equal(queued!.n, WAVE_SYMBOLS.length - 1);
    assert.equal(sent, 0);
    slackAvailable = true;
    badAster = false;
    const requestsBeforeRetry = marketRequests;
    await runWaveRadar(env);
    // 只有先前失敗的 ASTER 需要重抓，其餘幣種同一根 K 線不重複請求
    assert.equal(marketRequests - requestsBeforeRetry, 1);
    // 通知每輪最多送 10 則(同時受 Slack 保護與 Worker subrequest 額度限制)，
    // 幣種數超過批次量時會分多輪送完
    const DELIVERY_BATCH = 10;
    assert.equal(sent, Math.min(DELIVERY_BATCH, WAVE_SYMBOLS.length));
    const requestsAfterRetry = marketRequests;
    // 重複執行直到佇列清空，驗證分批送達最終會把所有通知送出且不重抓行情
    for (let round = 0; round < Math.ceil(WAVE_SYMBOLS.length / DELIVERY_BATCH); round++) {
      await runWaveRadar(env);
    }
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
