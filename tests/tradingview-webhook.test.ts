/** @file 離線驗證 TradingView 市場分流、虛擬幣通知停用與快速回覆；所有 Slack 請求均攔截。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { action } from '../app/routes/api.webhook.tradingview';
import { resolveTradingviewMarket, tradingviewSlackChannel } from '../app/services/tradingview/market';

test('股票市場明示或交易所推斷後各走專屬頻道，未知市場不能誤進合約', () => {
  assert.equal(resolveTradingviewMarket({ market: ' US_STOCK ', symbol: 'AAPL' }), 'us_stock');
  assert.equal(resolveTradingviewMarket({ symbol: 'NASDAQ:AAPL' }), 'us_stock');
  assert.equal(resolveTradingviewMarket({ exchange: 'TWSE', symbol: '2330' }), 'tw_stock');
  assert.equal(resolveTradingviewMarket({ symbol: '2330.TW' }), 'tw_stock');
  assert.equal(resolveTradingviewMarket({ symbol: 'BINANCE:BTCUSDT.P' }), 'crypto');
  assert.equal(resolveTradingviewMarket({ market: 'us_stok', symbol: 'BTCUSDT' }), 'unknown');
  assert.equal(resolveTradingviewMarket({ symbol: 'AAPL' }), 'unknown');
  const env = { US_STOCK_SLACK_CHANNEL_ID: ' US ', TW_STOCK_SLACK_CHANNEL_ID: ' TW ', CRYPTO_ENTRY_SLACK_CHANNEL_ID: 'CRYPTO' };
  assert.equal(tradingviewSlackChannel(env, 'us_stock'), 'US');
  assert.equal(tradingviewSlackChannel(env, 'tw_stock'), 'TW');
  assert.equal(tradingviewSlackChannel(env, 'crypto'), null);
  assert.equal(tradingviewSlackChannel(env, 'unknown'), null);
});

const requestArgs = (payload: unknown, env: Record<string, unknown>, waitUntil?: (task: Promise<unknown>) => void) => ({
  request: new Request('https://example.test/api/webhook/tradingview/test-secret', { method: 'POST', body: JSON.stringify(payload) }),
  params: { secret: 'test-secret' },
  context: { cloudflare: { env: { TRADINGVIEW_WEBHOOK_ENABLED: 'true', TRADINGVIEW_WEBHOOK_SECRET: 'test-secret', ...env }, ctx: { waitUntil } } },
} as any);

test('美股與台股 Webhook 回覆不等待 Slack，背景通知價格幣別與頻道正確', async () => {
  const originalFetch = globalThis.fetch;
  const sent: Array<{ channel: string; text: string }> = [];
  let finishSlack!: () => void;
  const slowSlack = new Promise<void>(resolve => { finishSlack = resolve; });
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    await slowSlack;
    return Response.json({ ok: true });
  };
  const tasks: Promise<unknown>[] = [];
  try {
    for (const [market, symbol] of [['us_stock', 'AAPL'], ['tw_stock', '2330']]) {
      const response = await action(requestArgs({ market, symbol, action: 'BUY', price: 100 }, {
        SLACK_API_TOKEN: 'test-token', US_STOCK_SLACK_CHANNEL_ID: 'US', TW_STOCK_SLACK_CHANNEL_ID: 'TW',
      }, task => { tasks.push(task); }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).futuresQueued, false);
    }
    assert.deepEqual(sent.map(post => post.channel), ['US', 'TW']);
    assert.match(sent[0].text, /\$100/);
    assert.match(sent[1].text, /NT\$100/);
  } finally {
    finishSlack();
    await Promise.all(tasks);
    globalThis.fetch = originalFetch;
  }
});

test('虛擬幣通知預設停用、未知市場不推播，非 JSON 物件拒絕', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ ok: true }); };
  try {
    for (const payload of [{ symbol: 'BTCUSDT', action: '觀察' },
      { symbol: 'BTCUSDT', action: 'BUY', price: 100, market: 'crypto' },
      { symbol: '03314T', action: 'BUY', price: 100, market: 'tw_stock' },
      { market: 'wrong', symbol: 'AAPL', action: 'BUY' }]) {
      const response = await action(requestArgs(payload, { SLACK_API_TOKEN: 'test-token', CRYPTO_ENTRY_SLACK_CHANNEL_ID: 'CRYPTO' }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).futuresQueued, false);
    }
    assert.equal(requests, 0);
    for (const payload of [null, [], 'text']) assert.equal((await action(requestArgs(payload, {}))).status, 400);
    const badSecret = requestArgs({ market: 'us_stock', symbol: 'AAPL' }, {});
    badSecret.params.secret = 'wrong';
    assert.equal((await action(badSecret)).status, 401);
  } finally { globalThis.fetch = originalFetch; }
});


test('外部 TradingView 入口預設停用，既有 secret 不會使它重新啟用或觸發 D1／Slack', async () => {
  const args = requestArgs({ market: 'us_stock', symbol: 'AAPL', action: 'BUY', price: 100 }, {
    SLACK_API_TOKEN: 'test-token', US_STOCK_SLACK_CHANNEL_ID: 'US',
    DB: { prepare() { throw new Error('停用入口不可查詢 D1'); } },
  });
  delete args.context.cloudflare.env.TRADINGVIEW_WEBHOOK_ENABLED;
  args.context.cloudflare.ctx.waitUntil = () => { throw new Error('停用入口不可建立背景通知'); };
  const response = await action(args);
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /股票訊號由系統自行計算/);
});
