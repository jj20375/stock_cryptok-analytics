/** @file 潛力幣圖表端點的輸入邊界與登入保護測試；不呼叫外部行情來源。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loader } from '../app/routes/api.potential-radar.chart';
import { parsePotentialChartRequest } from '../app/services/potentialRadar/chartRequest';

test('圖表請求只接受固定週期、已支援來源與 USDT 現貨格式', () => {
  assert.deepEqual(
    parsePotentialChartRequest(new URL('https://example.test/api/potential-radar/chart?symbol=BTCUSDT&interval=15m&source=GATE_SPOT')),
    { symbol: 'BTCUSDT', interval: '15m', source: 'GATE_SPOT' },
  );
  assert.equal(parsePotentialChartRequest(new URL('https://example.test/?symbol=btcUSDT&interval=15m&source=GATE_SPOT')), null);
  assert.equal(parsePotentialChartRequest(new URL('https://example.test/?symbol=BTCUSDT&interval=5m&source=GATE_SPOT')), null);
  assert.equal(parsePotentialChartRequest(new URL('https://example.test/?symbol=BTCUSDT&interval=15m&source=BINANCE_US_SPOT')), null);
});

test('未登入不得把圖表端點當成行情代理', async () => {
  const response = await loader({
    request: new Request('https://example.test/api/potential-radar/chart?symbol=BTCUSDT&interval=15m&source=BYBIT_SPOT'),
    context: { cloudflare: { env: { SESSION_SECRET: 'test-only-session-secret' } } }, params: {},
  } as any);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, '請先登入後再查看圖表。');
});
