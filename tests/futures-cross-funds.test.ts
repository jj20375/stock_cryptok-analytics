/** @file 全倉資金／模式測試只使用假資料與攔截請求，不會觸及交易所帳戶。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCrossFunds, crossEntryCheck } from '../app/services/cryptoFutures/crossFunds.server';
import { configureBitgetFuturesLong, placeBitgetFuturesLong } from '../app/services/bitgetService';
import { validateAutomationInput, DEFAULT_AUTOMATION } from '../app/services/cryptoFutures/automation';

test('全倉本金只取 USDT；缺值／借款拒絕，其他抵押幣不放大資金', () => {
  const data = { effEquity: '5000', imr: '300', mmr: '5', assets: [
    { coin: 'BTC', equity: '1', available: '1', debt: '0' }, { coin: 'USDT', equity: '1000', available: '900', debt: '0' }] };
  const funds = parseCrossFunds(data, 'UTA_V3');
  assert.deepEqual(funds, { equityUsdt: 1000, availableUsdt: 900, maintenanceUsdt: 5 });
  assert.throws(() => parseCrossFunds({ ...data, imr: undefined }, 'UTA_V3'));
  assert.throws(() => parseCrossFunds({ ...data, assets: [{ coin: 'USDT', equity: '1000', available: '900', debt: '1' }] }, 'UTA_V3'));
  assert.throws(() => parseCrossFunds({ marginCoin: 'USDT', assetMode: 'union' }, 'CLASSIC_V2'));
  assert.deepEqual(parseCrossFunds({ marginCoin: 'USDT', assetMode: 'single', accountEquity: '1000', available: '980', crossedMaxAvailable: '900', crossedRiskRate: '.01' }, 'CLASSIC_V2'),
    { equityUsdt: 1000, availableUsdt: 900, maintenanceUsdt: 10 });
  const tiers = [{ min: 0, max: 100000, rate: .004, maxLeverage: 75 }];
  assert.equal(crossEntryCheck(funds, 50, 10, 2, .0006, tiers), null);
  assert.match(crossEntryCheck({ ...funds, availableUsdt: 1 }, 50, 10, 2, .0006, tiers)!, /可用 USDT 不足/);
  for (const change of [{ positionPct: 5.1 }, { positionPct: 2.9 }, { maxOpenPositions: 4 }, { maxOpenPositions: 1.5 }]) {
    assert.throws(() => validateAutomationInput({ ...DEFAULT_AUTOMATION, ...change }));
  }
});

test('UTA／Classic 全倉用共用 leverage，開多／空委託均明確指定 crossed', async () => {
  const previous = globalThis.fetch, calls: Array<{ path: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://api.bitget.com');
    const body = JSON.parse(String(init?.body)); calls.push({ path: url.pathname, body });
    return Response.json({ code: '00000', data: url.pathname.endsWith('place-order') ? { orderId: 'fake-order', clientOid: body.clientOid } : 'success' });
  };
  try {
    for (const apiDialect of ['UTA_V3', 'CLASSIC_V2'] as const) {
      await configureBitgetFuturesLong('LIVE', 'BTCUSDT', { apiDialect, positionMode: 'hedge_mode', marginMode: 'isolated' }, 75,
        'fake-key', 'fake-secret', 'fake-pass', 'short', 'crossed');
      const leverage = calls.at(-1)!.body; assert.equal(leverage.leverage, '75');
      assert.equal(leverage.shortLeverage, undefined); assert.equal(leverage.longLeverage, undefined);
      await placeBitgetFuturesLong({ environment: 'LIVE', symbol: 'BTCUSDT', quantity: .001, quantityPrecision: 3, stopLossPrice: 110,
        pricePrecision: 2, positionMode: 'hedge_mode', apiDialect, clientOid: 'synthetic', positionSide: 'short', marginMode: 'crossed',
        apiKey: 'fake-key', apiSecret: 'fake-secret', passphrase: 'fake-pass' });
      assert.equal(calls.at(-1)!.body.marginMode, 'crossed'); assert.equal(calls.at(-1)!.body.side, 'sell');
    }
  } finally { globalThis.fetch = previous; }
});
