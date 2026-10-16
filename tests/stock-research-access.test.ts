import assert from 'node:assert/strict';
import test from 'node:test';
import { loader as themesLoader } from '../app/routes/stock-themes';
import { loader as analysisLoader } from '../app/routes/api.analyze-stock';
import { getSession, commitSession } from '../app/utils/auth';

test('未登入不讀取外部資料；登入後無效代號與市場在呼叫來源和 AI 前被拒絕', async () => {
  const env = { SESSION_SECRET: 'stock-research-test-only' };
  const context = { cloudflare: { env } };
  const args = (url: string, cookie?: string) => ({
    request: new Request(`https://example.test${url}`, { headers: cookie ? { Cookie: cookie } : {} }),
    params: {}, context,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('不應呼叫外部服務'); };
  try {
    await assert.rejects(themesLoader(args('/stock-themes') as never), (error: unknown) =>
      error instanceof Response && error.status === 302 && error.headers.get('Location') === '/login');
    assert.equal((await analysisLoader(args('/api/analyze-stock?symbol=2330') as never)).status, 401);
    const session = await getSession(new Request('https://example.test'), env);
    session.set('userId', 1);
    const cookie = (await commitSession(session, env)).split(';')[0];
    const invalid = await themesLoader(args('/stock-themes?symbol=AAPL', cookie) as never);
    assert.equal(invalid.research, null);
    assert.ok(invalid.error);
    for (const query of ['symbol=2330&market=bad', 'symbol=../../&market=TW', 'symbol=AAPL&market=TW']) {
      const response = await analysisLoader(args(`/api/analyze-stock?${query}`, cookie) as never);
      assert.equal(response.status, 400);
    }
  } finally { globalThis.fetch = originalFetch; }
});
