/** @file 驗證現貨辨識、平台成交額、已收盤雙週期、風控與時效；不連外、不下單。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStockToken, stockTokenPlanIssue } from '../app/services/stockTokenRadar/analysis';
import { loadStockTokenCandles, loadStockTokenInstruments, loadStockTokenQuotes, stockTokenQuoteIssue } from '../app/services/stockTokenRadar/market';
import { collectStockTokenReport } from '../app/services/stockTokenRadar/scanner';
import { stockTokenSlackCard } from '../app/services/stockTokenRadar/notifications';
import { loadStockTokenRadar, scanStockTokenRadar } from '../app/services/stockTokenRadar/loader.server';
import { HOUR_MS, STOCK_TOKEN_RULES as RULES } from '../app/services/stockTokenRadar/types';
import { tokenNow as now, tokenInstrument as instrument, tokenInstrumentRow, tokenFixture, tokenQuoteRow, tokenCandleRows } from './helpers/stockTokenFixture';

test('只接受明確美國現貨股票／ETF rToken；排除一般幣、永續、非美股與下架商品', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: '00000', data: [tokenInstrumentRow,
    { ...tokenInstrumentRow, symbol: 'BTCUSDT', baseCoin: 'BTC', isReality: 'no' },
    { ...tokenInstrumentRow, category: 'USDT-FUTURES' }, { ...tokenInstrumentRow, marketRegion: 'HK' },
    { ...tokenInstrumentRow, status: 'restrictedAPI' }, { ...tokenInstrumentRow, symbol: 'OTHERUSDT' },
    { ...tokenInstrumentRow, symbol: 'RQQQUSDT', baseCoin: 'rQQQ', instrumentType: 'etf' },
  ] }));
  assert.deepEqual((await loadStockTokenInstruments()).map(c => c.symbol), ['RAAPLUSDT', 'RQQQUSDT']);
});

test('缺平台成交額不能退回一般成交額，缺雙邊深度或逾期／未來報價拒絕', async t => {
  const { quote } = tokenFixture();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: '00000', data: [tokenQuoteRow(quote),
    { ...tokenQuoteRow(quote), platformTurnover24h: undefined }, { ...tokenQuoteRow(quote), ask1Size: '0' },
    { ...tokenQuoteRow(quote), bid1Price: '' },
  ] }));
  assert.equal((await loadStockTokenQuotes()).length, 1);
  assert.match(stockTokenQuoteIssue({ ...quote, turnover: 9e12, platformTurnover: 1 }, now)!, /平台/);
  assert.match(stockTokenQuoteIssue({ ...quote, spreadPct: 0.31 }, now)!, /價差/);
  assert.match(stockTokenQuoteIssue({ ...quote, timestamp: now - 120_001 }, now)!, /逾期/);
  assert.match(stockTokenQuoteIssue({ ...quote, timestamp: now + 5_001 }, now)!, /逾期/);
});

test('K線排序去重且排除未收盤，重複矛盾與空白價量拒絕', async t => {
  const fixture = tokenFixture(), rows = tokenCandleRows(fixture.hourly), open = Math.floor(now / HOUR_MS) * HOUR_MS;
  const mock = t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(String(input)); assert.equal(url.searchParams.get('category'), 'SPOT'); assert.equal(url.searchParams.get('type'), 'market');
    return Response.json({ code: '00000', data: [rows.at(-1), ...rows.slice().reverse(), [String(open), '100', '101', '99', '100', '100']] });
  });
  assert.deepEqual(await loadStockTokenCandles(instrument.symbol, '1H', now), fixture.hourly);
  mock.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: '00000', data: [rows[0], [rows[0][0], '100', '102', '99', '101', '100']] }));
  await assert.rejects(loadStockTokenCandles(instrument.symbol, '1H', now), /矛盾/);
});

test('4h多頭＋1h放量突破產生有期限、止損與2R目標；不把分數當勝率', () => {
  const fixture = tokenFixture(), result = analyzeStockToken(instrument, fixture.quote, fixture, now);
  assert.equal(result.status, 'ENTRY');
  const plan = result.plan!;
  assert.equal(plan.kind, 'BREAKOUT'); assert.equal(plan.closedAt, Math.floor(now / HOUR_MS) * HOUR_MS);
  assert.equal(plan.expiresAt, plan.closedAt + RULES.validityMs);
  assert.ok(plan.stopPrice < plan.entryLow && plan.entryHigh < plan.targetPrice);
  assert.ok(Math.abs(plan.targetPrice - plan.referencePrice - 2 * (plan.referencePrice - plan.stopPrice)) < 1e-9);
  assert.ok(plan.netRewardRisk >= 1.5); assert.ok(plan.riskPct <= 5);
  const card = stockTokenSlackCard(result);
  assert.match(card.text, /美股現貨代幣 rAAPL/); assert.match(JSON.stringify(card.blocks), /未驗證勝率/);
  assert.match(JSON.stringify(card.blocks), /平台24h額/);
});

test('雙週期不足、缺根、未收盤、量不足、趨勢反向、過期與追價皆不能入選', () => {
  const check = (mutate: (fixture: ReturnType<typeof tokenFixture>) => void) => {
    const fixture = tokenFixture(); mutate(fixture);
    assert.notEqual(analyzeStockToken(instrument, fixture.quote, fixture, now).status, 'ENTRY');
  };
  check(f => { f.fourHourly = f.fourHourly.slice(-20); });
  check(f => { f.hourly.splice(-4, 1); });
  check(f => { f.hourly.push({ ...f.hourly.at(-1)!, openTime: Math.floor(now / HOUR_MS) * HOUR_MS }); });
  check(f => { f.hourly.at(-1)!.volume = 1; });
  check(f => { f.fourHourly = f.fourHourly.map((c, i) => ({ ...c, open: 300 - i, close: 300 - i, high: 301 - i, low: 299 - i })); });
  check(f => { f.hourly.forEach(c => { c.openTime -= HOUR_MS; }); });
  check(f => { f.quote.ask += 5; });
  const fixture = tokenFixture(), plan = analyzeStockToken(instrument, fixture.quote, fixture, now).plan!;
  assert.match(stockTokenPlanIssue(plan, { ...fixture.quote, timestamp: plan.expiresAt }, plan.expiresAt)!, /過期/);
  assert.match(stockTokenPlanIssue(plan, { ...fixture.quote, ask: plan.entryHigh + 0.01 }, now)!, /追價/);
});

test('EMA20回踩轉強可獨立觸發；買一價雖在區間內仍須符合費後1.5R', () => {
  const fixture = tokenFixture();
  Object.assign(fixture.hourly.at(-2)!, { open: 102.6, close: 102.8, high: 102.9, low: 102.3 });
  Object.assign(fixture.hourly.at(-1)!, { open: 102.8, close: 103.1, high: 103.3, low: 102.6, volume: 120 });
  Object.assign(fixture.quote, { bid: 103.1, ask: 103.11 });
  const result = analyzeStockToken(instrument, fixture.quote, fixture, now);
  assert.equal(result.status, 'ENTRY'); assert.equal(result.plan!.kind, 'RETEST');
  assert.equal(result.volumeRatio, 1.2);
  const plan = result.plan!;
  assert.match(stockTokenPlanIssue(plan, { ...fixture.quote, bid: plan.entryHigh - 0.01, ask: plan.entryHigh }, now)!, /報酬風險比/);
});

test('掃描先用平台成交額篩選，缺行情列為失敗；不會拿BTC合約或Yahoo補足', async t => {
  const fixture = tokenFixture(); const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(String(input)); requested.push(url.href); assert.equal(url.hostname, 'api.bitget.com');
    if (url.pathname.endsWith('instruments')) return Response.json({ code: '00000', data: [tokenInstrumentRow,
      { ...tokenInstrumentRow, baseCoin: 'rTSLA', symbol: 'RTSLAUSDT' }] });
    if (url.pathname.endsWith('tickers')) return Response.json({ code: '00000', data: [tokenQuoteRow(fixture.quote),
      { ...tokenQuoteRow(fixture.quote), symbol: 'RTSLAUSDT', platformTurnover24h: '1' }] });
    assert.equal(url.searchParams.get('symbol'), 'RAAPLUSDT');
    return Response.json({ code: '00000', data: tokenCandleRows(url.searchParams.get('interval') === '1H' ? fixture.hourly : fixture.fourHourly) });
  });
  const report = await collectStockTokenReport(now);
  assert.equal(report.total, 2); assert.equal(report.eligible, 1); assert.equal(report.selected, 1);
  assert.equal(report.candidates[0].status, 'ENTRY'); assert.equal(requested.length, 4);
  assert.equal(Object.values(report.exclusions).reduce((a, b) => a + b, 0), 1);
});

test('跨站及缺Origin手動掃描在認證／資料庫／Slack副作用前拒絕', async () => {
  for (const origin of [undefined, 'https://attacker.example']) {
    const request = new Request('https://app.example/stock-token-radar', { method: 'POST', headers: origin ? { Origin: origin } : {} });
    await assert.rejects(scanStockTokenRadar({ request, context: {}, params: {}, unstable_url: new URL(request.url), unstable_pattern: '/stock-token-radar' }),
      (error: Response) => error.status === 403);
  }
});

test('未登入的頁面與同源手動掃描皆導向登入，不查D1或發通知', async () => {
  const request = new Request('https://app.example/stock-token-radar', { method: 'POST', headers: { Origin: 'https://app.example' } });
  const args = { request, context: { cloudflare: { env: { SESSION_SECRET: 'fixture-session-secret', DB: {
    prepare() { assert.fail('未登入不得存取D1'); },
  } } } }, params: {}, unstable_url: new URL(request.url), unstable_pattern: '/stock-token-radar' };
  const loginRedirect = (error: Response) => error.status === 302 && error.headers.get('Location') === '/login';
  await assert.rejects(loadStockTokenRadar(args), loginRedirect);
  await assert.rejects(scanStockTokenRadar(args), loginRedirect);
});
