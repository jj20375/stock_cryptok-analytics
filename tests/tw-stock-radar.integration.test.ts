/** @file 以暫存 D1 與攔截的 Yahoo／Slack 回應驗證台股排程；不連外、不發真實訊息。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { runTwStockRadar, type TwStockRadarEnv } from '../app/services/twStockRadar/scanner';
import { TW_STOCK_FOUR_HOUR_MS } from '../app/services/twStockRadar/types';

const fixedNow = Date.UTC(2026, 8, 16, 5, 34);

function tradingDays() {
  const days: number[] = [];
  for (let cursor = Date.UTC(2026, 8, 16, 1); days.length < 180; cursor -= 86_400_000) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) days.unshift(cursor);
  }
  return days;
}

function yahooChart(symbol: string, interval: string) {
  const days = tradingDays();
  const isHourly = interval === '1h';
  const timestamps = isHourly
    ? days.flatMap(day => Array.from({ length: 5 }, (_, index) => Math.floor((day + index * 60 * 60_000) / 1000)))
    : days.map(day => Math.floor(day / 1000));
  const closes = timestamps.map((_, index) => isHourly
    ? (symbol !== '0050.TW' && index === timestamps.length - 1 ? 100.1 : 100)
    : 80 + index * 0.1);
  return { chart: { result: [{ meta: { shortName: symbol, symbol }, timestamp: timestamps, indicators: { quote: [{
    open: closes, high: closes.map(close => close + 1), low: closes.map(close => close - 1),
    close: closes, volume: closes.map(() => 1_000_000),
  }] } }] } };
}

test('台股排程保存快照，卡片只送獨立頻道，且同一收盤段不重建事件', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: ['DB'] });
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  try {
    Date.now = () => fixedNow;
    const db = await mf.getD1Database('DB');
    const migration = await readFile(new URL('../drizzle/0017_tw_stock_radar.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(statement => db.prepare(statement.trim())));
    let yahooRequests = 0;
    let slackRequests = 0;
    const slackBodies: Array<{ channel: string; text: string; blocks?: unknown[] }> = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'slack.com') {
        slackRequests++;
        const body = JSON.parse(String(init?.body)) as { channel: string; text: string; blocks?: unknown[] };
        slackBodies.push(body);
        return Response.json({ ok: true });
      }
      if (url.hostname === 'www.twse.com.tw') return Response.json({ tables: [] });
      yahooRequests++;
      const symbol = decodeURIComponent(url.pathname.split('/').at(-1)!);
      return Response.json(yahooChart(symbol, url.searchParams.get('interval') || '1d'));
    };
    const env: TwStockRadarEnv = {
      DB: db, TW_STOCK_RADAR_ENABLED: 'true', SLACK_API_TOKEN: 'token',
      TW_STOCK_SLACK_CHANNEL_ID: 'tw-stock-channel',
    };
    await runTwStockRadar(env);
    const snapshots = await db.prepare('SELECT * FROM tw_stock_radar').all();
    const observations = await db.prepare('SELECT * FROM tw_stock_observations').all();
    const notifications = await db.prepare('SELECT * FROM tw_stock_radar_notifications').all();
    const run = await db.prepare('SELECT summary_json FROM tw_stock_radar_run WHERE id = ?').bind('scan').first<{ summary_json: string }>();
    assert.equal(snapshots.results.length, 10, run?.summary_json);
    assert.equal(observations.results.length, 10);
    assert.equal(notifications.results.length, 10);
    assert.equal(slackRequests, 3);
    assert.ok(slackBodies.every(body => body.channel === 'tw-stock-channel'));
    assert.ok(slackBodies.every(body => /經典吃大魚.*NT\$/s.test(body.text)));
    assert.ok(slackBodies.every(body => Array.isArray(body.blocks) && body.blocks.length >= 4));
    const latestBarTime = Number(notifications.results[0].bar_time);
    await db.prepare('INSERT INTO tw_stock_radar_notifications (id, symbol, bar_time, detected_at, message, sent_at) VALUES (?, ?, ?, ?, ?, NULL)')
      .bind('OLD:fixture', 'OLD.TW', latestBarTime - TW_STOCK_FOUR_HOUR_MS,
        Date.now() - TW_STOCK_FOUR_HOUR_MS, '歷史訊號不得補送').run();
    const requestsAfterFirstScan = yahooRequests;
    await runTwStockRadar(env);
    assert.equal((await db.prepare('SELECT * FROM tw_stock_radar_notifications').all()).results.length, 10);
    assert.equal(slackRequests, 6);
    /** 同一收盤段只抓 0050 判斷 barTime 並補送佇列，不重抓十檔台股歷史。 */
    assert.equal(yahooRequests, requestsAfterFirstScan + 1);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});
