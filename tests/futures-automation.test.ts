/** @file Demo 自動化授權、訊號去重、通知佇列與帳戶隔離檢查；合成行情、臨時 D1，所有外部 fetch 均攔截。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { users, paperTrades, cryptoAutoOrders } from '../app/db/schema';
import { getSession, commitSession } from '../app/utils/auth';
import { loader, action } from '../app/routes/api.futures-automation';
import { AUTO_HOUR, DEFAULT_AUTOMATION, demoAutomationEntryAllowed, validateAutomationInput } from '../app/services/cryptoFutures/automation';
import { validAutomationCandles } from '../app/services/cryptoFutures/automationCandles.server';
import { runFuturesDemoAutomation } from '../app/services/cryptoFutures/automation.server';
import { deliverAutomationNotifications } from '../app/services/cryptoFutures/automationNotifications.server';
import { processCryptoFuturesSignal } from '../app/services/cryptoAutoTrading/engine';
import { resetFuturesUniverseCache } from '../app/services/cryptoFutures/universe.server';

test('Demo 獨立政策不能啟用 LIVE／舊來源／研究候選，設定與快取拒絕錯誤輸入', async () => {
  assert.equal(validateAutomationInput({ ...DEFAULT_AUTOMATION, symbols: 'btcusdt, BTCUSDT，adausdt' }).symbols, 'BTCUSDT, ADAUSDT');
  for (const change of [{ symbols: '../BTCUSDT' }, { symbols: 'AUSDT,BUSDT,CUSDT,DUSDT,EUSDT,FUSDT' },
    { feePct: NaN }, { feePct: -1 }, { feePct: 1.001 }, { enabled: 'true' }, { strategyId: 'futures_rsi_pullback_research' }]) {
    assert.throws(() => validateAutomationInput({ ...DEFAULT_AUTOMATION, ...change }));
  }
  const env = { DB: { prepare() { throw new Error('禁止未授權查詢'); } } as any, CRYPTO_NEW_ENTRIES_ENABLED: 'false', CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED: 'true' };
  const signal = { id: 'synthetic', source: 'FUTURES_AUTO' as const, symbol: 'BTCUSDT', action: 'BUY' as const,
    intent: 'OPEN_LONG' as const, strategyId: 'futures_trend_retest', signalAt: Date.now(), referencePrice: 100, label: '合成測試' };
  assert.equal(demoAutomationEntryAllowed(env, signal.source, signal.strategyId, 'DEMO'), true);
  await processCryptoFuturesSignal(env, signal, 1, 'LIVE');
  await processCryptoFuturesSignal(env, signal, 1);
  await processCryptoFuturesSignal(env, { ...signal, source: 'INTERNAL' }, 1, 'DEMO');
  await processCryptoFuturesSignal(env, { ...signal, strategyId: 'futures_rsi_pullback_research' }, 1, 'DEMO');
  await processCryptoFuturesSignal(env, { ...signal, signalAt: Date.now() - 6 * 60_000 }, 1, 'DEMO');
  await assert.rejects(processCryptoFuturesSignal(env, signal, 1, 'DEMO'), /禁止未授權查詢/);
});

test('真實 D1 模擬：同根只通知一次、行情失敗不造訊號、API 隔離帳戶且停止不受操作冷卻阻擋', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: { DB: 'automation-test' } });
  const db = await mf.getD1Database('DB'), fetchBefore = globalThis.fetch, clockBefore = Date.now;
  let now = Date.UTC(2026, 9, 13, 18, 1), slackCalls = 0, marketUnavailable = false;
  const slackTexts: string[] = [];
  const closedAt = Math.floor(now / AUTO_HOUR) * AUTO_HOUR, end = closedAt - AUTO_HOUR;
  try {
    for (const table of [users, paperTrades, cryptoAutoOrders]) {
      const config = getTableConfig(table);
      const columns = config.columns.map(column => `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`).join(',');
      await db.prepare(`CREATE TABLE "${config.name}" (${columns})`).run();
    }
    for (const name of ['0024_crypto_futures_rate_limits.sql', '0025_futures_demo_automation.sql', '0026_futures_live_automation.sql', '0027_futures_test_budget.sql']) {
      const sql = (await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
      await db.batch(sql.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => db.prepare(statement)));
    }
    await db.prepare("INSERT INTO users(id,email,password_hash,capital_base_usdt,max_risk_per_trade_pct,max_position_size_pct,bitget_demo_max_leverage) VALUES(1,'one@example.test','fake','1000','0.25','5',3),(2,'two@example.test','fake','1000','0.25','5',3)").run();
    await db.prepare("INSERT INTO crypto_futures_automation(user_id,enabled,symbols_json,updated_at) VALUES(1,1,'[\"BTCUSDT\"]',?)").bind(now).run();
    const bars = Array.from({ length: 834 }, (_, i) => {
      const price = 100 + i * 0.1;
      return { openTime: end - (833 - i) * AUTO_HOUR, open: price, close: price, high: price + 1, low: price - 1, volume: 1000 };
    });
    [[182.9, 185.2, 182.8, 185], [185, 185.1, 183.8, 184.4], [184.4, 184.6, 183.9, 184.2], [184.2, 185.2, 184, 185]]
      .forEach(([open, high, low, close], i) => Object.assign(bars[830 + i], { open, high, low, close }));
    assert.equal(validAutomationCandles(bars, end), true);
    assert.equal(validAutomationCandles(bars.slice(1), end - AUTO_HOUR), false);
    assert.equal(validAutomationCandles(bars.filter((_, i) => i !== 500), end), false);
    await db.prepare('INSERT INTO crypto_futures_automation_candles(symbol,candles_json,updated_at) VALUES(?,?,?)').bind('BTCUSDT', JSON.stringify(bars), now).run();
    Date.now = () => now;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === 'https://slack.com/api/chat.postMessage') { slackCalls++; slackTexts.push(JSON.parse(String(init?.body)).text); return Response.json({ ok: true }); }
      assert.ok(url.startsWith('https://api.bitget.com/api/v2/mix/market/'), '不得呼叫任何交易端點');
      if (marketUnavailable) return Response.json({ cloudflare: 'block' }, { status: 403 });
      const contract = { symbol: 'BTCUSDT', symbolStatus: 'normal', volumePlace: '3', pricePlace: '2', minTradeNum: '0.001', sizeMultiplier: '0.001', minTradeUSDT: '5', minLever: '1', maxLever: '50', takerFeeRate: '0.0006' };
      const data = url.includes('query-position-lever') ? [{ startUnit: '0', endUnit: '100000000', keepMarginRate: '0.004', leverage: '50' }]
        : url.includes('current-fund-rate') ? [{ symbol: 'BTCUSDT', fundingRate: '0', fundingRateInterval: '8', nextUpdate: String(now + AUTO_HOUR) }]
        : url.includes('merge-depth') ? { bids: [['184.99', '100000']], asks: [['185.01', '100000']] }
        : url.includes('ticker') ? [{ lastPr: '185', markPrice: '185', usdtVolume: '100000000' }] : [contract];
      return Response.json({ code: '00000', data });
    };
    const env = { DB: db as any, SESSION_SECRET: 'synthetic-test-secret', CRYPTO_NEW_ENTRIES_ENABLED: 'false',
      CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED: 'true', SLACK_API_TOKEN: 'fake-token', CRYPTO_FUTURES_TRADE_SLACK_CHANNEL_ID: 'fake-channel' };
    await runFuturesDemoAutomation(env);
    const event = await db.prepare('SELECT * FROM crypto_futures_automation_events').first<any>();
    assert.ok(event, '合成的確認訊號必須被保存');
    assert.equal(event.intent, 'OPEN_LONG'); assert.equal(event.notification_status, 'SENT'); assert.equal(event.order_status, 'BLOCKED');
    assert.equal(slackCalls, 1);
    await runFuturesDemoAutomation(env); assert.equal(slackCalls, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM crypto_futures_automation_events').first<any>()).n, 1);
    await db.prepare("UPDATE crypto_futures_automation_events SET order_reason=?,notification_status='PENDING',next_attempt_at=0 WHERE id=?").bind('Bitget <@UFAKE> & broken', event.id).run();
    await deliverAutomationNotifications(env);
    assert.ok(slackTexts.at(-1)!.includes('&lt;@UFAKE&gt; &amp; broken'));
    assert.ok(!slackTexts.at(-1)!.includes('<@'));
    const cookie = async (id: number) => {
      const session = await getSession(new Request('https://app.example.test/'), env); session.set('userId', id);
      return (await commitSession(session, env)).split(';')[0];
    };
    const context = { cloudflare: { env } } as any;
    assert.equal((await loader({ request: new Request('https://app.example.test/api/futures-automation'), context, params: {} } as any)).status, 401);
    assert.equal((await loader({ request: new Request('https://app.example.test/api/futures-automation'), context: { cloudflare: { env: { DB: db } } }, params: {} } as any)).status, 503);
    const own = await (await loader({ request: new Request('https://app.example.test/api/futures-automation', { headers: { Cookie: await cookie(1) } }), context, params: {} } as any)).json();
    assert.equal(own.events.length, 1); assert.equal(own.hasDemo, false); assert.ok(!JSON.stringify(own).includes('fake-token'));
    const other = await (await loader({ request: new Request('https://app.example.test/api/futures-automation', { headers: { Cookie: await cookie(2) } }), context, params: {} } as any)).json();
    assert.equal(other.events.length, 0);
    const request = async (origin: string, body: unknown) => new Request('https://app.example.test/api/futures-automation', { method: 'POST',
      headers: { Cookie: await cookie(1), Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await action({ request: await request('https://attacker.example', { operation: 'stop' }), context, params: {} } as any)).status, 403);
    await db.prepare('INSERT INTO crypto_futures_rate_limits(user_id,next_at) VALUES(1,?)').bind(now + 60_000).run();
    assert.equal((await action({ request: await request('https://app.example.test', { operation: 'stop' }), context, params: {} } as any)).status, 200);
    assert.equal((await db.prepare('SELECT enabled FROM crypto_futures_automation WHERE user_id=1').first<any>()).enabled, 0);
    await db.prepare('UPDATE crypto_futures_automation SET enabled=1 WHERE user_id=1').run();
    now += AUTO_HOUR; marketUnavailable = true;
    await runFuturesDemoAutomation(env);
    assert.match((await db.prepare('SELECT last_error FROM crypto_futures_automation WHERE user_id=1').first<any>()).last_error, /403/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM crypto_futures_automation_events').first<any>()).n, 1);
    assert.equal(slackCalls, 2);
  } finally { globalThis.fetch = fetchBefore; Date.now = clockBefore; await mf.dispose(); }
});

test('全市場掃描：持倉商品優先、清除舊狀態，窗口外暖機失敗只記原因不每分鐘重抓', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: { DB: 'universe-test' } });
  const db = await mf.getD1Database('DB'), fetchBefore = globalThis.fetch, clockBefore = Date.now;
  /** 收盤後十分鐘，已超過五分鐘訊號窗口，只會暖機不會判斷進場。 */
  let now = Date.UTC(2026, 9, 13, 18, 10);
  const closedAt = Math.floor(now / AUTO_HOUR) * AUTO_HOUR, end = closedAt - AUTO_HOUR;
  const candleCalls: string[] = [];
  resetFuturesUniverseCache();
  try {
    for (const table of [users, paperTrades, cryptoAutoOrders]) {
      const config = getTableConfig(table);
      await db.prepare(`CREATE TABLE "${config.name}" (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}`).join(',')})`).run();
    }
    for (const name of ['0024_crypto_futures_rate_limits.sql', '0025_futures_demo_automation.sql', '0026_futures_live_automation.sql', '0027_futures_test_budget.sql']) {
      const sql = (await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
      await db.batch(sql.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => db.prepare(statement)));
    }
    await db.prepare("INSERT INTO users(id,email,password_hash) VALUES(1,'one@example.test','fake')").run();
    await db.prepare(`INSERT INTO crypto_futures_automation(user_id,enabled,symbols_json,strategy_id,scan_state_json,updated_at)
      VALUES(1,1,'["*"]','futures_big_fish',?,?)`).bind(JSON.stringify({ 'futures_big_fish:OLDUSDT': { bar: closedAt - AUTO_HOUR, reason: '舊商品' } }), now).run();
    /** 本系統 Demo 持倉的商品已跌出成交額門檻，仍須排第一個檢查出場。 */
    await db.prepare(`INSERT INTO paper_trades(user_id,mode,market,exchange,symbol,side,status,entry_price,amount,stop_loss_price,reason)
      VALUES(1,'PAPER','CRYPTO','BITGET','HELDUSDT','BUY','OPEN','1','1','0.9','[BITGET_DEMO_AUTO:FUTURES_AUTO:x] 合成持倉')`).run();
    const bars = (last: number) => Array.from({ length: 834 }, (_, i) => ({ openTime: last - (833 - i) * AUTO_HOUR, open: 100, close: 100, high: 101, low: 99, volume: 1000 }));
    for (const symbol of ['BTCUSDT', 'HELDUSDT']) await db.prepare('INSERT INTO crypto_futures_automation_candles(symbol,candles_json,updated_at) VALUES(?,?,?)').bind(symbol, JSON.stringify(bars(end)), now).run();
    Date.now = () => now;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.ok(url.href.startsWith('https://api.bitget.com/api/v2/mix/market/'), '全市場掃描只能讀公開行情');
      if (url.pathname.endsWith('/tickers')) return Response.json({ code: '00000', data: [
        { symbol: 'NEWUSDT', usdtVolume: '90000000' }, { symbol: 'BTCUSDT', usdtVolume: '2000000000' }, { symbol: 'SMALLUSDT', usdtVolume: '100' }] });
      if (url.pathname.endsWith('/contracts')) return Response.json({ code: '00000', data: ['NEWUSDT', 'BTCUSDT', 'SMALLUSDT']
        .map(symbol => ({ symbol, symbolStatus: 'normal', symbolType: 'perpetual', quoteCoin: 'USDT' })) });
      /** 新上市商品歷史不足：交易所只回空 K 線，暖機必定失敗。 */
      if (url.pathname.endsWith('/history-candles')) { candleCalls.push(url.searchParams.get('symbol')!); return Response.json({ code: '00000', data: [] }); }
      return assert.fail(`未攔截的行情：${url.pathname}`);
    };
    const env = { DB: db as any, CRYPTO_NEW_ENTRIES_ENABLED: 'false', CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED: 'true' };
    await runFuturesDemoAutomation(env);
    const row = await db.prepare('SELECT scan_state_json,last_error FROM crypto_futures_automation WHERE user_id=1').first<any>();
    const checks = JSON.parse(row.scan_state_json);
    assert.deepEqual(Object.keys(checks), ['futures_big_fish:HELDUSDT', 'futures_big_fish:BTCUSDT', 'futures_big_fish:NEWUSDT'], '順序：持倉、已快取、未暖機；舊商品與低成交額商品不在清單');
    assert.match(checks['futures_big_fish:BTCUSDT'].reason, /暖機完成/);
    assert.match(checks['futures_big_fish:NEWUSDT'].reason, /^暫停：/);
    assert.match(row.last_error, /^NEWUSDT：/);
    assert.deepEqual(candleCalls, ['NEWUSDT']);
    now += 60_000;
    await runFuturesDemoAutomation(env);
    assert.deepEqual(candleCalls, ['NEWUSDT'], '同一小時窗口外不再重抓暖機失敗的商品');
  } finally { globalThis.fetch = fetchBefore; Date.now = clockBefore; resetFuturesUniverseCache(); await mf.dispose(); }
});
