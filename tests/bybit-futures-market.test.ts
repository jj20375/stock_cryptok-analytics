/** @file Bybit 永續公開資料的合成回應檢查，不呼叫真實交易或帳戶 API。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bybitFundingRange, bybitFuturesCandlesPage, bybitFuturesMetadata } from '../app/services/cryptoFutures/bybitMarket.server';
import { futuresCacheKey } from '../app/services/cryptoFutures/market.server';
import { HOUR_MS } from '../app/services/strategy/futuresRegime';

test('Bybit 永續資料依時間排序，並正確拆出成交價、標記價、資金費與合約規格', async () => {
  const original = globalThis.fetch, nowHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  const older = nowHour - 4 * HOUR_MS, newer = nowHour - 3 * HOUR_MS;
  const requests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    let list: unknown[] = [];
    if (url.pathname.endsWith('/kline')) list = [[newer, '101', '103', '100', '102', '20'], [older, '99', '102', '98', '101', '10']];
    else if (url.pathname.endsWith('/mark-price-kline')) list = [[newer, '101', '103', '100', '102'], [older, '99', '102', '98', '101']];
    else if (url.pathname.endsWith('/funding/history')) list = [
      { fundingRateTimestamp: String(newer), fundingRate: '0.0002' }, { fundingRateTimestamp: String(older), fundingRate: '0.0001' },
    ];
    else if (url.pathname.endsWith('/instruments-info')) list = [{ symbol: 'BTCUSDT', status: 'Trading', fundingInterval: '480',
      leverageFilter: { minLeverage: '1', maxLeverage: '100' },
      lotSizeFilter: { minOrderQty: '0.001', minNotionalValue: '5', qtyStep: '0.001' } }];
    else if (url.pathname.endsWith('/risk-limit')) list = [
      { symbol: 'BTCUSDT', riskLimitValue: '100000', maintenanceMargin: 0.01, maxLeverage: '50' },
      { symbol: 'BTCUSDT', riskLimitValue: '10000', maintenanceMargin: 0.005, maxLeverage: '100' },
    ];
    return Response.json({ retCode: 0, result: { list } });
  };
  try {
    const trades = await bybitFuturesCandlesPage('BTCUSDT', 'TRADE', older, newer);
    const marks = await bybitFuturesCandlesPage('BTCUSDT', 'MARK', older, newer);
    const funding = await bybitFundingRange('BTCUSDT', older, newer);
    const metadata = await bybitFuturesMetadata('BTCUSDT');
    assert.deepEqual(trades.map(row => row.openTime), [older, newer]);
    assert.deepEqual(marks.map(row => row.volume), [0, 0]);
    assert.deepEqual(funding.map(row => row.time), [newer, older]);
    assert.equal(metadata.fundingIntervalHours, 8);
    assert.equal(metadata.quantityStep, 0.001);
    assert.deepEqual(metadata.tiers.map(tier => [tier.min, tier.max, tier.maxLeverage]), [[0, 10000, 100], [10000, 100000, 50]]);
    assert.equal(futuresCacheKey('BTCUSDT', 'TRADE', 'BYBIT_USDT_PERP'), 'BYBIT:USDT-PERP:TRADE:BTCUSDT');
    assert.equal(futuresCacheKey('BTCUSDT', 'TRADE', undefined), 'BITGET:USDT-PERP:TRADE:BTCUSDT');
    assert.ok(requests.every(url => url.hostname === 'api.bybit.com' && url.searchParams.get('category') === 'linear'));
    assert.equal(requests.find(url => url.pathname.endsWith('/kline'))?.searchParams.get('interval'), '60');
  } finally { globalThis.fetch = original; }
});
