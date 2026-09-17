/** @file 登入、過期訊號及頁面呈現測試；資料為離線合成範例。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
import PotentialRadarPage, { loader } from '../app/routes/potential-radar';
import { analyzePotential } from '../app/services/potentialRadar/analysis';
import { QUARTER_MS } from '../app/services/potentialRadar/types';
import { potentialFixture, healthyDepth, healthyDerivatives } from './helpers/potentialFixture';
import { RadarCard } from '../app/features/potentialRadar/RadarCards';

test('未登入不得讀取潛力幣雷達', async () => {
  await assert.rejects(() => loader({ request: new Request('https://example.test/potential-radar'),
    context: { cloudflare: { env: { SESSION_SECRET: 'test-only-session-secret' } } }, params: {},
  } as any), (error: unknown) => error instanceof Response && error.status === 302 && error.headers.get('Location') === '/login');
});

export async function renderPotentialPreview(stale = false) {
  const cutoff = Math.floor(Date.now() / QUARTER_MS) * QUARTER_MS;
  const signal = analyzePotential(potentialFixture(cutoff), potentialFixture(cutoff, false), healthyDepth);
  signal.derivatives = healthyDerivatives;
  const now = cutoff + (stale ? QUARTER_MS : 120_000);
  const data = { now, enabled: true, error: null, observations: [],
    run: { startedAt: cutoff + 120_000, completedAt: cutoff + 130_000, eligible: 45, selected: 12, scanned: 12, failed: 0, error: null },
    snapshots: [{ symbol: 'EXAMPLEUSDT', signal, checkedAt: cutoff + 120_000, error: null }],
  };
  const routes = [{ id: 'root', path: '/potential-radar', loader: () => data, Component: PotentialRadarPage }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request('https://example.test/potential-radar'));
  if (context instanceof Response) throw new Error('測試頁面不應重新導向');
  const router = createStaticRouter(routes, context);
  return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
}

test('呈現多週期依據、分數限制與空榜；上一根訊號不能留在最新候選卡片', async () => {
  const html = await renderPotentialPreview();
  assert.ok(html.includes('EXAMPLE'));
  assert.ok(html.includes('15 分成交額倍數'));
  assert.ok(html.includes('不是暴漲機率'));
  assert.ok(html.includes('分數構成與流動性'));
  assert.ok(html.includes('吃大魚進場'));
  assert.ok(html.includes('吃大魚 2.0 · 15 分線'));
  assert.ok(html.includes('趨勢共振 · 4h MA20＋日線 MA7'));
  assert.ok(html.includes('Gate 永續 · 健康趨勢'));
  assert.ok(html.includes('OI／近 1h'));
  assert.ok(html.includes('完整日線不足八根'));
  assert.ok(html.includes('條件績效'));
  assert.ok(html.includes('尚無可統計的入選樣本'));
  assert.ok(html.includes('K 線圖'));
  assert.ok(html.includes('動態防守線（ST）'));
  assert.ok(html.includes('牛熊生命線（EMA200）'));
  assert.ok(html.includes('<article'));
  const stale = await renderPotentialPreview(true);
  assert.ok(!stale.includes('<article'));
  assert.ok(stale.includes('目前沒有符合此分類的最新標的'));
  assert.ok(stale.includes('舊訊號不列榜'));
});

test('卡片分開呈現原始訊號與風控排除，舊快照不推定為未觸發', () => {
  const signal = analyzePotential(potentialFixture(Date.UTC(2026, 8, 14)), potentialFixture(Date.UTC(2026, 8, 14), false), healthyDepth);
  const snapshot = { symbol: 'EXAMPLEUSDT', signal, checkedAt: 0, error: null };
  const blocked = renderToStaticMarkup(createElement(RadarCard, { snapshot: { ...snapshot, signal: { ...signal, phase: 'EXTENDED' } } }));
  assert.ok(blocked.includes('原始進場條件成立，但漲幅過熱'));
  assert.ok(blocked.includes('提早進場與出場條件同時成立'));
  const legacy = renderToStaticMarkup(createElement(RadarCard, { snapshot: { ...snapshot, signal: { ...signal, bigFish: undefined } } }));
  assert.ok(legacy.includes('此筆尚未計算'));
  assert.ok(!legacy.includes('紅色趨勢 · 等待進場'));
});
