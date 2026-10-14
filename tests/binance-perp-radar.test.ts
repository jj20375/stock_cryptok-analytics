/** @file 以攔截的 Binance／Gate／Slack 回應與暫存 D1 驗證分片永續吃大魚排程。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { runBinancePerpNotificationQueue, runBinancePerpRadar, type BinancePerpEnv } from '../app/services/binancePerpRadar/scanner';
import { fetchPerpUniverse, getPerpShardIndex, selectPerpCandidates, selectPerpShard } from '../app/services/binancePerpRadar/market';
import { BINANCE_PERP_RULES, PERP_BAR_MS, type PerpTicker } from '../app/services/binancePerpRadar/types';
import { createCryptoSignalCard, serializeSlackCard } from '../app/services/slack/cryptoSignalCard';
import { potentialFixture } from './helpers/potentialFixture';

test('四個分片互斥且合計最多 128 檔，仍優先涵蓋強勢、深跌與高成交額', () => {
  const cutoff = Date.UTC(2026, 8, 15, 2, 30);
  const universe: PerpTicker[] = Array.from({ length: 260 }, (_, index) => ({
    symbol: `COIN${index}USDT`, baseAsset: `COIN${index}`, price: 100,
    change24h: index === 1 ? -35.88 : index,
    quoteVolume24h: index === 0 ? 999_000_000 : 10_000_000 + index,
  }));
  const selected = selectPerpCandidates(universe, cutoff);
  assert.equal(selected.length, 128);
  assert.equal(new Set(selected.map(item => item.symbol)).size, 128);
  assert.ok(selected.some(item => item.symbol === 'COIN259USDT'));
  assert.ok(selected.some(item => item.symbol === 'COIN0USDT'));
  /** BR 類大跌後翻綠不能再只靠輪替碰運氣。 */
  assert.ok(selected.some(item => item.symbol === 'COIN1USDT'));
  for (let shardIndex = 0; shardIndex < BINANCE_PERP_RULES.shardCount; shardIndex++) {
    const shard = selectPerpShard(universe, cutoff, shardIndex);
    assert.equal(shard.length, 32);
    assert.ok(shard.every(item => getPerpShardIndex(item.symbol, cutoff) === shardIndex));
  }
  assert.notDeepEqual(selected, selectPerpCandidates(universe, cutoff + PERP_BAR_MS));
});

test('同一根 4 小時 K 已完成的分片不重掃；上市未滿 201 根的新合約記為略過，不阻擋分片完成', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  const originalFetch = globalThis.fetch;
  try {
    const db = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0015_binance_perp_radar.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(statement => db.prepare(statement.trim())));
    const symbols = ['NEWUSDT', ...Array.from({ length: 40 }, (_, index) => `OLD${index}USDT`)];
    const contracts = symbols.map(symbol => ({ symbol, baseAsset: symbol.slice(0, -4), quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL' }));
    const tickers = symbols.map((symbol, index) => ({ symbol, lastPrice: '100', priceChangePercent: String(5 - index * 0.1), quoteVolume: '10000000' }));
    let klineRequests = 0;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/exchangeInfo')) return Response.json({ symbols: contracts });
      if (url.pathname.endsWith('/ticker/24hr')) return Response.json(tickers);
      if (url.pathname.endsWith('/markPriceKlines')) {
        klineRequests++;
        assert.equal(url.searchParams.get('interval'), '4h');
        const cutoff = Math.floor(Date.now() / PERP_BAR_MS) * PERP_BAR_MS;
        /** 新合約只有 50 根 4 小時 K（約 8 天），不足 EMA200 所需的 201 根。 */
        const count = url.searchParams.get('symbol') === 'NEWUSDT' ? 50 : 400;
        return Response.json(potentialFixture(cutoff, false, count, PERP_BAR_MS).map(candle =>
          [candle.openTime, String(candle.open), String(candle.high), String(candle.low), String(candle.close), '0']));
      }
      throw new Error(`非預期外部請求：${url}`);
    };
    const env: BinancePerpEnv = { DB: db, BINANCE_PERP_RADAR_ENABLED: 'true' };
    const cutoff = Math.floor(Date.now() / PERP_BAR_MS) * PERP_BAR_MS;
    const barKey = Math.floor(Date.now() / PERP_BAR_MS);
    const newShard = getPerpShardIndex('NEWUSDT', cutoff);
    const otherShard = (newShard + 1) % BINANCE_PERP_RULES.shardCount;
    const readSummary = async () => JSON.parse((await db.prepare('SELECT summary_json FROM binance_perp_run WHERE id = ?')
      .bind('scan').first<{ summary_json: string }>())!.summary_json);

    await runBinancePerpRadar(env, newShard);
    const firstRequests = klineRequests;
    let summary = await readSummary();
    assert.ok(firstRequests > 0);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.completedShards[String(newShard)], barKey);

    /** 15 分鐘後同一分片再被喚醒：同一根 4 小時 K 已完成，不應再抓任何 K 線。 */
    await runBinancePerpRadar(env, newShard);
    assert.equal(klineRequests, firstRequests);

    /** 另一個分片寫入摘要後，前一個分片的完成紀錄必須保留，否則會被誤判為未完成而重掃。 */
    await runBinancePerpRadar(env, otherShard);
    assert.ok(klineRequests > firstRequests);
    summary = await readSummary();
    assert.equal(summary.completedShards[String(newShard)], barKey);
    assert.equal(summary.completedShards[String(otherShard)], barKey);
    const afterOther = klineRequests;
    await runBinancePerpRadar(env, newShard);
    assert.equal(klineRequests, afterOther);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});

test('Binance 無法連線時會整批改用 Gate 公開市場', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.hostname === 'fapi.binance.com') return new Response('blocked', { status: 403 });
      if (url.pathname.endsWith('/contracts')) return Response.json([
        { name: 'BTC_USDT', status: 'trading', in_delisting: false, contract_type: '' },
      ]);
      if (url.pathname.endsWith('/tickers')) return Response.json([
        { contract: 'BTC_USDT', mark_price: '65000', change_percentage: '2', volume_24h_quote: '100000000' },
      ]);
      throw new Error(`非預期外部請求：${url}`);
    };
    const market = await fetchPerpUniverse();
    assert.equal(market.source, 'GATE');
    assert.deepEqual(market.tickers.map(ticker => ticker.symbol), ['BTCUSDT']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance Mark Price 分片進場會寫入 Slack 佇列；失敗後同根補送且不重複', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  const originalFetch = globalThis.fetch;
  try {
    const db = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0015_binance_perp_radar.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(statement => db.prepare(statement.trim())));
    const validSymbols = ['BTWUSDT', ...Array.from({ length: 160 }, (_, index) => `COIN${index}USDT`)];
    const tickers = [
      ...validSymbols.map((symbol, index) => ({
        symbol, lastPrice: symbol === 'BTWUSDT' ? '100.1' : '100',
        priceChangePercent: symbol === 'BTWUSDT' ? '25.3' : String(10 - index),
        quoteVolume: symbol === 'COIN159USDT' ? '1000' : '10000000',
      })),
      { symbol: 'USDCUSDT', lastPrice: '1', priceChangePercent: '0', quoteVolume: '10000000' },
      { symbol: 'COIN2LUSDT', lastPrice: '1', priceChangePercent: '20', quoteVolume: '10000000' },
    ];
    const contracts = tickers.map(ticker => ({
      symbol: ticker.symbol, baseAsset: ticker.symbol.slice(0, -4), quoteAsset: 'USDT',
      status: 'TRADING', contractType: 'PERPETUAL',
    }));
    let requests = 0;
    let slackAttempts = 0;
    let slackSucceeds = false;
    const slackBodies: Array<{ channel: string; text: string; blocks?: unknown[] }> = [];
    globalThis.fetch = async (input, init) => {
      requests++;
      const url = new URL(String(input));
      if (url.hostname === 'slack.com') {
        slackAttempts++;
        assert.equal(init?.method, 'POST');
        const body = JSON.parse(String(init?.body)) as { channel: string; text: string; blocks?: unknown[] };
        slackBodies.push(body);
        assert.equal(body.channel, 'test-channel');
        return Response.json({ ok: slackSucceeds });
      }
      assert.equal(url.hostname, 'fapi.binance.com');
      if (url.pathname.endsWith('/exchangeInfo')) return Response.json({ symbols: contracts });
      if (url.pathname.endsWith('/ticker/24hr')) return Response.json(tickers);
      if (url.pathname.endsWith('/markPriceKlines')) {
        const cutoff = Math.floor(Date.now() / PERP_BAR_MS) * PERP_BAR_MS;
        const candles = potentialFixture(cutoff, false, 400, PERP_BAR_MS);
        if (url.searchParams.get('symbol') === 'BTWUSDT') candles.at(-1)!.close = 100.1;
        return Response.json(candles.map(candle => [candle.openTime, String(candle.open), String(candle.high),
          String(candle.low), String(candle.close), '0']));
      }
      throw new Error(`非預期外部請求：${url.pathname}`);
    };
    const env: BinancePerpEnv = {
      DB: db, BINANCE_PERP_RADAR_ENABLED: 'true', SLACK_API_TOKEN: 'test-token', CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED: 'true', CRYPTO_ENTRY_SLACK_CHANNEL_ID: 'test-channel',
    };
    const cutoff = Math.floor(Date.now() / PERP_BAR_MS) * PERP_BAR_MS;
    const shardIndex = getPerpShardIndex('BTWUSDT', cutoff);
    await runBinancePerpRadar({ ...env, BINANCE_PERP_RADAR_ENABLED: 'false' }, shardIndex);
    assert.equal(requests, 0);
    await runBinancePerpRadar(env, shardIndex);
    let alerts = await db.prepare('SELECT * FROM binance_perp_alerts').all();
    assert.equal(alerts.results.length, 1);
    assert.equal(alerts.results[0].symbol, 'BTWUSDT');
    assert.equal(alerts.results[0].sent_at, null);
    assert.equal(slackAttempts, 1);
    assert.match(slackBodies[0].text, /BTWUSDT\.P/);
    assert.match(slackBodies[0].text, /經典吃大魚/);
    assert.match(slackBodies[0].text, /進場參考/);
    assert.ok(Array.isArray(slackBodies[0].blocks) && slackBodies[0].blocks.length >= 4);
    assert.match(JSON.stringify(slackBodies[0]), /Binance USDT 永續 Mark Price/);
    assert.match(JSON.stringify(slackBodies[0]), /同根仍為 Supertrend 紅色/);
    const summaryRow = await db.prepare('SELECT summary_json FROM binance_perp_run WHERE id = ?').bind('scan').first<{ summary_json: string }>();
    const summary = JSON.parse(summaryRow!.summary_json);
    assert.equal(summary.source, 'BINANCE');
    assert.equal(summary.shardIndex, shardIndex);
    assert.equal(summary.shardCount, 4);
    assert.equal(summary.eligible, 160);
    assert.equal(summary.selected, 32);
    assert.equal(summary.scanned, 32);
    assert.equal(summary.failed, 0);
    assert.equal(summary.signals, 1);
    assert.equal(summary.bestSignals, 0);
    /** 首輪只有兩個市場清單、三十二個 K 線和一次 Slack，仍低於免費 Worker 的 50 次外部請求。 */
    assert.ok(requests <= 35, `${requests} 個外部請求超出預算`);
    const bestMessage = serializeSlackCard(createCryptoSignalCard({
      icon: '⭐', title: 'BESTUSDT.P｜經典吃大魚', signal: '最佳型 · 底部紅轉綠',
      price: '1 USDT', closedAt: '測試收盤', invalidation: '0.9 USDT',
      strength: '測試最佳型優先順序', risk: '測試資料', source: 'Gate 測試',
    }));
    const currentBarTime = Number(alerts.results[0].bar_time);
    await db.prepare('INSERT INTO binance_perp_alerts (id, symbol, bar_time, detected_at, message, sent_at) VALUES (?, ?, ?, ?, ?, NULL)')
      .bind('GATE:BESTUSDT:test', 'BESTUSDT', currentBarTime, Date.now(), bestMessage).run();
    await db.prepare('INSERT INTO binance_perp_alerts (id, symbol, bar_time, detected_at, message, sent_at) VALUES (?, ?, ?, ?, ?, NULL)')
      .bind('GATE:OLDUSDT:test', 'OLDUSDT', currentBarTime - PERP_BAR_MS, Date.now() - PERP_BAR_MS,
        '歷史訊號不得補送').run();
    const beforeRetry = requests;
    slackSucceeds = true;
    await runBinancePerpNotificationQueue(env);
    alerts = await db.prepare('SELECT * FROM binance_perp_alerts').all();
    /** 舊批次已刪除；同一最新批次先送最佳型，再送原始候選。 */
    assert.equal(alerts.results.length, 2);
    assert.equal(alerts.results.filter(row => typeof row.sent_at === 'number').length, 1);
    assert.equal(slackAttempts, 2);
    assert.match(slackBodies[1].text, /BESTUSDT\.P/);
    /** 五分鐘通知工作只呼叫 Slack，不應重新抓 Gate 市場清單或 K 線。 */
    assert.equal(requests, beforeRetry + 1);
    await runBinancePerpNotificationQueue(env);
    assert.equal((await db.prepare('SELECT * FROM binance_perp_alerts WHERE sent_at IS NOT NULL').all()).results.length, 2);
    assert.equal(slackAttempts, 3);
    assert.match(slackBodies[2].text, /BTWUSDT\.P/);
    await runBinancePerpNotificationQueue(env);
    assert.equal(slackAttempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});
