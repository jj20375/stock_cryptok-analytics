/** @file 驗證掃描不讀未收盤資料、日線 2 倍門檻、流動性排除、取消及 AI 不改排名；沒有下單或通知。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStockPerpCandles, STOCK_PERP_INTERVALS, type StockPerpContract } from '../app/services/bitgetStockPerps/market';
import { scoreStockPerpCandidate, scanStockPerps, explainStockPerpPicks, type StockPerpPick } from '../app/services/bitgetStockPerps/scanner';
import { confirmedStrategyCandles } from '../app/features/home/strategy-candles';
import type { Candle } from '../app/services/strategy/types';
import type { Timeframe, StockDataPoint } from '../app/types';

const day = 86_400_000;
const contract = (symbol: string): StockPerpContract => ({ symbol, baseCoin: symbol.replace('USDT', ''), maxLeverage: 20, fundingIntervalHours: 8 });
const ticker = { symbol: 'AAPLUSDT', turnoverUsdt: 1_000_000, spreadPct: 0.01 };
const fixture = (now: number): Candle[] => Array.from({ length: 65 }, (_, i) => ({ openTime: now - (65 - i) * day,
  open: 100 + i, close: 100 + i, high: 101 + i, low: 99 + i, volume: i === 64 ? 200 : 100 }));
const rows = (candles: Candle[]) => candles.map(c => [c.openTime, c.open, c.high, c.low, c.close, c.volume].map(String));

test('四個週期去重、排序並排除未收盤根，錯誤價量與未知週期拒絕', async t => {
  const now = Date.UTC(2026, 9, 8);
  for (const timeframe of Object.keys(STOCK_PERP_INTERVALS) as Timeframe[]) {
    const step = STOCK_PERP_INTERVALS[timeframe].duration;
    const bar = (time: number) => [String(time), '100', '102', '99', '101', '100'];
    const mock = t.mock.method(globalThis, 'fetch', async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('granularity'), STOCK_PERP_INTERVALS[timeframe].granularity);
      assert.equal(url.searchParams.get('productType'), 'USDT-FUTURES');
      return Response.json({ code: '00000', data: [bar(now), bar(now - step), bar(now - 2 * step), bar(now - step)] });
    });
    assert.deepEqual((await loadStockPerpCandles('AAPLUSDT', timeframe, 120, undefined, now)).map(c => c.openTime), [now - 2 * step, now - step]);
    mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: '00000', data: [[String(now - day), '100', '90', '99', '101', '5']] }));
  await assert.rejects(loadStockPerpCandles('AAPLUSDT', '1d', 120, undefined, now), /數值無效/);
  await assert.rejects(loadStockPerpCandles('AAPLUSDT', '5m' as Timeframe), /參數無效/);
});

test('2倍日量與共用趨勢評分可觸發；未收盤、資料不足與逾期不能產生候選', () => {
  const now = Date.UTC(2026, 9, 8), candles = fixture(now);
  const result = scoreStockPerpCandidate(contract('AAPLUSDT'), ticker, candles, 'daily_volume_spike', '1d', now);
  assert.equal(result.status, 'match'); assert.match(result.pick!.reason, /2.00 倍/);
  assert.equal(result.pick!.signalTime, now); assert.equal(result.pick!.score, 76);
  assert.equal(scoreStockPerpCandidate(contract('AAPLUSDT'), ticker, candles, 'trend', '1d', now).status, 'match');
  const volumeCandles = fixture(now);
  volumeCandles.at(-2)!.volume = 200;
  const current = volumeCandles.at(-1)!, previous = volumeCandles.at(-2)!;
  current.open = current.close = previous.close; current.high = previous.high; current.low = previous.low;
  assert.equal(scoreStockPerpCandidate(contract('AAPLUSDT'), ticker, volumeCandles, 'consecutive_volume', '1d', now).status, 'match');
  assert.equal(scoreStockPerpCandidate(contract('AAPLUSDT'), ticker, volumeCandles, 'volume_no_break', '1d', now).pick?.bias, '做空觀察');
  candles.at(-1)!.volume = 199;
  assert.equal(scoreStockPerpCandidate(contract('AAPLUSDT'), ticker, candles, 'daily_volume_spike', '1d', now).status, 'unmatched');
  assert.equal(scoreStockPerpCandidate(contract('AAPLUSDT'), ticker, [...candles, { ...candles.at(-1)!, openTime: now, volume: 100_000 }], 'daily_volume_spike', '1d', now).status, 'unmatched');
  assert.equal(scoreStockPerpCandidate(contract('AAPLUSDT'), ticker, candles.slice(-10), 'trend', '1d', now).status, 'insufficient');
  assert.equal(scoreStockPerpCandidate(contract('AAPLUSDT'), ticker, candles, 'trend', '1d', now + day * 4).status, 'stale');
  const data: StockDataPoint[] = [{ ...candles[0], date: '', timestamp: now, price: 100, currency: 'USDT', isMock: false }];
  assert.equal(confirmedStrategyCandles(data, { market: 'US', timeframe: '1d', continuousMarket: true, now: now + 7 * 3_600_000 }).length, 0);
});

test('流動性篩選只掃股票清單，固定日線、部分進度正確且取消後不再請求', async t => {
  const now = Math.floor(Date.now() / day) * day;
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (url.pathname.endsWith('tickers')) return Response.json({ code: '00000', data: [
      { symbol: 'AAPLUSDT', bidPr: '100', askPr: '100.01', usdtVolume: '1000000' },
      { symbol: 'LOWUSDT', bidPr: '100', askPr: '100.01', usdtVolume: '100' },
      { symbol: 'BTCUSDT', bidPr: '100', askPr: '100.01', usdtVolume: '2000000' },
      { symbol: 'TSLAUSDT', bidPr: '100', askPr: '100.01', usdtVolume: '500000' },
    ] });
    assert.equal(url.searchParams.get('symbol'), 'AAPLUSDT'); assert.equal(url.searchParams.get('granularity'), '1Dutc');
    return Response.json({ code: '00000', data: rows(fixture(now)) });
  });
  const progress: number[] = [];
  const result = await scanStockPerps([contract('AAPLUSDT'), contract('LOWUSDT')], 'daily_volume_spike', '60m', new AbortController().signal, p => progress.push(p.processed));
  assert.equal(result.excluded, 1); assert.equal(result.total, 1); assert.equal(result.processed, 1);
  assert.deepEqual(result.results.map(p => p.symbol), ['AAPLUSDT']); assert.deepEqual(progress, [0, 1]);
  const controller = new AbortController(); controller.abort();
  const calls = seen.length;
  await assert.rejects(scanStockPerps([contract('AAPLUSDT')], 'trend', '1d', controller.signal, () => {}));
  assert.equal(seen.length, calls);
  const midScan = new AbortController(), before = seen.filter(path => path.endsWith('candles')).length;
  await assert.rejects(scanStockPerps([contract('AAPLUSDT'), contract('TSLAUSDT')], 'trend', '1d', midScan.signal,
    p => { if (p.processed === 1) midScan.abort(); }));
  assert.equal(seen.filter(path => path.endsWith('candles')).length, before + 1);
});

test('網路憑證或連線拒絕提示重試，不以假行情繼續評分', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(loadStockPerpCandles('AAPLUSDT', '1d'), /憑證.*重新整理重試/);
});

test('AI可加解讀，但未知商品或模型排序不能改動既有候選與分數', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ recommendations: [
    { symbol: 'UNKNOWN', aiInsight: '外來商品' }, { symbol: 'AAPLUSDT', aiInsight: '留意放量變化' },
  ] }));
  const pick: StockPerpPick = { symbol: 'AAPLUSDT', name: 'AAPL', score: 76, reason: '日量2倍', bias: '放量上漲', signalTime: 1,
    price: 100, turnoverUsdt: 1_000_000, spreadPct: 0.01 };
  const result = await explainStockPerpPicks([pick], '1d', new AbortController().signal);
  assert.equal(result.length, 1); assert.equal(result[0].score, 76); assert.equal(result[0].symbol, pick.symbol);
  assert.equal(result[0].aiInsight, '留意放量變化');
});
