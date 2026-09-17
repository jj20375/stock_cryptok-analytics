/** @file 主來源故障時驗證整輪 Gate 備援與研究來源隔離；僅使用暫存 DB 及合成行情。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { runPotentialRadar, type PotentialEnv } from '../app/services/potentialRadar/scanner';
import { QUARTER_MS } from '../app/services/potentialRadar/types';
import { potentialFixture } from './helpers/potentialFixture';

test('Bybit 無法使用時，Gate 名單、BTC、K 線與掛單整輪一致且不修改原來源研究', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', d1Databases: ['DB'] });
  const original = globalThis.fetch;
  try {
    const db = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0012_potential_radar.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(sql => db.prepare(sql.trim())));
    const cutoff = Math.floor(Date.now() / QUARTER_MS) * QUARTER_MS;
    const old = { id: 'old', symbol: 'NEWUSDT', enteredAt: cutoff - QUARTER_MS, detectedAt: cutoff - QUARTER_MS,
      entryPrice: 100, signal: { source: 'BYBIT_SPOT' }, checkedThrough: cutoff - QUARTER_MS,
      returns: { h24: null, h72: null, d7: null }, maxRise: 0, maxFall: 0, complete: false, error: null };
    await db.prepare('INSERT INTO potential_observations VALUES (?, ?, ?, ?, ?)')
      .bind(old.id, old.symbol, old.enteredAt, old.enteredAt, JSON.stringify(old)).run();
    const gatePaths: string[] = [];
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.hostname === 'api.bybit.com') throw new Error('主來源憑證失敗');
      assert.equal(url.hostname, 'api.gateio.ws');
      gatePaths.push(url.pathname);
      if (url.pathname.endsWith('/contract_stats')) {
        const now = Date.now();
        return Response.json([
          { time: Math.floor((now - 60 * 60_000) / 1000), open_interest_usd: 100_000_000 },
          { time: Math.floor(now / 1000), open_interest_usd: 102_000_000 },
        ]);
      }
      if (url.pathname.endsWith('/funding_rate')) return Response.json([{ t: Math.floor(Date.now() / 1000), r: '0' }]);
      if (url.pathname.endsWith('/currency_pairs')) return Response.json(['BTC', 'NEW'].map(base => ({ id: `${base}_USDT`, base, quote: 'USDT', trade_status: 'tradable' })));
      if (url.pathname.endsWith('/tickers')) return Response.json(['BTC', 'NEW'].map(base => ({ currency_pair: `${base}_USDT`, last: '100', quote_volume: '10000000', change_percentage: '5', highest_bid: '99.99', lowest_ask: '100.01' })));
      if (url.pathname.endsWith('/candlesticks')) {
        assert.equal(url.searchParams.has('limit'), false);
        return Response.json(potentialFixture(cutoff, url.searchParams.get('currency_pair') === 'NEW_USDT').map(c =>
          [c.openTime / 1000, c.turnover, c.close, c.high, c.low, c.open, c.volume, 'true'].map(String)));
      }
      if (url.pathname.endsWith('/order_book')) return Response.json({ current: Date.now(), update: Date.now(), bids: [['100', '1000']], asks: [['100.01', '1000']] });
      throw new Error('非預期請求');
    };
    await runPotentialRadar({ DB: db, POTENTIAL_RADAR_ENABLED: 'true' } as unknown as PotentialEnv);
    const rows = (await db.prepare('SELECT snapshot_json FROM potential_radar').all()).results;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const snapshot = JSON.parse(row.snapshot_json as string);
      assert.equal(snapshot.error, null);
      assert.equal(snapshot.signal.source, 'GATE_SPOT');
    }
    assert.ok(gatePaths.some(p => p.endsWith('/order_book')));
    const saved = await db.prepare('SELECT observation_json FROM potential_observations WHERE id = ?').bind('old').first();
    assert.deepEqual(JSON.parse(saved!.observation_json as string), old);
  } finally { globalThis.fetch = original; await mf.dispose(); }
});
