/** @file 暫存 D1 與攔截行情驗證排程；禁止存取正式 DB、發送訊息或下單。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { runPotentialRadar, type PotentialEnv } from '../app/services/potentialRadar/scanner';
import { DAY_MS, QUARTER_MS, type RadarObservation } from '../app/services/potentialRadar/types';
import { analyzePotential } from '../app/services/potentialRadar/analysis';
import { healthyDepth, potentialFixture } from './helpers/potentialFixture';

test('獨立排程：動態找幣、薄量排除、逐幣故障隔離、入選去重與租約', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  const originalFetch = globalThis.fetch;
  try {
    const binding = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0012_potential_radar.sql', import.meta.url), 'utf8');
    await binding.batch(migration.split('--> statement-breakpoint').map(sql => binding.prepare(sql.trim())));
    const symbols = ['BTCUSDT', 'NEWUSDT', 'FAILUSDT', 'THINUSDT', 'USDCUSDT', 'DEADUSDT'];
    let requests = 0;
    let failed = true;
    let globalFailure = false;
    globalThis.fetch = async (input) => {
      requests++;
      const url = new URL(String(input));
      if (url.hostname === 'api.gateio.ws') {
        const now = Date.now();
        if (url.pathname.endsWith('/contract_stats')) return Response.json([
          { time: Math.floor((now - 60 * 60_000) / 1000), open_interest_usd: 100_000_000, lsr_taker: 1, lsr_account: 1, top_lsr_account: 1 },
          { time: Math.floor(now / 1000), open_interest_usd: 102_000_000, lsr_taker: 1.1, lsr_account: 1.05, top_lsr_account: 1.1 },
        ]);
        if (url.pathname.endsWith('/funding_rate')) return Response.json([{ t: Math.floor(now / 1000), r: '0.0001' }]);
      }
      assert.equal(url.hostname, 'api.bybit.com');
      assert.ok(url.pathname.startsWith('/v5/market/'));
      assert.equal(url.searchParams.get('category'), 'spot');
      if (globalFailure) return new Response('', { status: 503 });
      const payload = (result: unknown) => Response.json({ retCode: 0, time: Date.now(), result });
      if (url.pathname.endsWith('/instruments-info')) return payload({ list: symbols.map(symbol => ({ symbol,
        status: symbol === 'DEADUSDT' ? 'Closed' : 'Trading', baseCoin: symbol.slice(0, -4), quoteCoin: 'USDT' })) });
      if (url.pathname.endsWith('/tickers')) return payload({ list: symbols.map(symbol => ({ symbol, lastPrice: '100',
        turnover24h: symbol === 'THINUSDT' ? '100' : '10000000', price24hPcnt: '0.05', bid1Price: '99.99', ask1Price: '100.01' })) });
      const symbol = url.searchParams.get('symbol');
      assert.ok(!['THINUSDT', 'USDCUSDT', 'DEADUSDT'].includes(symbol!));
      if (symbol === 'FAILUSDT' && failed) return new Response('', { status: 503 });
      if (url.pathname.endsWith('/kline')) {
        const cutoff = Number(url.searchParams.get('end')) + 1;
        const candles = potentialFixture(cutoff, symbol !== 'BTCUSDT' && symbol !== 'NEWUSDT');
        /** 無放量突破也要能保存獨立吃大魚金叉的研究樣本。 */
        if (symbol === 'NEWUSDT') candles.at(-1)!.close = 100.1;
        return payload({ list: candles.reverse().map(c =>
          [c.openTime, c.open, c.high, c.low, c.close, c.volume, c.turnover].map(String)) });
      }
      if (url.pathname.endsWith('/orderbook')) return payload({ b: [['100', '1000']], a: [['100.01', '1000']], ts: Date.now() });
      throw new Error('非預期外部呼叫');
    };
    const env = { DB: binding, POTENTIAL_RADAR_ENABLED: 'true' } as unknown as PotentialEnv;
    await runPotentialRadar({ ...env, POTENTIAL_RADAR_ENABLED: 'false' });
    assert.equal(requests, 0);
    /** 重現升級前同根已成功：缺版本的摘要不得阻止新版吃大魚補算。 */
    const legacyRun = { startedAt: Date.now(), completedAt: Date.now(), failed: 0, error: null };
    await binding.prepare('INSERT INTO potential_run (id, owner, expires_at, summary_json) VALUES (?, ?, ?, ?)')
      .bind('scan', 'legacy', 0, JSON.stringify(legacyRun)).run();
    await runPotentialRadar(env);
    const rows = await binding.prepare('SELECT * FROM potential_radar').all();
    assert.equal(rows.results.length, 3);
    assert.ok(JSON.parse(rows.results.find(r => r.symbol === 'FAILUSDT')!.snapshot_json as string).error);
    const newSignal = JSON.parse(rows.results.find(r => r.symbol === 'NEWUSDT')!.snapshot_json as string).signal;
    assert.equal(newSignal.phase, 'WAIT');
    assert.equal(newSignal.bigFish.earlyLong, true);
    const observations = await binding.prepare('SELECT * FROM potential_observations').all();
    assert.equal(observations.results.length, 1);
    assert.equal(observations.results[0].symbol, 'NEWUSDT');
    const saved = JSON.parse(observations.results[0].observation_json as string);
    assert.deepEqual(saved.signal.bigFish, newSignal.bigFish);
    assert.equal(saved.signal.version, '15m-v4-derivatives');
    assert.equal(saved.signal.derivatives.status, 'NEUTRAL');
    const runAfterUpgrade = await binding.prepare('SELECT summary_json FROM potential_run').first<{ summary_json: string }>();
    assert.equal(JSON.parse(runAfterUpgrade!.summary_json).version, '15m-v4-derivatives');
    assert.ok(requests < 12);
    failed = false;
    await runPotentialRadar(env);
    assert.equal((await binding.prepare('SELECT * FROM potential_observations').all()).results.length, 2);
    const before = requests;
    await runPotentialRadar(env);
    assert.equal(requests, before);
    await binding.prepare('UPDATE potential_run SET owner = ?, expires_at = ?, summary_json = NULL').bind('other', Date.now() + QUARTER_MS).run();
    await runPotentialRadar(env);
    assert.equal(requests, before);
    await binding.prepare('UPDATE potential_run SET expires_at = 0').run();
    globalFailure = true;
    await runPotentialRadar(env);
    const [run] = (await binding.prepare('SELECT * FROM potential_run').all()).results;
    assert.ok(JSON.parse(run.summary_json as string).error);
    assert.equal(run.expires_at, 0);
    assert.equal((await binding.prepare('SELECT * FROM potential_observations').all()).results.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});

test('十六檔與八天研究紀錄仍維持請求預算，每個 SQL 不超過 100 個參數', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  const originalFetch = globalThis.fetch;
  try {
    const binding = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0012_potential_radar.sql', import.meta.url), 'utf8');
    await binding.batch(migration.split('--> statement-breakpoint').map(sql => binding.prepare(sql.trim())));
    const cutoff = Math.floor(Date.now() / QUARTER_MS) * QUARTER_MS;
    const symbols = Array.from({ length: 16 }, (_, i) => `COIN${i}USDT`);
    const signal = analyzePotential(potentialFixture(cutoff), potentialFixture(cutoff, false), healthyDepth);
    for (const symbol of symbols) {
      await binding.batch(Array.from({ length: 8 }, (_, i) => {
        const enteredAt = cutoff - (i + 1) * DAY_MS;
        const observation: RadarObservation = { id: `${symbol}:${enteredAt}`, symbol, enteredAt, detectedAt: enteredAt,
          entryPrice: 100, signal, checkedThrough: enteredAt, returns: { h24: null, h72: null, d7: null },
          maxRise: 0, maxFall: 0, complete: false, error: null };
        return binding.prepare('INSERT INTO potential_observations VALUES (?, ?, ?, ?, ?)')
          .bind(observation.id, symbol, enteredAt, enteredAt, JSON.stringify(observation));
      }));
    }
    let queries = 0;
    let requests = 0;
    const trackedBinding = {
      prepare(query: string) {
        queries++;
        const statement = binding.prepare(query);
        return new Proxy(statement, { get(target, property) {
          if (property === 'bind') return (...args: unknown[]) => { assert.ok(args.length <= 100); return target.bind(...args); };
          const member = Reflect.get(target, property);
          return typeof member === 'function' ? member.bind(target) : member;
        } });
      },
      batch: binding.batch.bind(binding),
    };
    globalThis.fetch = async input => {
      requests++;
      const url = new URL(String(input));
      if (url.hostname === 'api.gateio.ws') {
        const now = Date.now();
        if (url.pathname.endsWith('/contract_stats')) return Response.json([
          { time: Math.floor((now - 60 * 60_000) / 1000), open_interest_usd: 100_000_000 },
          { time: Math.floor(now / 1000), open_interest_usd: 102_000_000 },
        ]);
        if (url.pathname.endsWith('/funding_rate')) return Response.json([{ t: Math.floor(now / 1000), r: '0' }]);
      }
      const payload = (result: unknown) => Response.json({ retCode: 0, time: Date.now(), result });
      if (url.pathname.endsWith('/instruments-info')) return payload({ list: symbols.map(symbol => ({ symbol, baseCoin: symbol.slice(0, -4), quoteCoin: 'USDT', status: 'Trading' })) });
      if (url.pathname.endsWith('/tickers')) return payload({ list: symbols.map(symbol => ({ symbol, lastPrice: '100', turnover24h: '10000000', price24hPcnt: '.05', bid1Price: '100', ask1Price: '100.01' })) });
      if (url.pathname.endsWith('/orderbook')) return payload({ b: [['100', '1000']], a: [['100.01', '1000']], ts: Date.now() });
      if (url.pathname.endsWith('/kline')) return payload({ list: potentialFixture(cutoff, url.searchParams.get('symbol') !== 'BTCUSDT', 1000).map(c =>
        [c.openTime, c.open, c.high, c.low, c.close, c.volume, c.turnover].map(String)) });
      throw new Error('非預期行情請求');
    };
    await runPotentialRadar({ DB: trackedBinding, POTENTIAL_RADAR_ENABLED: 'true' } as unknown as PotentialEnv);
    const [run] = (await binding.prepare('SELECT summary_json FROM potential_run').all()).results;
    const summary = JSON.parse(run.summary_json as string);
    assert.equal(summary.error, null);
    assert.equal(summary.scanned, 13);
    assert.equal((await binding.prepare('SELECT * FROM potential_observations').all()).results.length, 141);
    assert.ok(requests + queries <= 50, `${requests} 行情 + ${queries} SQL 超出預算`);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});
