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

test('資料有缺口時自動改用下一個來源，而非讓下游整檔停判', async () => {
  const originalFetch = globalThis.fetch;
  const interval = intervalToMs('4h');
  // 往前推 4 根，確保回傳的兩根(含跳過中間一根的缺口)都已收盤、不會被未收盤過濾掉
  const latest = Math.floor(Date.now() / interval) * interval - interval * 4;
  const hosts: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      // Bybit 回傳有缺口的資料(跳過中間一根)
      if (url.hostname === 'api.bybit.com') {
        return Response.json({ retCode: 0, retMsg: 'OK', result: { list: [
          [String(latest), '100', '102', '99', '101', '10'],
          [String(latest + interval * 2), '101', '103', '100', '102', '11'],
        ] } });
      }
      // Gate.io 回傳連續資料 [秒, 額, 收, 高, 低, 開, 量, 已收盤]
      return Response.json([
        [`${latest / 1000}`, '0', '101', '102', '99', '100', '10', 'true'],
        [`${(latest + interval) / 1000}`, '0', '102', '103', '100', '101', '11', 'true'],
      ]);
    };
    const result = await fetchBinanceRange('ETHUSDT', '4h', latest, latest + interval * 2, 1, { requireContiguous: true });
    // 主來源(Bybit)資料不連續 → 必須改用 Gate.io
    assert.equal(result.source, 'GATE_SPOT');
    assert.ok(hosts.includes('api.bybit.com'));
    assert.ok(hosts.includes('api.gateio.ws'));
    assert.deepEqual(result.candles.map(c => c.openTime), [latest, latest + interval]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('未要求連續性時不因缺口換源，避免歷史回測因交易所早期停機而整批失敗', async () => {
  const originalFetch = globalThis.fetch;
  const interval = intervalToMs('4h');
  const latest = Math.floor(Date.now() / interval) * interval - interval * 3;
  try {
    globalThis.fetch = async () => Response.json({ retCode: 0, retMsg: 'OK', result: { list: [
      [String(latest), '100', '102', '99', '101', '10'],
      [String(latest + interval * 2), '101', '103', '100', '102', '11'],
    ] } });
    const result = await fetchBinanceRange('ETHUSDT', '4h', latest, latest + interval * 2, 1);
    assert.equal(result.source, 'BYBIT_SPOT');
    assert.equal(result.candles.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
