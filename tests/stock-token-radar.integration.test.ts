/** @file 暫存 D1 驗證租約、去重、Slack 重試、過期淘汰與再驗價；攔截全部網路，禁止真實發送。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { runStockTokenRadar } from '../app/services/stockTokenRadar/runner.server';
import { tokenNow, tokenInstrumentRow, tokenFixture, tokenQuoteRow, tokenCandleRows } from './helpers/stockTokenFixture';
import type { StockTokenEnv, StockTokenReport } from '../app/services/stockTokenRadar/types';

async function withRadar(work: (db: any, env: StockTokenEnv) => Promise<void>) {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0030_stock_token_radar.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(statement => db.prepare(statement.trim())));
    await work(db, { DB: db, STOCK_TOKEN_RADAR_ENABLED: 'true', SLACK_API_TOKEN: 'fixture-token', US_STOCK_SLACK_CHANNEL_ID: 'fixture-us-channel' });
  } finally { await mf.dispose(); }
}
const storedReport = async (db: any): Promise<StockTokenReport> => JSON.parse((await db.prepare('SELECT report_json FROM stock_token_radar_run WHERE id = ?').bind('scan').first()).report_json);

test('通知失敗保留、下輪重試只送美股頻道；冷卻／重疊不重抓，同根不重送，過期不補發', async t => {
  await withRadar(async (db, env) => {
    let clock = tokenNow, requests = 0, slackAttempts = 0, failSlack = true;
    const fixture = tokenFixture();
    const posts: any[] = [];
    t.mock.method(Date, 'now', () => clock);
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      const url = new URL(String(input)); requests++;
      if (url.hostname === 'slack.com') {
        slackAttempts++; posts.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: !failSlack, error: failSlack ? 'ratelimited' : undefined });
      }
      assert.equal(url.hostname, 'api.bitget.com'); assert.equal(url.searchParams.get('category'), 'SPOT');
      if (url.pathname.endsWith('instruments')) return Response.json({ code: '00000', data: [tokenInstrumentRow] });
      if (url.pathname.endsWith('tickers')) return Response.json({ code: '00000', data: [tokenQuoteRow({ ...fixture.quote, timestamp: clock })] });
      return Response.json({ code: '00000', data: tokenCandleRows(url.searchParams.get('interval') === '1H' ? fixture.hourly : fixture.fourHourly) });
    });
    const results = await Promise.all([runStockTokenRadar(env), runStockTokenRadar(env)]);
    assert.deepEqual(results.map(r => r.status).sort(), ['busy', 'completed']);
    assert.equal(slackAttempts, 1); assert.ok((await storedReport(db)).notificationError);
    const before = requests;
    assert.equal((await runStockTokenRadar(env)).status, 'cooldown'); assert.equal(requests, before);
    clock += 5 * 60_000; failSlack = false;
    await runStockTokenRadar(env);
    assert.equal(slackAttempts, 2); assert.equal((await storedReport(db)).notificationError, null);
    const notices = await db.prepare('SELECT * FROM stock_token_notices').all();
    assert.equal(notices.results.length, 1); assert.equal(notices.results[0].sent_at, clock);
    assert.ok(posts.every(post => post.channel === 'fixture-us-channel' && /現貨代幣/.test(post.text)));
    clock += 5 * 60_000; await runStockTokenRadar(env); assert.equal(slackAttempts, 2);
    clock += 5 * 60_000; await runStockTokenRadar(env); assert.equal(slackAttempts, 2);
    assert.equal((await storedReport(db)).candidates[0].status, 'STALE');
  });
});

test('通知前價格跳出區間就取消事件與進場候選；再驗證不能繞過停用開關', async t => {
  await withRadar(async (db, env) => {
    t.mock.method(Date, 'now', () => tokenNow);
    const fixture = tokenFixture(); let tickerReads = 0, slackAttempts = 0;
    t.mock.method(globalThis, 'fetch', async input => {
      const url = new URL(String(input));
      if (url.hostname === 'slack.com') { slackAttempts++; return Response.json({ ok: true }); }
      if (url.pathname.endsWith('instruments')) return Response.json({ code: '00000', data: [tokenInstrumentRow] });
      if (url.pathname.endsWith('tickers')) {
        tickerReads++;
        const offset = tickerReads > 1 ? 10 : 0;
        return Response.json({ code: '00000', data: [tokenQuoteRow({ ...fixture.quote, bid: fixture.quote.bid + offset, ask: fixture.quote.ask + offset })] });
      }
      return Response.json({ code: '00000', data: tokenCandleRows(url.searchParams.get('interval') === '1H' ? fixture.hourly : fixture.fourHourly) });
    });
    await runStockTokenRadar(env);
    assert.equal(slackAttempts, 0); assert.equal((await db.prepare('SELECT * FROM stock_token_notices').all()).results.length, 0);
    assert.equal((await storedReport(db)).candidates[0].status, 'WAIT');
    const reads = tickerReads;
    assert.equal((await runStockTokenRadar({ ...env, STOCK_TOKEN_RADAR_ENABLED: 'false' })).status, 'disabled');
    assert.equal(tickerReads, reads);
  });
});

test('缺美股專用頻道仍可存清單；Bitget 403 會清除可進場狀態並釋放租約', async t => {
  await withRadar(async (db, env) => {
    let clock = tokenNow, unavailable = false; const fixture = tokenFixture();
    t.mock.method(Date, 'now', () => clock);
    t.mock.method(globalThis, 'fetch', async input => {
      const url = new URL(String(input)); assert.equal(url.hostname, 'api.bitget.com');
      if (unavailable) return new Response('forbidden', { status: 403 });
      if (url.pathname.endsWith('instruments')) return Response.json({ code: '00000', data: [tokenInstrumentRow] });
      if (url.pathname.endsWith('tickers')) return Response.json({ code: '00000', data: [tokenQuoteRow(fixture.quote)] });
      return Response.json({ code: '00000', data: tokenCandleRows(url.searchParams.get('interval') === '1H' ? fixture.hourly : fixture.fourHourly) });
    });
    const noChannel = { ...env, US_STOCK_SLACK_CHANNEL_ID: undefined, SLACK_CHANNEL_ID: 'must-not-use' };
    await runStockTokenRadar(noChannel);
    assert.equal((await storedReport(db)).candidates[0].status, 'ENTRY');
    assert.equal((await db.prepare('SELECT * FROM stock_token_notices').all()).results.length, 0);
    clock += 5 * 60_000; unavailable = true;
    assert.equal((await runStockTokenRadar(noChannel)).status, 'error');
    const report = await storedReport(db);
    assert.match(report.error!, /403/); assert.deepEqual(report.candidates, []);
    assert.equal((await db.prepare('SELECT expires_at FROM stock_token_radar_run WHERE id = ?').bind('scan').first()).expires_at, 0);
  });
});
