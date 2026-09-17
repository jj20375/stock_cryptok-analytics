/** @file 暫存 D1 驗證 Slack 待發佇列會重試，且同根排程可在略過掃描時繼續補送。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { runPotentialRadar, type PotentialEnv } from '../app/services/potentialRadar/scanner';
import { potentialFixture } from './helpers/potentialFixture';

test('Slack 失敗保留待發通知，同根重跑會補送且不重複發送', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  const originalFetch = globalThis.fetch;
  try {
    const db = await mf.getD1Database('DB');
    for (const name of ['0012_potential_radar.sql', '0014_potential_radar_notifications.sql']) {
      const migration = await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8');
      await db.batch(migration.split('--> statement-breakpoint').map(sql => db.prepare(sql.trim())));
    }
    let slackSucceeds = false;
    let slackAttempts = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'slack.com') {
        slackAttempts++;
        assert.equal(init?.method, 'POST');
        assert.match(String(init?.body), /NEWUSDT/);
        return Response.json({ ok: slackSucceeds });
      }
      if (url.hostname === 'api.gateio.ws') {
        const now = Date.now();
        if (url.pathname.endsWith('/contract_stats')) return Response.json([
          { time: Math.floor((now - 60 * 60_000) / 1000), open_interest_usd: 100_000_000 },
          { time: Math.floor(now / 1000), open_interest_usd: 102_000_000 },
        ]);
        if (url.pathname.endsWith('/funding_rate')) return Response.json([{ t: Math.floor(now / 1000), r: '0' }]);
      }
      assert.equal(url.hostname, 'api.bybit.com');
      const payload = (result: unknown) => Response.json({ retCode: 0, time: Date.now(), result });
      const symbols = ['BTCUSDT', 'NEWUSDT'];
      if (url.pathname.endsWith('/instruments-info')) return payload({ list: symbols.map(symbol => ({ symbol,
        status: 'Trading', baseCoin: symbol.slice(0, -4), quoteCoin: 'USDT' })) });
      if (url.pathname.endsWith('/tickers')) return payload({ list: symbols.map(symbol => ({ symbol, lastPrice: '100',
        turnover24h: '10000000', price24hPcnt: '0.05', bid1Price: '99.99', ask1Price: '100.01' })) });
      const symbol = url.searchParams.get('symbol');
      if (url.pathname.endsWith('/kline')) {
        const cutoff = Number(url.searchParams.get('end')) + 1;
        const candles = potentialFixture(cutoff, false);
        if (symbol === 'NEWUSDT') candles.at(-1)!.close = 100.1;
        return payload({ list: candles.reverse().map(c =>
          [c.openTime, c.open, c.high, c.low, c.close, c.volume, c.turnover].map(String)) });
      }
      if (url.pathname.endsWith('/orderbook')) return payload({ b: [['100', '1000']], a: [['100.01', '1000']], ts: Date.now() });
      throw new Error('非預期行情請求');
    };
    const env: PotentialEnv = { DB: db, POTENTIAL_RADAR_ENABLED: 'true', SLACK_API_TOKEN: 'test-token', CRYPTO_ENTRY_SLACK_CHANNEL_ID: 'test-channel' };
    /** 此合成行情未滿足中週期共振；待發列由本測試建立，專注驗證 Slack 補送而非重複量價判斷。 */
    await runPotentialRadar(env);
    await db.prepare('INSERT INTO potential_radar_notifications (id, message, created_at, sent_at) VALUES (?, ?, ?, NULL)')
      .bind('OLDUSDT:test', '歷史訊號不得補送', Date.now() - 16 * 60_000).run();
    await db.prepare('INSERT INTO potential_radar_notifications (id, message, created_at, sent_at) VALUES (?, ?, ?, NULL)')
      .bind('NEWUSDT:test', '潛力幣雷達｜NEWUSDT｜趨勢共振', Date.now()).run();
    await runPotentialRadar(env);
    let rows = await db.prepare('SELECT * FROM potential_radar_notifications').all();
    assert.equal(rows.results.length, 1);
    assert.equal(rows.results[0].id, 'NEWUSDT:test');
    assert.equal(rows.results[0].sent_at, null);
    assert.equal(slackAttempts, 1);
    slackSucceeds = true;
    await runPotentialRadar(env);
    rows = await db.prepare('SELECT * FROM potential_radar_notifications').all();
    assert.equal(rows.results.length, 1);
    assert.equal(typeof rows.results[0].sent_at, 'number');
    assert.equal(slackAttempts, 2);
    await runPotentialRadar(env);
    assert.equal((await db.prepare('SELECT * FROM potential_radar_notifications').all()).results.length, 1);
    assert.equal(slackAttempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});
