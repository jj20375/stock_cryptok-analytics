/** @file 以攔截的 Gate／Slack 回應與暫存 D1 驗證永續吃大魚排程；不連外、不發送真實訊息。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { runBinancePerpNotificationQueue, runBinancePerpRadar, type BinancePerpEnv } from '../app/services/binancePerpRadar/scanner';
import { selectPerpCandidates } from '../app/services/binancePerpRadar/market';
import { PERP_QUARTER_MS, type PerpTicker } from '../app/services/binancePerpRadar/types';
import { createCryptoSignalCard, serializeSlackCard } from '../app/services/slack/cryptoSignalCard';
import { potentialFixture } from './helpers/potentialFixture';

test('候選優先涵蓋高漲幅、深跌反轉與高成交額，並限制三十二檔且輪替去重', () => {
  const cutoff = Date.UTC(2026, 8, 15, 2, 30);
  const universe: PerpTicker[] = Array.from({ length: 60 }, (_, index) => ({
    symbol: `COIN${index}USDT`, baseAsset: `COIN${index}`, price: 100,
    change24h: index === 1 ? -35.88 : index,
    quoteVolume24h: index === 0 ? 999_000_000 : 10_000_000 + index,
  }));
  const selected = selectPerpCandidates(universe, cutoff);
  assert.equal(selected.length, 32);
  assert.equal(new Set(selected.map(item => item.symbol)).size, 32);
  assert.ok(selected.some(item => item.symbol === 'COIN59USDT'));
  assert.ok(selected.some(item => item.symbol === 'COIN0USDT'));
  /** BR 類大跌後翻綠不能再只靠輪替碰運氣。 */
  assert.ok(selected.some(item => item.symbol === 'COIN1USDT'));
  assert.notDeepEqual(selected, selectPerpCandidates(universe, cutoff + PERP_QUARTER_MS));
});

test('BTW Mark Price 進場會寫入 Slack 佇列；失敗後同根補送且不重複', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  const originalFetch = globalThis.fetch;
  try {
    const db = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0015_binance_perp_radar.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(statement => db.prepare(statement.trim())));
    const validSymbols = ['BTWUSDT', ...Array.from({ length: 35 }, (_, index) => `COIN${index}USDT`)];
    const tickers = [
      ...validSymbols.map((symbol, index) => ({
        contract: `${symbol.slice(0, -4)}_USDT`, mark_price: symbol === 'BTWUSDT' ? '100.1' : '100',
        change_percentage: symbol === 'BTWUSDT' ? '25.3' : String(10 - index),
        volume_24h_quote: symbol === 'COIN34USDT' ? '1000' : '10000000',
      })),
      { contract: 'USDC_USDT', mark_price: '1', change_percentage: '0', volume_24h_quote: '10000000' },
      { contract: 'COIN2L_USDT', mark_price: '1', change_percentage: '20', volume_24h_quote: '10000000' },
      { contract: 'AAPL_USDT', mark_price: '330', change_percentage: '5', volume_24h_quote: '10000000' },
    ];
    const contracts = tickers.map(ticker => ({ name: ticker.contract, status: 'trading', in_delisting: false,
      contract_type: ticker.contract === 'AAPL_USDT' ? 'stocks' : '' }));
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
      assert.equal(url.hostname, 'api.gateio.ws');
      if (url.pathname.endsWith('/contracts')) return Response.json(contracts);
      if (url.pathname.endsWith('/tickers')) return Response.json(tickers);
      if (url.pathname.endsWith('/candlesticks')) {
        const cutoff = Math.floor(Date.now() / PERP_QUARTER_MS) * PERP_QUARTER_MS;
        const candles = potentialFixture(cutoff, false, 400);
        if (url.searchParams.get('contract') === 'mark_BTW_USDT') candles.at(-1)!.close = 100.1;
        return Response.json(candles.map(candle => ({ t: candle.openTime / 1000, o: String(candle.open),
          h: String(candle.high), l: String(candle.low), c: String(candle.close) })));
      }
      throw new Error(`非預期外部請求：${url.pathname}`);
    };
    const env: BinancePerpEnv = {
      DB: db, BINANCE_PERP_RADAR_ENABLED: 'true', SLACK_API_TOKEN: 'test-token', CRYPTO_ENTRY_SLACK_CHANNEL_ID: 'test-channel',
    };
    await runBinancePerpRadar({ ...env, BINANCE_PERP_RADAR_ENABLED: 'false' });
    assert.equal(requests, 0);
    await runBinancePerpRadar(env);
    let alerts = await db.prepare('SELECT * FROM binance_perp_alerts').all();
    assert.equal(alerts.results.length, 1);
    assert.equal(alerts.results[0].symbol, 'BTWUSDT');
    assert.equal(alerts.results[0].sent_at, null);
    assert.equal(slackAttempts, 1);
    assert.match(slackBodies[0].text, /BTWUSDT\.P/);
    assert.match(slackBodies[0].text, /經典吃大魚/);
    assert.match(slackBodies[0].text, /進場參考/);
    assert.ok(Array.isArray(slackBodies[0].blocks) && slackBodies[0].blocks.length >= 4);
    assert.match(JSON.stringify(slackBodies[0]), /Gate USDT 永續 Mark Price/);
    assert.match(JSON.stringify(slackBodies[0]), /同根仍為 Supertrend 紅色/);
    const summaryRow = await db.prepare('SELECT summary_json FROM binance_perp_run WHERE id = ?').bind('scan').first<{ summary_json: string }>();
    const summary = JSON.parse(summaryRow!.summary_json);
    assert.equal(summary.eligible, 35);
    assert.equal(summary.selected, 32);
    assert.equal(summary.scanned, 32);
    assert.equal(summary.failed, 0);
    assert.equal(summary.signals, 1);
    assert.equal(summary.bestSignals, 0);
    /** 首輪只有兩個市場清單、三十二個 K 線和一次 Slack，仍為正式 Worker 保留資料庫請求餘裕。 */
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
      .bind('GATE:OLDUSDT:test', 'OLDUSDT', currentBarTime - PERP_QUARTER_MS, Date.now() - PERP_QUARTER_MS,
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
