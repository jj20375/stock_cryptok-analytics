import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
import WaveRadarPage, { loader } from '../app/routes/wave-radar';
import { nextWaveSnapshot } from '../app/services/waveRadar/state';
import { WAVE_INTERVAL_MS } from '../app/services/strategy/strategies/cryptoWave';
import { waveFixture } from './helpers/waveFixture';

test('未登入不得讀取雷達資料', async () => {
  await assert.rejects(() => loader({ request: new Request('https://example.test/wave-radar'),
    context: { cloudflare: { env: { SESSION_SECRET: 'test-only-session-secret' } } }, params: {},
  } as any), (error: unknown) => error instanceof Response && error.status === 302 && error.headers.get('Location') === '/login');
});

export async function renderWavePreview(stale: boolean) {
  const candles = waveFixture();
  const snapshot = nextWaveSnapshot(candles, null);
  const data = { enabled: true, slack: false, pending: 0, error: null,
    now: candles.at(-1)!.openTime + WAVE_INTERVAL_MS * (stale ? 3 : 1),
    rows: [{ symbol: 'XRPUSDT', snapshotJson: JSON.stringify(snapshot), checkedAt: Date.now() }],
  };
  const routes = [{ id: 'root', path: '/wave-radar', loader: () => data, Component: WaveRadarPage }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request('https://example.test/wave-radar'));
  if (context instanceof Response) throw new Error('介面測試路由異常');
  const router = createStaticRouter(routes, context);
  return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
}

test('頁面包含所有指定幣、回測連結及翻倍目標限制；過期訊號不冒充啟動', async () => {
  const html = await renderWavePreview(false);
  for (const name of ['SUI', 'ASTER', 'ADA', 'DOGE', 'BNB', 'HYPE', 'XRP']) assert.ok(html.includes(name));
  assert.ok(html.includes('波段啟動'));
  assert.ok(html.includes('symbol=XRPUSDT&amp;strategyId=crypto_wave'));
  assert.ok(html.includes('不能相加當成投資組合報酬'));
  assert.ok(!(await renderWavePreview(true)).includes('波段啟動'));
});
