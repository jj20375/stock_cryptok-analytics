/** @file 驗證 TradingView 白名單與 Bitget Demo／LIVE 永續只開多、只平多。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closeBitgetDemoFuturesLong,
  configureBitgetDemoFuturesLong,
  fetchBitgetDemoFuturesAccount,
  fetchBitgetFuturesRules,
  placeBitgetDemoFuturesLong,
  placeBitgetFuturesLong,
} from '../app/services/bitgetService';
import {
  cryptoFuturesTradeSlackChannel,
  resolveDemoEffectiveLeverage,
  resolveFuturesExecutionMode,
} from '../app/services/cryptoAutoTrading/engine';
import { normalizeCryptoSymbol, tradingViewPayloadToAutoSignal } from '../app/services/cryptoAutoTrading/signal';

test('TradingView 永續代號可正規化成 Bitget USDT 永續，未知方向不進交易引擎', () => {
  assert.equal(normalizeCryptoSymbol('BINANCE:NEARUSDT.P'), 'NEARUSDT');
  assert.equal(normalizeCryptoSymbol('BRUSDT.P_MPRICE'), 'BRUSDT');
  assert.equal(normalizeCryptoSymbol('AAPL'), null);
  const receivedAt = Date.UTC(2026, 8, 21, 4, 0);
  assert.deepEqual(tradingViewPayloadToAutoSignal({
    symbol: 'BINANCE:NEARUSDT.P', action: 'long', price: 4.392, time: '2026-09-21T04:00:00Z',
  }, receivedAt), {
    id: `tv:NEARUSDT:BUY:${Math.floor(receivedAt / 900_000)}`,
    source: 'TRADINGVIEW', symbol: 'NEARUSDT', action: 'BUY', signalAt: receivedAt,
    referencePrice: 4.392, label: 'TradingView 吃大魚訊號',
  });
  assert.equal(tradingViewPayloadToAutoSignal({ symbol: 'NEARUSDT', action: 'WAIT', price: 4.392 }, receivedAt), null);
});

test('Bitget Demo UTA 永續進場固定開多、原生停損且帶 paptrading:1', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let captured: { headers: Headers; body: Record<string, unknown> } | null = null;
    globalThis.fetch = async (_input, init) => {
      captured = {
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ code: '00000', data: { orderId: 'demo-order', clientOid: 'client-1' } });
    };
    const receipt = await placeBitgetDemoFuturesLong({
      symbol: 'NEARUSDT', quantity: 2.345, quantityPrecision: 3,
      stopLossPrice: 4.1, pricePrecision: 4, clientOid: 'client-1',
      positionMode: 'hedge_mode', apiDialect: 'UTA_V3',
      apiKey: 'key', apiSecret: 'secret', passphrase: 'pass',
    });
    assert.equal(receipt.orderId, 'demo-order');
    assert.equal(captured?.headers.get('paptrading'), '1');
    /** 雙向持倉只送 posSide，不送 reduceOnly（單向模式才帶 reduceOnly=no）；未指定保證金模式時預設逐倉。 */
    assert.deepEqual(captured?.body, {
      category: 'USDT-FUTURES', symbol: 'NEARUSDT', marginMode: 'isolated', qty: '2.345', side: 'buy', posSide: 'long',
      orderType: 'market', clientOid: 'client-1', stopLoss: '4.1000',
      slTriggerBy: 'mark', slOrderType: 'market',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Bitget LIVE 永續只開多且不帶 Demo paptrading header', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let captured: { headers: Headers; body: Record<string, unknown> } | null = null;
    globalThis.fetch = async (_input, init) => {
      captured = { headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return Response.json({ code: '00000', data: { orderId: 'live-order', clientOid: 'live-client' } });
    };
    const receipt = await placeBitgetFuturesLong({
      environment: 'LIVE', symbol: 'NEARUSDT', quantity: 1.2, quantityPrecision: 2,
      stopLossPrice: 4.1, pricePrecision: 3, clientOid: 'live-client',
      positionMode: 'one_way_mode', apiDialect: 'CLASSIC_V2',
      apiKey: 'live-key', apiSecret: 'live-secret', passphrase: 'live-pass',
    });
    assert.equal(receipt.orderId, 'live-order');
    assert.equal(captured?.headers.has('paptrading'), false);
    assert.equal(captured?.body.side, 'buy');
    assert.equal(captured?.body.tradeSide, 'open');
    assert.equal(captured?.body.presetStopLossPrice, '4.100');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('正式合約需 LIVE 模式、專用三把金鑰與總實戰授權；關閉授權仍允許平倉', () => {
  const base = {
    bitgetFuturesExecutionMode: 'LIVE', liveTradingEnabled: false,
    bitgetDemoApiKey: 'demo-key', bitgetDemoApiSecret: 'demo-secret', bitgetDemoPassphrase: 'demo-pass',
    bitgetFuturesLiveApiKey: 'live-key', bitgetFuturesLiveApiSecret: 'live-secret',
    bitgetFuturesLivePassphrase: 'live-pass',
  } as const;
  assert.equal(resolveFuturesExecutionMode(base), null);
  assert.equal(resolveFuturesExecutionMode({ ...base, liveTradingEnabled: true }), 'LIVE');
  assert.equal(resolveFuturesExecutionMode({ ...base, bitgetFuturesLiveApiSecret: null, liveTradingEnabled: true }), null);
  assert.equal(resolveFuturesExecutionMode(base, 'LIVE', 'SELL'), 'LIVE');
  assert.equal(resolveFuturesExecutionMode({ ...base, bitgetFuturesExecutionMode: 'DEMO' }), 'DEMO');
});

test('Bitget USDT 永續規格提供張數步進、價格精度與最低門檻', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({
      code: '00000',
      data: [{
        symbol: 'NEARUSDT', volumePlace: '3', pricePlace: '4', minTradeNum: '0.1',
        sizeMultiplier: '0.001', minTradeUSDT: '5', minLever: '1', maxLever: '20', symbolStatus: 'normal',
      }],
    });
    assert.deepEqual(await fetchBitgetFuturesRules('NEARUSDT'), {
      symbol: 'NEARUSDT', quantityPrecision: 3, pricePrecision: 4,
      minTradeQuantity: 0.1, sizeMultiplier: 0.001, minTradeUsdt: 5, minLeverage: 1, maxLeverage: 20,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Bitget Demo 帳戶查詢使用 UTA 簽名 GET，並辨識雙向持倉模式', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let captured: { method?: string; headers: Headers; url: string } | null = null;
    globalThis.fetch = async (input, init) => {
      captured = { method: init?.method, headers: new Headers(init?.headers), url: String(input) };
      return Response.json({ code: '00000', data: {
        holdMode: 'hedge_mode',
        symbolConfigList: [{ category: 'USDT-FUTURES', symbol: 'NEARUSDT', marginMode: 'isolated' }],
      } });
    };
    assert.deepEqual(await fetchBitgetDemoFuturesAccount('NEARUSDT', 'key', 'secret', 'pass'), {
      positionMode: 'hedge_mode', marginMode: 'isolated', apiDialect: 'UTA_V3',
    });
    assert.equal(captured?.method, 'GET');
    assert.equal(captured?.headers.get('paptrading'), '1');
    assert.match(captured?.url || '', /\/api\/v3\/account\/settings$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Bitget Demo UTA 出場只平多，不會送出反手空單', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (url.endsWith('/api/v3/account/settings')) {
        return Response.json({ code: '00000', data: { holdMode: 'hedge_mode', symbolConfigList: [] } });
      }
      return Response.json({ code: '00000', data: { orderId: 'close-1', clientOid: 'server-1' } });
    };
    const receipt = await closeBitgetDemoFuturesLong('NEARUSDT', '2.345', 'key', 'secret', 'pass');
    assert.equal(receipt.orderId, 'close-1');
    const order = requests[1];
    assert.match(order?.url || '', /\/api\/v3\/trade\/place-order$/);
    assert.deepEqual({ ...order?.body, clientOid: 'dynamic' }, {
      category: 'USDT-FUTURES', symbol: 'NEARUSDT', qty: '2.345', side: 'sell',
      posSide: 'long', orderType: 'market', clientOid: 'dynamic',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Bitget Demo UTA 雙向持倉只設定多單為逐倉指定槓桿，不修改空單槓桿', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    globalThis.fetch = async (input, init) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body)) };
      return Response.json({ code: '00000', data: { longLeverage: '1', marginMode: 'isolated' } });
    };
    await configureBitgetDemoFuturesLong(
      'NEARUSDT', { positionMode: 'hedge_mode', marginMode: 'isolated', apiDialect: 'UTA_V3' },
      50, 'key', 'secret', 'pass',
    );
    assert.match(captured?.url || '', /\/api\/v3\/account\/set-leverage$/);
    assert.deepEqual(captured?.body, {
      category: 'USDT-FUTURES', symbol: 'NEARUSDT', marginMode: 'isolated', posSide: 'long',
      longLeverage: '50',
    });
    assert.equal('shortLeverage' in (captured?.body || {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Bitget Demo UTA 環境不符時安全回退 Classic V2，兩次都維持 paptrading', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const requests: Array<{ url: string; paptrading: string | null }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, paptrading: new Headers(init?.headers).get('paptrading') });
      if (url.endsWith('/api/v3/account/settings')) {
        return Response.json({ code: '40099', msg: 'exchange environment is incorrect' });
      }
      return Response.json({ code: '00000', data: { posMode: 'one_way_mode', marginMode: 'isolated' } });
    };
    assert.deepEqual(await fetchBitgetDemoFuturesAccount('BTCUSDT', 'key', 'secret', 'pass'), {
      positionMode: 'one_way_mode', marginMode: 'isolated', apiDialect: 'CLASSIC_V2',
    });
    assert.match(requests[0]?.url || '', /\/api\/v3\/account\/settings$/);
    assert.match(requests[1]?.url || '', /\/api\/v2\/mix\/account\/account\?/);
    assert.deepEqual(requests.map(request => request.paptrading), ['1', '1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Bitget Demo UTA 與 Classic 都拒絕時回傳可操作的金鑰環境提示', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ code: '40099', msg: 'exchange environment is incorrect' });
    await assert.rejects(
      () => fetchBitgetDemoFuturesAccount('BTCUSDT', 'key', 'secret', 'pass'),
      /請先切換 Bitget「Demo Trading」模式/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('槓桿取使用者 50 倍上限與合約最大值的較小者，資料異常回退 1 倍', () => {
  assert.equal(resolveDemoEffectiveLeverage(50, { minLeverage: 1, maxLeverage: 20 }), 20);
  assert.equal(resolveDemoEffectiveLeverage(12, { minLeverage: 1, maxLeverage: 50 }), 12);
  assert.equal(resolveDemoEffectiveLeverage('not-a-number', { minLeverage: 1, maxLeverage: 50 }), 1);
  assert.throws(
    () => resolveDemoEffectiveLeverage(1, { minLeverage: 2, maxLeverage: 50 }),
    /最低槓桿為 2 倍/,
  );
});

test('合約成交優先發往獨立頻道，未設定時才相容既有虛擬幣頻道', () => {
  assert.equal(cryptoFuturesTradeSlackChannel({
    DB: {} as any, CRYPTO_FUTURES_TRADE_SLACK_CHANNEL_ID: ' C-FUTURES ', CRYPTO_ENTRY_SLACK_CHANNEL_ID: 'C-ENTRY',
  }), 'C-FUTURES');
  assert.equal(cryptoFuturesTradeSlackChannel({ DB: {} as any, CRYPTO_ENTRY_SLACK_CHANNEL_ID: ' C-ENTRY ' }), 'C-ENTRY');
  assert.equal(cryptoFuturesTradeSlackChannel({ DB: {} as any }), null);
});
