/** @file 驗證權證排除、排程觸發量及虛擬幣新倉停用；不連外、不使用真實交易帳戶。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cryptoAutoScanEnabled, cryptoNewEntriesAllowed, cryptoSpotProtectionSymbols } from '../app/services/cryptoActivityPolicy';
import { processCryptoFuturesSignal } from '../app/services/cryptoAutoTrading/engine';
import { isUsDailyReportTime, SCHEDULES } from '../app/services/scheduledJobs';
import { isExcludedTradingviewSecurity } from '../app/services/tradingview/market';
import { isTwStockOrEtfCode } from '../app/services/twStockRadar/securities';
import { fetchTwStockCandles, fetchTwStockUniverse } from '../app/services/twStockRadar/market';
import { fetchUsStockCandles } from '../app/services/usStockRadar/market';

test('截圖中的六碼權證與售權證不進股票／ETF 日報，普通股及主動 ETF 保留', () => {
  for (const code of ['03314T', '059073', '043871', '067274', '03013T']) {
    assert.equal(isTwStockOrEtfCode(code), false);
    assert.equal(isExcludedTradingviewSecurity({ market: 'tw_stock', symbol: `TWSE:${code}` }), true);
  }
  for (const code of ['2330', '2409', '3481', '0050', '00406A', '00403A', '00632R']) {
    assert.equal(isTwStockOrEtfCode(code), true);
    assert.equal(isExcludedTradingviewSecurity({ market: 'tw_stock', symbol: `${code}.TW` }), false);
  }
});

test('證交所候選取得時就排除權證，不為權證建立後續行情請求', async () => {
  const originalFetch = globalThis.fetch;
  const rows = ['03314T', '059073', '2330', '00406A'].map(code => [code, '樣本', '1000000', '', '100000000', '', '', '', '100', '+', '1']);
  globalThis.fetch = async () => Response.json({ tables: [{ title: '每日收盤行情', data: rows }] });
  try { assert.deepEqual((await fetchTwStockUniverse()).map(ticker => ticker.symbol), ['2330.TW', '00406A.TW']); }
  finally { globalThis.fetch = originalFetch; }
});

test('股票日線於正式收盤後可用，不多延後半小時；尚未收盤的最後一根仍排除', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [market, sessionOpen, duration] of [
      ['TW', Date.UTC(2026, 8, 16, 1), 4.5], ['US', Date.UTC(2026, 8, 16, 13, 30), 6.5],
    ] as const) {
      const timestamp = Array.from({ length: 70 }, (_, i) => (sessionOpen - (69 - i) * 86_400_000) / 1000);
      const values = Array(70).fill(100);
      globalThis.fetch = async () => Response.json({ chart: { result: [{ timestamp,
        indicators: { quote: [{ open: values, high: values, low: values, close: values, volume: values }] },
      }] } });
      const fetchCandles = market === 'TW' ? fetchTwStockCandles : fetchUsStockCandles;
      const closedAt = sessionOpen + duration * 3_600_000;
      const closed = await fetchCandles(market === 'TW' ? '2330.TW' : 'AAPL', '1d', closedAt + 8 * 60_000);
      assert.equal(closed.candles.at(-1)!.openTime, sessionOpen);
      assert.equal(closed.candles.at(-1)!.closeTime, closedAt);
      const live = await fetchCandles(market === 'TW' ? '2330.TW' : 'AAPL', '1d', closedAt - 1);
      assert.equal(live.candles.at(-1)!.openTime, sessionOpen - 86_400_000);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('Cron 設定與工作入口一致；Demo 一分鐘檢查且維持五個 Trigger', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const crons = [...config.split('crons = [')[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(crons, Object.values(SCHEDULES));
  assert.equal(crons.length, 5);
  const matches = (field: string, value: number) => field.split(',').some(part => {
    if (part === '*') return true;
    if (part.startsWith('*/')) return value % Number(part.slice(2)) === 0;
    if (part.includes('-')) { const [low, high] = part.split('-').map(Number); return value >= low && value <= high; }
    return Number(part) === value;
  });
  const count = (weekday: number) => crons.reduce((total, cron) => {
    const [minute, hour, , , day] = cron.split(' ');
    if (!matches(day, weekday)) return total;
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) if (matches(hour, h) && matches(minute, m)) total++;
    return total;
  }, 0);
  assert.equal(count(1), 1466);
  assert.equal(count(0), 1440);
  const worker = readFileSync(new URL('../app/worker.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /runPotentialRadar|runPotentialBigFish|runWaveRadar|runBinancePerpRadar|runBinancePerpNotificationQueue/);
});

test('美股日報用紐約收盤時點，夏令／冬令不提前或重送', () => {
  assert.equal(isUsDailyReportTime(Date.UTC(2026, 8, 15, 20, 30)), true);
  assert.equal(isUsDailyReportTime(Date.UTC(2026, 8, 15, 21, 30)), false);
  assert.equal(isUsDailyReportTime(Date.UTC(2026, 11, 15, 20, 45)), false);
  assert.equal(isUsDailyReportTime(Date.UTC(2026, 11, 15, 21, 45)), true);
});

test('停用新倉與全幣池掃描後，只檢查既有現貨；永續與股票不誤走現貨平倉', () => {
  assert.equal(cryptoNewEntriesAllowed({}), false);
  assert.equal(cryptoAutoScanEnabled({}), false);
  const trade = { market: 'CRYPTO', symbol: 'BTCUSDT', status: 'OPEN', reason: '現貨策略' };
  assert.deepEqual(cryptoSpotProtectionSymbols([trade, trade,
    { ...trade, symbol: 'ETHUSDT', reason: '[BITGET_LIVE_AUTO:signal]' },
    { ...trade, symbol: 'SOLUSDT', reason: '[BITGET_DEMO_AUTO:signal]' },
    { ...trade, symbol: 'RAAPLUSDT', market: 'US' }, { ...trade, symbol: 'BNBUSDT', status: 'CLOSED' },
  ]), ['BTCUSDT']);
});

test('任何 Webhook／內部來源的 BUY 在查詢及交易副作用前阻擋，SELL 仍可進入持倉保護', async () => {
  const env = { DB: { prepare() { throw new Error('持倉查詢入口'); } } as any, CRYPTO_NEW_ENTRIES_ENABLED: 'false' };
  const signal = { id: 'test-event', source: 'TRADINGVIEW' as const, symbol: 'BTCUSDT', action: 'BUY' as const,
    signalAt: Date.now(), referencePrice: 100, label: '測試' };
  await processCryptoFuturesSignal(env, signal);
  await assert.rejects(processCryptoFuturesSignal(env, { ...signal, action: 'SELL' }), /持倉查詢入口/);
});
