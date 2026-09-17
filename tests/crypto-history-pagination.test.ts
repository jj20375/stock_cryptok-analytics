/** @file 模擬交易所分頁語意，驗證長區間不漏前段、不超過單頁限制；不使用外部行情。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchBinanceRange, intervalToMs } from '../app/services/marketData/binanceHistory';

test('Bybit 由新到舊限量回傳時，仍完整取得 2500 根歷史而非只有最後 1000 根', async () => {
  const original = globalThis.fetch;
  const step = intervalToMs('15m');
  const start = Math.floor(Date.now() / step) * step - 3000 * step;
  const times = Array.from({ length: 2500 }, (_, i) => start + i * step);
  let calls = 0;
  try {
    globalThis.fetch = async input => {
      calls++;
      const url = new URL(String(input));
      const from = Number(url.searchParams.get('start')), to = Number(url.searchParams.get('end'));
      assert.ok(to - from < 1000 * step);
      return Response.json({ retCode: 0, result: { list: times.filter(t => t >= from && t <= to).reverse().slice(0, 1000)
        .map(t => [t, '100', '102', '99', '101', '10']) } });
    };
    const result = await fetchBinanceRange('BTCUSDT', '15m', start, times.at(-1)!, 4, { forcedSource: 'BYBIT_SPOT' });
    assert.equal(calls, 3);
    assert.equal(result.complete, true);
    assert.deepEqual(result.candles.map(c => c.openTime), times);
  } finally { globalThis.fetch = original; }
});

test('Gate 以時間窗分頁，不同送互斥的 limit，並回傳可續抓游標', async () => {
  const original = globalThis.fetch;
  const step = intervalToMs('4h');
  const start = Math.floor(Date.now() / step) * step - 3000 * step;
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.has('limit'), false);
      const from = Number(url.searchParams.get('from')) * 1000;
      const to = Number(url.searchParams.get('to')) * 1000;
      assert.ok(to - from < 1000 * step);
      return Response.json(Array.from({ length: 1000 }, (_, i) => [String((from + i * step) / 1000), '1000', '100', '101', '99', '100', '10', 'true']));
    };
    const result = await fetchBinanceRange('BTCUSDT', '4h', start, start + 2500 * step, 1, { forcedSource: 'GATE_SPOT' });
    assert.equal(result.complete, false);
    assert.equal(result.nextCursor, start + 1000 * step);
    assert.equal(result.candles.length, 1000);
  } finally { globalThis.fetch = original; }
});
