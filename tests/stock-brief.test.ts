/** @file 選股參考資料回歸驗證；只使用測試資料與模擬來源，不操作帳戶或交易服務。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBriefSymbol, isTaiwanFund } from '../app/services/stockBrief/types';
import { parseStockNews, parseAnnouncements, parseTaiwanValuation, safeNewsUrl } from '../app/services/stockBrief/normalize';
import { fetchBriefSource } from '../app/services/stockBrief/source.server';
import { loader } from '../app/routes/api.stock-brief';
import { getSession, commitSession } from '../app/utils/auth';

const now = Date.parse('2026-10-15T09:00:00Z');
const source = { label: '證交所', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L', status: 'ok' as const, fetchedAt: new Date(now).toISOString() };
const item = (title: string, date = '2026-10-15T07:00:00Z', url = 'https://example.com/news') => `<item><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>${date}</pubDate><source>測試來源</source></item>`;

test('代號保留上櫃、ETF 字尾；拒絕跨市場與網址輸入', () => {
  assert.equal(normalizeBriefSymbol(' 3105.two ', 'TW'), '3105.TWO');
  assert.equal(normalizeBriefSymbol('00632R', 'TW'), '00632R.TW');
  assert.equal(normalizeBriefSymbol('brk-b', 'US'), 'BRK-B');
  for (const [symbol, market] of [['AAPL', 'TW'], ['2330.TW', 'US'], ['../2330', 'TW'], ['https://example.com', 'US'], ['BTCUSDT', 'CRYPTO']]) assert.equal(normalizeBriefSymbol(symbol, market), null);
  assert.equal(isTaiwanFund('0050.TW'), true);
  assert.equal(isTaiwanFund('020000.TW'), true);
  assert.equal(isTaiwanFund('2884.TW'), false);
});

test('台股 RSS 排除日本同代號、過期、未來、無日期及危險連結，標題去重並保留來源', () => {
  const xml = '<rss><channel><title>這不是新聞</title>' + [item('玉山金 &amp; 營收'), item('玉山金 &amp; 營收'),
    item('E. Sun (TPE:2884) earnings'), item('Yoshimura (TSE:2884) earnings'), item('玉山金', '2026-09-01'),
    item('玉山金', '2026-10-16'), item('玉山金', ''), item('玉山金', '2026-10-15', 'javascript:alert(1)')].join('') + '</channel></rss>';
  const rows = parseStockNews(xml, '2884.TW', '玉山金', 'TW', now);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, '玉山金 & 營收');
  assert.equal(rows[0].publisher, '測試來源');
  assert.equal(parseStockNews(item('Apple earnings'), 'AAPL', 'Apple', 'US', now).length, 1);
  assert.equal(parseStockNews(item('TSMC earnings'), '2330.TW', '台積電', 'TW', now, ['TSMC']).length, 1);
  assert.equal(parseStockNews(item('世界各國股市'), '5347.TWO', '世界', 'TW', now).length, 0);
  for (const value of ['http://example.com', 'https://127.0.0.1/a', 'https://user:pass@example.com/a', 'https://host.local/a']) assert.equal(safeNewsUrl(value), null);
});

test('公告依公司代號及台北發言時間顯示，支援上櫃欄位且不是出表時間', () => {
  const rows = [{ '公司代號': '2884', '出表日期': '1151015', '發言日期': '1151014', '發言時間': '70003', '主旨 ': '公告一' },
    { SecuritiesCompanyCode: '2884', '發言日期': '1151014', '發言時間': '130000', '主旨': '公告二' },
    { '公司代號': '2330', '發言日期': '1151014', '發言時間': '70003', '主旨 ': '他股公告' }];
  const items = parseAnnouncements(rows, '2884.TW', source, now);
  assert.equal(items.length, 2);
  assert.equal(items[0].publishedAt, '2026-10-14T05:00:00.000Z');
  assert.equal(items[1].publishedAt, '2026-10-13T23:00:03.000Z');
  assert.equal(parseAnnouncements([{ ...rows[0], '發言日期': 1151014 }], '2884.TW', source, now).length, 0);
});

test('官方估值殖利率已是百分點；保留零、缺值與真正資料日期', () => {
  const parsed = parseTaiwanValuation([{ Code: '2884', Name: '玉山金', Date: '1151014', PEratio: '', PBratio: '0', DividendYield: '3.5' }], '2884.TW', source);
  assert.equal(parsed?.valuation.pe, null);
  assert.equal(parsed?.valuation.pb, 0);
  assert.equal(parsed?.valuation.dividendYieldPct, 3.5);
  assert.equal(parsed?.valuation.asOf, '2026-10-14');
  assert.equal(parseTaiwanValuation([], '2884.TW', source), null);
  assert.equal(parseTaiwanValuation([{ Code: '2884', Date: 123, PEratio: {} }], '2884.TW', source)?.valuation.pe, null);
});

test('外部請求合併、失敗可降級；認證及參數失敗不得讀取來源', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('unavailable', { status: 503 }); };
  try {
    const results = await Promise.all([fetchBriefSource('測試', 'https://example.test/rss'), fetchBriefSource('測試', 'https://example.test/rss')]);
    assert.equal(calls, 1);
    assert.equal(results[0].source.status, 'unavailable');
    const env = { SESSION_SECRET: 'stock-brief-test-only' }, context = { cloudflare: { env } };
    const args = (query: string, cookie?: string) => ({ request: new Request(`https://example.test/api/stock-brief?${query}`, { headers: cookie ? { Cookie: cookie } : {} }), params: {}, context });
    assert.equal((await loader(args('symbol=2884.TW&market=TW') as never)).status, 401);
    const session = await getSession(new Request('https://example.test'), env);
    session.set('userId', 1);
    const cookie = (await commitSession(session, env)).split(';')[0];
    assert.equal((await loader(args('symbol=../../&market=TW', cookie) as never)).status, 400);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
