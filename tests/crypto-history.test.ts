import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchBinanceRange, getCryptoKlineSource, intervalToMs } from '../app/services/marketData/binanceHistory';

test('ETH 歷史資料以 Bybit 現貨取得，依時間升冪整理並保留基礎幣成交量', async () => {
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  const interval = intervalToMs('4h');
  const latest = Math.floor(now / interval) * interval - interval * 2;
  let requestUrl = '';
  try {
    globalThis.fetch = async (input) => {
      requestUrl = String(input);
      return Response.json({ retCode: 0, retMsg: 'OK', result: { list: [
        [String(latest + interval), '101', '103', '100', '102', '22'],
        [String(latest), '100', '102', '99', '101', '11'],
      ] } });
    };
    const result = await fetchBinanceRange('ETHUSDT', '4h', latest, latest + interval, 1);
    assert.equal(result.source, 'BYBIT_SPOT');
    assert.match(requestUrl, /^https:\/\/api\.bybit\.com\/v5\/market\/kline\?/);
    assert.match(requestUrl, /category=spot/);
    assert.match(requestUrl, /interval=240/);
    assert.deepEqual(result.candles.map(c => c.openTime), [latest, latest + interval]);
    assert.deepEqual(result.candles.map(c => c.volume), [11, 22]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HYPE 固定使用 Binance.US 現貨，避免被誤當成 Binance 永續資料', async () => {
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  const interval = intervalToMs('4h');
  const latest = Math.floor(now / interval) * interval - interval * 2;
  let requestUrl = '';
  try {
    globalThis.fetch = async (input) => {
      requestUrl = String(input);
      return Response.json([[latest, '1', '2', '0.5', '1.5', '3']]);
    };
    const result = await fetchBinanceRange('HYPEUSDT', '4h', latest, latest, 1);
    assert.equal(getCryptoKlineSource('HYPEUSDT'), 'BINANCE_US_SPOT');
    assert.equal(result.source, 'BINANCE_US_SPOT');
    assert.match(requestUrl, /^https:\/\/api\.binance\.us\/api\/v3\/klines\?/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
