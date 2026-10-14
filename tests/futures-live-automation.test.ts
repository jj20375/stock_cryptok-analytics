/** @file 正式自動化風控與授權回歸；臨時 D1、假金鑰、全攔截 fetch，不能接觸使用者帳戶或交易所。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { action } from '../app/routes/api.futures-automation';
import { getSession, commitSession } from '../app/utils/auth';
import { encryptData } from '../app/utils/encryption';
import { processCryptoFuturesSignal } from '../app/services/cryptoAutoTrading/engine';
import { closeBitgetFuturesLong, fetchBitgetFuturesAccount } from '../app/services/bitgetService';
import { automationConfigAuthorizes, automationEntryAllowed, automationEventId, automationPositionCapPct, DEFAULT_AUTOMATION, validateAutomationInput } from '../app/services/cryptoFutures/automation';
import { safeAutomationError } from '../app/services/cryptoFutures/automation.server';
import { futuresEntryRisk } from '../app/services/backtest/futures';
import { futuresSnapshot } from '../app/services/cryptoFutures/snapshot.server';
import { createLocalFuturesDemo } from '../dev/localFuturesDemo';
import { reserveCrossTrade } from '../app/services/cryptoFutures/reservation.server';
import { selectFuturesUniverse } from '../app/services/cryptoFutures/universe.server';
import { detectLedgerDialect } from '../app/services/bitgetLedger/api.server';
import type { CryptoAutoTradeSignal } from '../app/services/cryptoAutoTrading/types';

const plan = { stopPrice: 98, stopDistance: 2, minStopDistance: 1, maxStopDistance: 4, targetMultiple: 2, minRewardRisk: 1.5, minPrice: 99, maxPrice: 101 };
const signal = (id: string): CryptoAutoTradeSignal => ({ id, source: 'FUTURES_AUTO', symbol: 'BTCUSDT', action: 'BUY', intent: 'OPEN_LONG',
  signalAt: Date.now(), referencePrice: 100, label: '合成策略訊號', strategyId: 'futures_trend_retest', entryPlan: plan,
  feeRate: 0.0006, fundingBudgetRate: 0, maxNotionalUsdt: 30, automationUpdatedAt: 101 });

async function fixture() {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("synthetic") } }', d1Databases: { DB: 'live-synthetic' } });
  const db = await mf.getD1Database('DB');
  for (const name of (await readdir(new URL('../drizzle/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    const sql = (await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    if (statements.length) await db.batch(statements.map(s => db.prepare(s)));
  }
  const master = 'fake-local-master-for-isolated-tests';
  const keys = await Promise.all(['fake-live-key', 'fake-live-secret', 'fake-live-pass', 'fake-demo-key', 'fake-demo-secret', 'fake-demo-pass'].map(s => encryptData(s, master)));
  await db.prepare(`INSERT INTO users(id,email,password_hash,live_trading_enabled,bitget_futures_execution_mode,
    bitget_futures_live_api_key,bitget_futures_live_api_secret,bitget_futures_live_passphrase,bitget_demo_api_key,bitget_demo_api_secret,bitget_demo_passphrase,
    capital_base_usdt,max_risk_per_trade_pct,max_daily_loss_pct,max_position_size_pct,bitget_futures_live_max_leverage,bitget_demo_max_leverage)
    VALUES(1,'synthetic@example.test','fake',1,'LIVE',?,?,?,?,?,?,'1000','0.25','1','5',10,3)`).bind(...keys).run();
  await db.prepare(`INSERT INTO crypto_futures_automation(user_id,enabled,execution_mode,max_notional_usdt,symbols_json,updated_at)
    VALUES(1,1,'LIVE',30,'["BTCUSDT"]',101)`).run();
  const env = { DB: db as any, MASTER_ENCRYPTION_KEY: master, SESSION_SECRET: 'fake-session', SLACK_API_TOKEN: 'fake-slack',
    CRYPTO_FUTURES_TRADE_SLACK_CHANNEL_ID: 'fake-channel', CRYPTO_NEW_ENTRIES_ENABLED: 'false',
    CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED: 'true', CRYPTO_FUTURES_LIVE_AUTOMATION_ENABLED: 'true' };
  const previous = globalThis.fetch, calls: Array<{ path: string; method: string; body: any; headers: Headers }> = [];
  let price = 100, funds = 1000, onConfigure: (() => Promise<void>) | undefined, loseOrderResponse = false;
  /** 合成交易所持倉快照，用來模擬使用者自己的手動部位。 */
  let positions: Array<Record<string, string>> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.bitget.com', '任何外部服務都必須被攔截');
    const body = init?.body ? JSON.parse(String(init.body)) : null, headers = new Headers(init?.headers);
    calls.push({ path: url.pathname, method: init?.method ?? 'GET', body, headers });
    if (headers.has('ACCESS-KEY')) assert.ok(headers.get('ACCESS-KEY')!.startsWith('fake-'), '只接受合成金鑰');
    let data: unknown;
    if (url.pathname.endsWith('/contracts')) data = [{ symbol: 'BTCUSDT', symbolStatus: 'normal', volumePlace: '3', pricePlace: '2', minTradeNum: '0.001', sizeMultiplier: '0.001', minTradeUSDT: '5', minLever: '1', maxLever: '50', takerFeeRate: '0.0006' }];
    else if (url.pathname.endsWith('/ticker')) data = [{ lastPr: String(price), markPrice: String(price), usdtVolume: '100000000' }];
    else if (url.pathname.endsWith('/query-position-lever')) data = [{ startUnit: '0', endUnit: '100000000', keepMarginRate: '0.004', leverage: '50' }];
    else if (url.pathname.endsWith('/current-fund-rate')) data = [{ symbol: 'BTCUSDT', fundingRate: '0', fundingRateInterval: '8', nextUpdate: String(Date.now() + 3_600_000) }];
    else if (url.pathname.endsWith('/merge-depth')) data = { bids: [[String(price - 0.01), '100000']], asks: [[String(price + 0.01), '100000']] };
    else if (url.pathname === '/api/v3/account/settings') data = { holdMode: 'hedge_mode', symbolConfigList: [{ category: 'USDT-FUTURES', symbol: 'BTCUSDT', marginMode: 'isolated' }] };
    else if (url.pathname === '/api/v3/account/assets') data = { effEquity: String(funds), imr: '0', mmr: '0', assets: [{ coin: 'USDT', equity: String(funds), available: String(funds), debt: '0' }] };
    else if (url.pathname === '/api/v3/position/current-position') data = { list: positions };
    else if (url.pathname === '/api/v3/account/set-leverage') { await onConfigure?.(); data = 'success'; }
    else if (url.pathname === '/api/v3/trade/place-order') {
      if (loseOrderResponse) throw new TypeError('合成回應遺失');
      data = { orderId: 'fake-order', clientOid: body.clientOid };
    } else assert.fail(`未攔截的 API：${url.pathname}`);
    return Response.json({ code: '00000', data });
  };
  return { db, env, calls, setPositions(list: Array<Record<string, string>>) { positions = list; }, setFunds(value: number) { funds = value; }, setPrice(p: number) { price = p; }, onConfigure(callback: () => Promise<void>) { onConfigure = callback; }, loseResponse() { loseOrderResponse = true; },
    async dispose() { globalThis.fetch = previous; await mf.dispose(); } };
}

test('測試單 30U 是名目硬上限；槓桿不放大數量，政策／環境／設定版本均不能繞過', async () => {
  const input = validateAutomationInput({ ...DEFAULT_AUTOMATION, executionMode: 'LIVE' });
  assert.equal(input.maxNotionalUsdt, 30);
  for (const change of [{ maxNotionalUsdt: 30.01 }, { maxNotionalUsdt: NaN }, { maxNotionalUsdt: 0 }, { executionMode: 'live' }]) assert.throws(() => validateAutomationInput({ ...input, ...change }));
  const cap = automationPositionCapPct(1000, 50, 30);
  const low = futuresEntryRisk('LONG', 100, plan, { feeRate: 0.0006, slippageBps: 10 }, 1000, 3, cap, 3, 3);
  const high = futuresEntryRisk('LONG', 100, plan, { feeRate: 0.0006, slippageBps: 10 }, 1000, 3, cap, 3, 50);
  assert.ok('quantity' in low && 'quantity' in high); assert.equal(low.quantity, high.quantity); assert.ok(high.quantity * 100 <= 30);
  const config = { enabled: true, executionMode: 'LIVE', symbolsJson: '["BTCUSDT"]', strategyId: 'futures_trend_retest', maxNotionalUsdt: 30, updatedAt: 101 };
  assert.equal(automationConfigAuthorizes(config, signal('x'), 'LIVE'), true);
  for (const change of [{ updatedAt: 102 }, { maxNotionalUsdt: 20 }, { enabled: false }, { executionMode: 'DEMO' }]) assert.equal(automationConfigAuthorizes({ ...config, ...change }, signal('x'), 'LIVE'), false);
  assert.notEqual(automationEventId(1, 'BTCUSDT', 'futures_trend_retest', 100, 'OPEN_LONG'), automationEventId(1, 'BTCUSDT', 'futures_trend_retest', 100, 'OPEN_LONG', 'LIVE'));
  const env = { DB: { prepare() { assert.fail('政策不符時不能查 DB'); } } as any, CRYPTO_NEW_ENTRIES_ENABLED: 'true', CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED: 'true' };
  assert.equal(automationEntryAllowed(env, 'FUTURES_AUTO', 'futures_trend_retest', 'LIVE'), false);
  await processCryptoFuturesSignal(env, signal('blocked'), 1, 'LIVE');
  const local = createLocalFuturesDemo(true).environment({ CRYPTO_FUTURES_LIVE_AUTOMATION_ENABLED: 'true' });
  assert.equal(local.CRYPTO_FUTURES_LIVE_AUTOMATION_ENABLED, 'false');
  assert.match(safeAutomationError(new TypeError('fetch failed', { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } })), /HTTPS 憑證/);
});

test('正式資金配置可超過30U，依實際本金5%／3%限制；中途劃出本金拒單', async () => {
  for (const positionPct of [5, 3]) {
    const f = await fixture();
    try {
      await f.db.prepare('UPDATE crypto_futures_automation SET test_mode=0,position_pct=?').bind(positionPct).run();
      const live = { ...signal(`account-${positionPct}`), automationTestMode: false, automationPositionPct: positionPct, maxNotionalUsdt: undefined };
      await processCryptoFuturesSignal(f.env, live, 1, 'LIVE');
      const order = f.calls.find(c => c.path.endsWith('/trade/place-order'))!;
      assert.ok(order);
      const notional = Number(order.body.qty) * 100.1;
      assert.ok(notional <= 1000 * positionPct / 100 && notional > 1000 * positionPct / 100 - .11);
      if (positionPct === 5) assert.ok(notional > 30);
      assert.equal(order.body.marginMode, 'crossed');
    } finally { await f.dispose(); }
  }
  const f = await fixture();
  try {
    f.onConfigure(async () => f.setFunds(100));
    await processCryptoFuturesSignal(f.env, signal('withdrawal'), 1, 'LIVE');
    assert.equal(f.calls.filter(c => c.path.endsWith('/trade/place-order')).length, 0);
    assert.equal((await f.db.prepare('SELECT status FROM paper_trades').first<any>()).status, 'CANCELED');
  } finally { await f.dispose(); }
});

test('重疊 D1 寫入只保留三筆；待成交名額也阻擋第四筆', async () => {
  const f = await fixture();
  try {
    const reservations = await Promise.all(['BTCUSDT','ETHUSDT','ADAUSDT','SOLUSDT'].map(symbol => reserveCrossTrade(f.env,
      { userId: 1, mode: 'LIVE', symbol, side: 'BUY', ledgerAccountId: 'fake-account', entryPrice: '100', amount: '.1', stopLossPrice: '98', reason: 'synthetic', maxOpenPositions: 3 })));
    assert.equal(reservations.filter(Boolean).length, 3);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM paper_trades WHERE status='OPEN'").first<any>()).n, 3);
  } finally { await f.dispose(); }
});

test('合成 LIVE 委託走正式 UTA、名目不超過30、原生停損目標與穩定去重完整', async () => {
  const f = await fixture();
  try {
    await processCryptoFuturesSignal(f.env, signal('accepted'), 1, 'LIVE');
    await processCryptoFuturesSignal(f.env, signal('accepted'), 1, 'LIVE');
    const orders = f.calls.filter(c => c.path.endsWith('/trade/place-order'));
    assert.equal(orders.length, 1);
    assert.equal(orders[0].headers.get('paptrading'), null); assert.equal(orders[0].headers.get('ACCESS-KEY'), 'fake-live-key');
    assert.ok(Number(orders[0].body.qty) * 100.1 <= 30); assert.equal(orders[0].body.marginMode, 'crossed');
    assert.equal(orders[0].body.posSide, 'long'); assert.ok(orders[0].body.stopLoss && orders[0].body.takeProfit);
    const audit = await f.db.prepare('SELECT status,execution_mode,strategy_snapshot_json FROM crypto_auto_orders').first<any>();
    assert.equal(audit.status, 'SUBMITTED'); assert.equal(audit.execution_mode, 'LIVE'); assert.equal(JSON.parse(audit.strategy_snapshot_json).maxNotionalUsdt, 30);
    assert.equal((await f.db.prepare('SELECT mode FROM paper_trades').first<any>()).mode, 'LIVE');
    await closeBitgetFuturesLong('LIVE', 'BTCUSDT', '0.001', 'fake-live-key', 'fake-live-secret', 'fake-live-pass', 'synthetic-close', 'short');
    assert.equal(f.calls.at(-1)!.body.side, 'buy'); assert.equal(f.calls.at(-1)!.body.posSide, 'short'); assert.equal(f.calls.at(-1)!.headers.get('paptrading'), null);
  } finally { await f.dispose(); }
});

test('送單前降低額度或撤回實戰授權即取消預留；回應未知禁止重送', async () => {
  for (const change of ['cap', 'authorization', 'unknown'] as const) {
    const f = await fixture();
    try {
      if (change === 'cap') f.onConfigure(async () => { await f.db.prepare('UPDATE crypto_futures_automation SET max_notional_usdt=20,updated_at=102').run(); });
      if (change === 'authorization') f.onConfigure(async () => { await f.db.prepare('UPDATE users SET live_trading_enabled=0').run(); });
      if (change === 'unknown') f.loseResponse();
      await processCryptoFuturesSignal(f.env, signal(change), 1, 'LIVE');
      await processCryptoFuturesSignal(f.env, signal(change), 1, 'LIVE');
      assert.equal(f.calls.filter(c => c.path.endsWith('/trade/place-order')).length, change === 'unknown' ? 1 : 0);
      assert.equal((await f.db.prepare('SELECT status FROM crypto_auto_orders').first<any>()).status, change === 'unknown' ? 'UNKNOWN' : 'FAILED');
      assert.equal((await f.db.prepare('SELECT status FROM paper_trades').first<any>()).status, change === 'unknown' ? 'OPEN' : 'CANCELED');
    } finally { await f.dispose(); }
  }
});

test('API 的正式啟用必須明確確認；唯讀檢查不發委託且不借用一般 Bitget 憑證', async () => {
  const f = await fixture();
  try {
    await f.db.prepare('UPDATE crypto_futures_automation SET enabled=0').run();
    const session = await getSession(new Request('https://app.example.test/'), f.env); session.set('userId', 1);
    const cookie = (await commitSession(session, f.env)).split(';')[0];
    const invoke = async (body: Record<string, unknown>, env = f.env) => {
      await f.db.prepare('DELETE FROM crypto_futures_rate_limits').run();
      return action({ request: new Request('https://app.example.test/api/futures-automation', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://app.example.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        context: { cloudflare: { env } }, params: {} } as any);
    };
    const live = { ...DEFAULT_AUTOMATION, executionMode: 'LIVE', enabled: true, operation: 'save' };
    assert.equal((await invoke({ ...live, confirmDemo: true })).status, 400);
    assert.equal((await invoke({ ...live, confirmLive: true }, { ...f.env, CRYPTO_FUTURES_LIVE_AUTOMATION_ENABLED: 'false' })).status, 400);
    assert.equal((await f.db.prepare('SELECT enabled FROM crypto_futures_automation').first<any>()).enabled, 0);
    assert.equal((await invoke({ operation: 'check', executionMode: 'LIVE' })).status, 200);
    assert.equal(f.calls.at(-1)!.headers.get('ACCESS-KEY'), 'fake-live-key'); assert.equal(f.calls.at(-1)!.headers.get('paptrading'), null);
    assert.equal((await invoke({ operation: 'check', executionMode: 'DEMO' })).status, 200);
    assert.equal(f.calls.at(-1)!.headers.get('ACCESS-KEY'), 'fake-demo-key'); assert.equal(f.calls.at(-1)!.headers.get('paptrading'), '1');
    assert.equal((await invoke({ ...live, confirmLive: true })).status, 200); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
    await f.db.prepare('UPDATE users SET bitget_api_key=bitget_futures_live_api_key,bitget_api_secret=bitget_futures_live_api_secret,bitget_passphrase=bitget_futures_live_passphrase,bitget_futures_live_api_key=NULL').run();
    const count = f.calls.length;
    assert.equal((await invoke({ operation: 'check', executionMode: 'LIVE' })).status, 400); assert.equal(f.calls.length, count);
  } finally { await f.dispose(); }
});

test('LIVE 唯讀預覽使用正式槓桿、30U上限並唯讀實際資金，不混入Demo持倉', async () => {
  const f = await fixture();
  try {
    f.setPrice(185);
    const hour = 3_600_000, end = Math.floor(Date.now() / hour) * hour - hour;
    const bars = Array.from({ length: 834 }, (_, i) => ({ openTime: end - (833 - i) * hour, open: 100 + i * .1, high: 101 + i * .1, low: 99 + i * .1, close: 100 + i * .1, volume: 1000 }));
    [[182.9,185.2,182.8,185],[185,185.1,183.8,184.4],[184.4,184.6,183.9,184.2],[184.2,185.2,184,185]]
      .forEach(([open,high,low,close], i) => Object.assign(bars[830+i], {open,high,low,close}));
    await f.db.prepare(`INSERT INTO paper_trades(user_id,mode,market,exchange,symbol,side,status,entry_price,amount,stop_loss_price,reason)
      VALUES(1,'PAPER','CRYPTO','BITGET','BTCUSDT','BUY','OPEN','185','0.1','182','[BITGET_DEMO_AUTO:FUTURES_AUTO:fake]')`).run();
    const preview = await futuresSnapshot(f.env, 1, 'BTCUSDT', 'futures_trend_retest', .0006, { candles: bars, source: 'FUTURES_AUTO', executionMode: 'LIVE', maxNotionalUsdt: 30 });
    assert.equal(preview.position, null); assert.equal(preview.action.type, 'ENTRY'); assert.ok(preview.quote);
    assert.ok(preview.quote.notionalUsdt <= 30); assert.equal(preview.quote.leverageCap, 10);
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  } finally { await f.dispose(); }
});

test('開空同樣需要本人 LIVE 授權；Classic 40084／40099 正確辨識，簽章錯誤不降級', async () => {
  const f = await fixture();
  try {
    const short = { ...signal('short'), action: 'SELL' as const, intent: 'OPEN_SHORT' as const, entryPlan: { ...plan, stopPrice: 102 } };
    await f.db.prepare('UPDATE users SET live_trading_enabled=0').run();
    await processCryptoFuturesSignal(f.env, short, 1, 'LIVE'); assert.equal(f.calls.length, 0);
    await f.db.prepare('UPDATE users SET live_trading_enabled=1').run();
    await processCryptoFuturesSignal(f.env, short, 1, 'LIVE');
    const order = f.calls.find(c => c.path.endsWith('/trade/place-order'))!;
    assert.ok(order); assert.equal(order.body.side, 'sell'); assert.equal(order.body.posSide, 'short'); assert.ok(Number(order.body.qty) * 99.9 <= 30);
    const paths: string[] = [];
    for (const code of ['40084', '40099']) {
      globalThis.fetch = async (input, init) => {
        const path = new URL(String(input)).pathname; paths.push(path); assert.equal(new Headers(init?.headers).get('paptrading'), null);
        assert.equal(init?.method, 'GET', '辨識流程不能發送交易寫入');
        return path.includes('/v3/') ? Response.json({ code, msg: 'synthetic classic account' }, { status: 400 })
          : Response.json({ code: '00000', data: { posMode: 'one_way_mode', marginMode: 'crossed' } });
      };
      paths.length = 0;
      assert.equal((await fetchBitgetFuturesAccount('LIVE', 'BTCUSDT', 'fake-key', 'fake-secret', 'fake-pass')).apiDialect, 'CLASSIC_V2');
      assert.deepEqual(paths, ['/api/v3/account/settings', '/api/v2/mix/account/account']);
      assert.equal(await detectLedgerDialect({apiKey:'fake-key',apiSecret:'fake-secret',passphrase:'fake-pass'}, {id:'synthetic',userId:1,environment:'LIVE'}), 'CLASSIC_V2');
    }
    globalThis.fetch = async () => Response.json({ code: '40009', msg: 'synthetic signature rejection' }, { status: 400 });
    await assert.rejects(fetchBitgetFuturesAccount('LIVE', 'BTCUSDT', 'fake-key', 'fake-secret', 'fake-pass'), /40009/);
    await assert.rejects(detectLedgerDialect({apiKey:'fake-key',apiSecret:'fake-secret',passphrase:'fake-pass'}, {id:'synthetic',userId:1,environment:'LIVE'}), /40009/);
  } finally { await f.dispose(); }
});

test('其他幣種的手動部位不阻擋自動化新倉；同幣種有手動部位（任何方向）則跳過不送單', async () => {
  const manualEthShort = { symbol: 'ETHUSDT', posSide: 'short', total: '1.53', avgPrice: '2500' };
  const f = await fixture();
  try {
    f.setPositions([manualEthShort]);
    await processCryptoFuturesSignal(f.env, signal('manual-other-symbol'), 1, 'LIVE');
    const orders = f.calls.filter(c => c.path.endsWith('/trade/place-order'));
    assert.equal(orders.length, 1, '其他幣種的手動空單不應阻擋 BTCUSDT 開多');
    assert.equal(orders[0].body.symbol, 'BTCUSDT');
    assert.equal(f.calls.filter(c => c.method === 'POST' && c.body?.symbol === 'ETHUSDT').length, 0, '不得對手動部位送出任何委託');
    assert.equal((await f.db.prepare('SELECT status FROM crypto_auto_orders').first<any>()).status, 'SUBMITTED');
  } finally { await f.dispose(); }
  for (const posSide of ['short', 'long']) {
    const g = await fixture();
    try {
      g.setPositions([{ symbol: 'BTCUSDT', posSide, total: '0.01', avgPrice: '100' }]);
      await processCryptoFuturesSignal(g.env, signal(`manual-same-${posSide}`), 1, 'LIVE');
      assert.equal(g.calls.filter(c => c.path.endsWith('/trade/place-order') || c.path.endsWith('/set-leverage')).length, 0, '同幣種有部位時不能改槓桿或下單');
      const audit = await g.db.prepare('SELECT status,reason FROM crypto_auto_orders').first<any>();
      assert.equal(audit.status, 'REJECTED'); assert.match(audit.reason, /同商品部位/);
      assert.equal((await g.db.prepare("SELECT COUNT(*) AS n FROM paper_trades WHERE status='OPEN'").first<any>()).n, 0, '跳過時不能占用持倉槽');
    } finally { await g.dispose(); }
  }
});

test('全市場授權只接受合法 USDT 合約；指定清單仍限五個', async () => {
  const all = validateAutomationInput({ ...DEFAULT_AUTOMATION, executionMode: 'LIVE', universe: 'ALL', symbols: 'ignored' });
  assert.equal(all.universe, 'ALL'); assert.equal(all.symbols, '*');
  /** 讀回已保存設定時只有 symbols「*」，必須還原為全市場。 */
  assert.equal(validateAutomationInput({ ...DEFAULT_AUTOMATION, symbols: '*' }).universe, 'ALL');
  assert.throws(() => validateAutomationInput({ ...DEFAULT_AUTOMATION, universe: 'EVERYTHING' }));
  assert.throws(() => validateAutomationInput({ ...DEFAULT_AUTOMATION, universe: 'LIST', symbols: 'AUSDT,BUSDT,CUSDT,DUSDT,EUSDT,FUSDT' }));
  const config = { enabled: true, executionMode: 'LIVE', symbolsJson: '["*"]', strategyId: 'futures_trend_retest', maxNotionalUsdt: 30, updatedAt: 101 };
  assert.equal(automationConfigAuthorizes(config, { ...signal('x'), symbol: 'TSLAUSDT' }, 'LIVE'), true);
  assert.equal(automationConfigAuthorizes(config, { ...signal('x'), symbol: '../BTCUSDT' }, 'LIVE'), false);
  assert.equal(automationConfigAuthorizes({ ...config, symbolsJson: '["*","BTCUSDT"]' }, { ...signal('x'), symbol: 'ETHUSDT' }, 'LIVE'), false);
  assert.equal(automationConfigAuthorizes({ ...config, symbolsJson: '["BTCUSDT"]' }, { ...signal('x'), symbol: 'ETHUSDT' }, 'LIVE'), false);
});

test('全市場清單只取正常交易、USDT 永續且成交額達門檻者，依成交額排序', () => {
  const contracts = [
    { symbol: 'BTCUSDT', symbolStatus: 'normal', symbolType: 'perpetual', quoteCoin: 'USDT' },
    { symbol: 'TSLAUSDT', symbolStatus: 'normal', symbolType: 'perpetual', quoteCoin: 'USDT', isRwa: 'YES' },
    { symbol: 'DOGEUSDT', symbolStatus: 'normal', symbolType: 'perpetual', quoteCoin: 'USDT' },
    { symbol: 'HALTUSDT', symbolStatus: 'maintain', symbolType: 'perpetual', quoteCoin: 'USDT' },
    { symbol: 'TINYUSDT', symbolStatus: 'normal', symbolType: 'perpetual', quoteCoin: 'USDT' },
  ];
  const tickers = [
    { symbol: 'DOGEUSDT', usdtVolume: '18000000' }, { symbol: 'BTCUSDT', usdtVolume: '2100000000' },
    { symbol: 'TSLAUSDT', usdtVolume: '12000000' }, { symbol: 'HALTUSDT', usdtVolume: '900000000' },
    { symbol: 'TINYUSDT', usdtVolume: '9999999' }, { symbol: 'GHOSTUSDT', usdtVolume: '500000000' },
  ];
  assert.deepEqual(selectFuturesUniverse(tickers, contracts), ['BTCUSDT', 'DOGEUSDT', 'TSLAUSDT']);
});
