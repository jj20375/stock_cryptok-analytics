import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialEvidence, financialNumber, listedStocks, parseFinancialRows, rocDate, type FinancialTable } from '../app/services/stockResearch/financials';
import { parsePublicPrograms } from '../app/services/stockResearch/programs';
import { fetchPublicSource, PUBLIC_SOURCES } from '../app/services/stockResearch/sources.server';
import { fetchPublicResearch, stockResearchContext } from '../app/services/stockResearch/research.server';

const now = Date.parse('2026-10-15T04:00:00Z');
const tables: FinancialTable[] = [
  { market: 'TWSE', kind: 'revenue', source: { ...PUBLIC_SOURCES.twRevenue, fetchedAt: '2026-10-15T04:00:00Z', status: 'ok' }, rows: [{
    '公司代號': '2330', '公司名稱': '台積電', '資料年月': '11509', '出表日期': '1151014',
    '營業收入-當月營收': '1,000', '營業收入-去年同月增減(%)': '0', '營業收入-上月比較增減(%)': '-5.5', '累計營業收入-前期比較增減(%)': '--',
  }] },
  { market: 'TWSE', kind: 'income', source: { ...PUBLIC_SOURCES.twIncome, fetchedAt: '2026-10-15T04:00:00Z', status: 'ok' }, rows: [{
    '公司代號': '2330', '公司名稱': '台積電', '年度': '115', '季別': '2', '出表日期': '1151015',
    '營業收入': '2000', '營業毛利（毛損）淨額': '1000', '營業利益（損失）': '700', '基本每股盈餘（元）': '0',
  }] },
  { market: 'TPEX', kind: 'revenue', source: { ...PUBLIC_SOURCES.otcRevenue, fetchedAt: '2026-10-15T04:00:00Z', status: 'ok' }, rows: [{
    '公司代號': '3105', '公司名稱': '穩懋', '資料年月': '11509', '出表日期': '1151015',
  }] },
  { market: 'TPEX', kind: 'income', source: { ...PUBLIC_SOURCES.otcIncome, fetchedAt: '2026-10-15T04:00:00Z', status: 'ok' }, rows: [{
    SecuritiesCompanyCode: '3105', CompanyName: '穩懋', Year: '115', Season: '2', Date: '1151015',
    '營業收入': '0', '營業毛利（毛損）淨額': '-100', '基本每股盈餘（元）': '-1.2',
  }] },
];
const anchor = (title: string, id = 'abcdefghijk', program = '28') => `<a data-subject="${title}" data-youtube="${id}" data-program="${program}" data-url="javascript:alert(1)"></a>`;

test('官方數值保留零與負數、缺值不補零，民國日期檢查真實日曆', () => {
  assert.equal(financialNumber('0'), 0);
  assert.equal(financialNumber('-1,234.50'), -1234.5);
  for (const value of ['', ' ', '--', 'N/A', 'Infinity', '1abc']) assert.equal(financialNumber(value), null);
  assert.equal(rocDate('11509', true), '2026-09');
  assert.equal(rocDate('1151015'), '2026-10-15');
  assert.equal(rocDate('1150230'), null);
  assert.equal(rocDate('11513', true), null);
  assert.throws(() => parseFinancialRows('<html>登入</html>'));
  assert.throws(() => parseFinancialRows('[{"公司代號":"2330","公司名稱":null}]'));
  assert.deepEqual(parseFinancialRows(JSON.stringify(tables[0].rows)), tables[0].rows);
});

test('台股營收千元與累計 EPS 分開，毛利率分母為營收，上櫃英文欄位可讀取', () => {
  const tw = buildFinancialEvidence('2330', tables, now);
  assert.equal(tw.market, 'TWSE');
  assert.equal(tw.revenue?.revenueThousandTwd, 1000);
  assert.equal(tw.revenue?.yoyPct, 0);
  assert.equal(tw.revenue?.cumulativeYoyPct, null);
  assert.equal(tw.income?.cumulativeEpsTwd, 0);
  assert.equal(tw.income?.year, 2026);
  assert.equal(tw.income?.quarter, 2);
  assert.equal(tw.income?.grossMarginPct, 50);
  assert.equal(tw.income?.operatingMarginPct, 35);
  const otc = buildFinancialEvidence('3105.TWO', tables, now);
  assert.equal(otc.market, 'TPEX');
  assert.equal(otc.income?.cumulativeEpsTwd, -1.2);
  assert.equal(otc.income?.grossMarginPct, null);
  assert.equal(otc.income?.exportedAt, '2026-10-15');
  assert.equal(buildFinancialEvidence('2330.TWO', tables, now).revenue, null);
});

test('資料缺漏、過期與多個期間分別處理，不把出表時間當財報期間', () => {
  const oldTables = structuredClone(tables);
  oldTables[0].rows.push({ ...oldTables[0].rows[0], '資料年月': '11401', '出表日期': '1151015' });
  assert.equal(buildFinancialEvidence('2330', oldTables, now).revenue?.period, '2026-09');
  assert.equal(buildFinancialEvidence('9999', [], now).warnings.length, 2);
  oldTables[0].rows = [oldTables[0].rows[1]];
  assert.match(buildFinancialEvidence('2330', oldTables, now).warnings.join(' '), /100 天/);
  oldTables[1].rows[0]['年度'] = '114';
  assert.match(buildFinancialEvidence('2330', oldTables, now).warnings.join(' '), /270 天/);
});

test('只擷取公開單元且去重，忽略會員區、完整版、未來與過期節目，不信任來源網址', () => {
  const html = [anchor('《AI 台積電》20261014-1非凡財經新聞'), anchor('《AI 台積電》20261014-2非凡財經新聞', 'abcdefghij2'),
    anchor('20261014完整版 台積電', 'abcdefghij3'), anchor('台積電20261016-1', 'abcdefghij4'),
    anchor('台積電20260901-1', 'abcdefghij5'), anchor('台積電20260230-1', 'abcdefghij6'),
    anchor('台積電無日期', 'abcdefghij7'), anchor('台積電20261014-3', 'abcdefghij8', '37'),
    '<div class="member">台積電會員圖卡</div>'].join('');
  const programs = parsePublicPrograms(html, listedStocks(tables), now);
  assert.equal(programs.length, 1);
  assert.equal(programs[0].url, 'https://news.ustv.com.tw/program/28/abcdefghijk');
  assert.equal(programs[0].videoUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.deepEqual(programs[0].themes, ['AI／資料中心']);
  assert.deepEqual(programs[0].stocks.map(stock => stock.code), ['2330']);
});

test('股票日期不亂配，兩字名稱保守辨識，未知供應鏈不產生股票名單，解碼不執行 HTML', () => {
  const stocks = [...listedStocks(tables), { code: '2026', name: '世界', symbol: '2026.TWO' }];
  const programs = parsePublicPrograms([
    anchor('《全世界關注PCB &amp; AI》20261014-1'),
    anchor('《世界、穩懋》20261014-2', 'abcdefghij2'),
    anchor('&#x53F0;&#x7A4D;&#x96FB; &lt;script&gt;20261014-3', 'abcdefghij3'),
    anchor('《匿名公司（3105）》20261014-4', 'abcdefghij4'),
  ].join(''), stocks, now);
  assert.equal(programs[0].stocks.length, 0);
  assert.deepEqual(programs[1].stocks.map(stock => stock.code), ['3105', '2026']);
  assert.equal(programs[2].stocks[0].code, '2330');
  assert.match(programs[2].title, /<script>/);
  assert.equal(programs[3].stocks[0].code, '3105');
});

test('台北跨日不誤刪當日節目', () => {
  assert.equal(parsePublicPrograms(anchor('台積電20261016-1'), [], Date.parse('2026-10-15T16:01:00Z')).length, 1);
});

test('公開來源合併並行請求，失敗獨立降級，AI 只取得該股標題', async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  const date = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10).replaceAll('-', '');
  globalThis.fetch = async input => {
    count++;
    const url = String(input);
    if (url === PUBLIC_SOURCES.programs.url) return new Response(anchor(`台積電AI ${date}-1`));
    if (url === PUBLIC_SOURCES.twRevenue.url) return new Response(JSON.stringify(tables[0].rows));
    if (url === PUBLIC_SOURCES.twIncome.url) return new Response('<html>來源改版</html>');
    if (url === PUBLIC_SOURCES.otcRevenue.url) return new Response('Forbidden', { status: 403 });
    throw new Error('來源離線');
  };
  try {
    await Promise.all([fetchPublicSource('programs'), fetchPublicSource('programs')]);
    assert.equal(count, 1);
    const research = await fetchPublicResearch('2330');
    assert.equal(count, 5);
    assert.equal(research.financials?.revenue?.revenueThousandTwd, 1000);
    assert.equal(research.financials?.income, null);
    assert.equal(research.sources.filter(source => source.status === 'unavailable').length, 3);
    assert.equal(JSON.parse(stockResearchContext(research)).titleMentions.length, 1);
    assert.equal(JSON.parse(stockResearchContext({ ...research, financials: { ...research.financials!, code: '3105' } })).titleMentions.length, 0);
    await fetchPublicResearch('3105');
    assert.equal(count, 5);
  } finally { globalThis.fetch = originalFetch; }
});
