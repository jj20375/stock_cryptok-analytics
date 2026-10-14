/** @file TradingView 訊號績效頁的登入保護與伺服器端渲染；資料為離線合成範例。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
import TradingviewSignalsPage, { loader } from '../app/routes/tradingview-signals';
import type { TradeRecord } from '../app/services/tradingview/performance';

test('未登入不得讀取 TradingView 訊號績效', async () => {
  await assert.rejects(() => loader({ request: new Request('https://example.test/tradingview-signals'),
    context: { cloudflare: { env: { SESSION_SECRET: 'test-only-session-secret' } } }, params: {},
  } as any), (error: unknown) => error instanceof Response && error.status === 302 && error.headers.get('Location') === '/login');
});

const closedTrade: TradeRecord = {
  id: 'trade-closed', market: 'crypto', symbol: 'SOLUSDT', direction: 'LONG',
  entryAt: Date.UTC(2026, 8, 17, 4), entryPrice: 100, entryNote: '吃大魚進場',
  exitAt: Date.UTC(2026, 8, 17, 8), exitPrice: 110, returnPct: 10, closed: true,
};
const openTrade: TradeRecord = {
  id: 'trade-open', market: 'tw_stock', symbol: '2330', direction: 'LONG',
  entryAt: Date.UTC(2026, 8, 17, 5), entryPrice: 1000, entryNote: '吃大魚 2.0（台股）',
  exitAt: null, exitPrice: null, returnPct: null, closed: false,
};

const sampleSignals = [
  { id: 's1', receivedAt: Date.UTC(2026, 8, 17, 8), market: 'crypto', symbol: 'SOLUSDT',
    action: 'SELL', price: 110, status: 'ACCEPTED', slackOk: true,
    tradeEffect: '平倉，報酬 +10.00%', error: null },
  { id: 's2', receivedAt: Date.UTC(2026, 8, 17, 7), market: 'unknown', symbol: '未知',
    action: null, price: null, status: 'REJECTED_AUTH', slackOk: null,
    tradeEffect: null, error: '密鑰不符或未設定' },
];

async function renderPage(trades: TradeRecord[], signals = sampleSignals) {
  const data = {
    now: Date.UTC(2026, 8, 17, 9), signalRetentionDays: 60, tradeRetentionDays: 365,
    webhookEnabled: false, webhookConfigured: false, error: null, trades, signals,
  };
  const routes = [{ id: 'root', path: '/tradingview-signals', loader: () => data, Component: TradingviewSignalsPage }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request('https://example.test/tradingview-signals'));
  if (context instanceof Response) throw new Error('測試頁面不應重新導向');
  const router = createStaticRouter(routes, context);
  return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
}

test('呈現複利與等權重報酬、持倉中狀態，以及被拒絕的原始請求', async () => {
  const html = await renderPage([closedTrade, openTrade]);
  assert.ok(html.includes('累積報酬（複利）'));
  assert.ok(html.includes('+10.00%'));
  assert.ok(html.includes('每筆固定金額'.slice(0, 4)) || html.includes('等權重'));
  assert.ok(html.includes('持倉中'));
  assert.ok(html.includes('SOLUSDT'));
  assert.ok(html.includes('2330'));
  /** 未平倉的報酬欄必須是破折號，不能被當成 0%。 */
  assert.ok(html.includes('—'));
  assert.ok(html.includes('密鑰不符（已拒絕）'));
  assert.ok(html.includes('未扣手續費'));
  assert.ok(html.includes('新的台股、美股訊號由系統雷達自行計算'));
});

test('完全沒有交易時不顯示假的 0%，並說明配對條件', async () => {
  const html = await renderPage([], []);
  assert.ok(html.includes('目前沒有符合篩選條件的交易'));
  assert.ok(html.includes('收到對應的出場訊號才會計算報酬'));
  assert.ok(html.includes('尚未收到任何 TradingView 請求'));
  /** 沒有樣本時所有報酬欄位都必須是破折號，不得把缺值顯示成 0%。 */
  assert.ok(!html.includes('%</strong>') || !/[0-9]\.\d\d%<\/strong>/.test(html));
});
