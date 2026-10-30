/**
 * @file 股票產業分類與 AI／趨勢題材標籤測試
 * 涵蓋證交所 OpenAPI 解析、Nasdaq 篩選器解析、多層次題材命中（人工字典、關鍵字、AI 補完）與徽章格式化。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyStockTheme, normalizeThemeSymbol } from '../app/services/stockThemes/classifier';
import { parseTwseCompanies, parseNasdaqScreener } from '../app/services/stockThemes/industrySources.server';
import { formatThemeBadge, summarizeThemeDistribution, resolveStockThemes } from '../app/services/stockThemes/profileService.server';

test('台股代號正規化與證交所產業代碼解析', () => {
  assert.equal(normalizeThemeSymbol('TW', '2330.TW'), '2330');
  assert.equal(normalizeThemeSymbol('TW', '3105.TWO'), '3105');
  assert.equal(normalizeThemeSymbol('TW', '2454'), '2454');

  const twseMock = [
    { 公司代號: '2330', 產業別: '24', 公司簡稱: '台積電' },
    { 公司代號: '2317', 產業別: '25', 公司簡稱: '鴻海' },
    { 公司代號: '2603', 產業別: '15', 公司簡稱: '長榮' },
    { 公司代號: '999999', 產業別: '', 公司簡稱: '無效資料' },
  ];

  const map = parseTwseCompanies(twseMock);
  assert.equal(map.get('2330')?.industry, '半導體業');
  assert.equal(map.get('2317')?.industry, '電腦及週邊設備');
  assert.equal(map.get('2603')?.industry, '航運業');
  assert.equal(map.has('999999'), false);
});

test('Nasdaq 篩選器資料解析與英文 Sector 中文化', () => {
  assert.equal(normalizeThemeSymbol('US', 'BRK.B'), 'BRKB');
  assert.equal(normalizeThemeSymbol('US', 'NVDA'), 'NVDA');

  const nasdaqMock = {
    data: {
      rows: [
        { symbol: 'NVDA', sector: 'Technology', industry: 'Semiconductors' },
        { symbol: 'VRT', sector: 'Industrials', industry: 'Electrical Equipment' },
        { symbol: 'KO', sector: 'Consumer Staples', industry: 'Beverages: Soft Drinks' },
      ],
    },
  };

  const map = parseNasdaqScreener(nasdaqMock);
  assert.equal(map.get('NVDA')?.industry, '科技・Semiconductors');
  assert.equal(map.get('VRT')?.industry, '工業・Electrical Equipment');
  assert.equal(map.get('KO')?.industry, '必需消費・Beverages: Soft Drinks');
});

test('台股 AI 核心、供應鏈、熱門趨勢與傳統產業分級判定', () => {
  // 台積電：AI 核心 (晶圓代工)
  const tsmc = classifyStockTheme({
    market: 'TW',
    symbol: '2330.TW',
    name: '台積電',
    industry: '半導體業',
    industrySource: 'TWSE',
  });
  assert.equal(tsmc.aiRelevance, 'CORE');
  assert.ok(tsmc.themeLabels.some(l => l.includes('AI 晶片/晶圓代工')));
  assert.equal(formatThemeBadge(tsmc), '【半導體業 ｜ 🤖 AI 核心 · AI 晶片/晶圓代工】');

  // 奇鋐：AI 供應鏈 (散熱)
  const avc = classifyStockTheme({
    market: 'TW',
    symbol: '3017.TW',
    name: '奇鋐',
    industry: '電子零組件',
    industrySource: 'TWSE',
  });
  assert.equal(avc.aiRelevance, 'RELATED');
  assert.ok(avc.themeLabels.some(l => l.includes('AI 散熱')));
  assert.equal(formatThemeBadge(avc), '【電子零組件 ｜ 🔌 AI 供應鏈 · AI 散熱】');

  // 昇達科：熱門趨勢 (低軌衛星)
  const satellite = classifyStockTheme({
    market: 'TW',
    symbol: '3491.TW',
    name: '昇達科',
    industry: '通信網路',
    industrySource: 'TWSE',
  });
  assert.equal(satellite.aiRelevance, 'TREND');
  assert.ok(satellite.themeLabels.some(l => l.includes('低軌衛星')));
  assert.equal(formatThemeBadge(satellite), '【通信網路 ｜ 🔥 熱門趨勢 · 低軌衛星/太空】');

  // 長榮海運：傳統產業
  const ever = classifyStockTheme({
    market: 'TW',
    symbol: '2603.TW',
    name: '長榮',
    industry: '航運業',
    industrySource: 'TWSE',
  });
  assert.equal(ever.aiRelevance, 'NONE');
  assert.equal(ever.themeLabels.length, 0);
  assert.equal(formatThemeBadge(ever), '【航運業 ｜ 🏭 傳統產業】');
});

test('美股 AI 核心、AI 散熱用電、太空趨勢與傳統消費分級判定', () => {
  // NVDA：AI 核心
  const nvda = classifyStockTheme({
    market: 'US',
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    industry: '科技・Semiconductors',
    industrySource: 'NASDAQ',
  });
  assert.equal(nvda.aiRelevance, 'CORE');
  assert.equal(formatThemeBadge(nvda), '【科技・Semiconductors ｜ 🤖 AI 核心 · AI 晶片/晶圓代工】');

  // VRT (Vertiv)：AI 供應鏈 (散熱/液冷)
  const vrt = classifyStockTheme({
    market: 'US',
    symbol: 'VRT',
    name: 'Vertiv Holdings Co',
    industry: '工業・Electrical Equipment',
    industrySource: 'NASDAQ',
  });
  assert.equal(vrt.aiRelevance, 'RELATED');
  assert.equal(formatThemeBadge(vrt), '【工業・Electrical Equipment ｜ 🔌 AI 供應鏈 · AI 散熱】');

  // RKLB：熱門趨勢 (火箭/太空)
  const rklb = classifyStockTheme({
    market: 'US',
    symbol: 'RKLB',
    name: 'Rocket Lab USA, Inc.',
    industry: '工業・Aerospace',
    industrySource: 'NASDAQ',
  });
  assert.equal(rklb.aiRelevance, 'TREND');
  assert.equal(formatThemeBadge(rklb), '【工業・Aerospace ｜ 🔥 熱門趨勢 · 低軌衛星/太空】');

  // 可口可樂：傳統產業
  const ko = classifyStockTheme({
    market: 'US',
    symbol: 'KO',
    name: 'The Coca-Cola Company',
    industry: '必需消費・Beverages',
    industrySource: 'NASDAQ',
  });
  assert.equal(ko.aiRelevance, 'NONE');
  assert.equal(formatThemeBadge(ko), '【必需消費・Beverages ｜ 🏭 傳統產業】');
});

test('題材族群風向摘要統計', () => {
  const p1 = classifyStockTheme({ market: 'TW', symbol: '2330.TW', name: '台積電', industry: '半導體業', industrySource: 'TWSE' });
  const p2 = classifyStockTheme({ market: 'TW', symbol: '3017.TW', name: '奇鋐', industry: '電子零組件', industrySource: 'TWSE' });
  const p3 = classifyStockTheme({ market: 'TW', symbol: '3491.TW', name: '昇達科', industry: '通信網路', industrySource: 'TWSE' });
  const p4 = classifyStockTheme({ market: 'TW', symbol: '2603.TW', name: '長榮', industry: '航運業', industrySource: 'TWSE' });

  const summary = summarizeThemeDistribution([p1, p2, p3, p4]);
  assert.match(summary, /🤖 AI 核心 \(台積電\)/);
  assert.match(summary, /🔌 AI 供應鏈 \(奇鋐\)/);
  assert.match(summary, /🔥 熱門趨勢 \(昇達科\)/);
});

test('批次解析服務在查無公開資料時安全回退且標示未分類', async () => {
  const results = await resolveStockThemes(
    [{ symbol: 'UNKNOWN_TICKER', name: '未知標的' }],
    'US',
    {},
  );
  const profile = results.get('UNKNOWN_TICKER');
  assert.ok(profile);
  assert.equal(profile.industry, '未分類');
  assert.equal(profile.aiRelevance, 'NONE');
  assert.equal(formatThemeBadge(profile), '【未分類 ｜ 🏭 傳統產業】');
});

import { runStockDailyStrategy } from '../app/services/strategyEngine';

test('台股每日市場日報包含產業別與 AI 題材風向標籤', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const slackBodies: Array<{ channel: string; text: string }> = [];
  const errors: unknown[][] = [];

  try {
    console.error = (...args: unknown[]) => { errors.push(args); };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'slack.com') {
        slackBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true });
      }
      if (url.hostname === 'openapi.twse.com.tw') {
        return Response.json([
          { 公司代號: '2330', 產業別: '24', 公司簡稱: '台積電' },
          { 公司代號: '2603', 產業別: '15', 公司簡稱: '長榮' },
        ]);
      }
      if (url.hostname === 'www.twse.com.tw') {
        // MI_INDEX response
        return Response.json({
          tables: [
            {
              title: '每日收盤行情',
              data: [
                ['2330', '台積電', '50,000,000', '', '', '', '', '', '980', '▲', '20'],
                ['2603', '長榮', '30,000,000', '', '', '', '', '', '185', '▲', '5'],
              ],
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    };

    await runStockDailyStrategy({ SLACK_API_TOKEN: 'xoxb-test', SLACK_CHANNEL_ID: 'C_TW_TEST' }, 'TW', 'market');
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }

  const crash = errors.find(args => String(args[0]).includes('[runStockDailyStrategy]'));
  assert.equal(crash, undefined, `台股日報流程拋出例外：${crash?.map(String).join(' ')}`);
  assert.equal(slackBodies.length, 1);
  const [msg] = slackBodies;
  assert.equal(msg.channel, 'C_TW_TEST');
  assert.match(msg.text, /台股市場日報/);
  assert.match(msg.text, /產業與 AI 題材風向/);
  assert.match(msg.text, /半導體業 ｜ 🤖 AI 核心 · AI 晶片\/晶圓代工/);
  assert.match(msg.text, /航運業 ｜ 🏭 傳統產業/);
});
