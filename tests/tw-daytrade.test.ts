/** @file 當沖研究核心測試：驗證時間、成本、缺根、只做多、樣本與排序，不依賴即時行情。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import type { StrategyModule } from '../app/services/strategy/types';
import { analyzeDaytradeStock, rankDaytradeStocks } from '../app/services/twDaytrade/analysis';
import { prepareDaytradeHistory, replayDaytradeStrategy, summarizeDaytrades } from '../app/services/twDaytrade/backtest';
import { daytradeSessions, isFreshDaytradeBar, parseDaytradeChart, sessionDay, sessionMinute } from '../app/services/twDaytrade/candles';
import { daytradeStrategies, DAYTRADE_RISK_STRATEGY_ID } from '../app/services/twDaytrade/strategies';
import { scanDaytradeStocks } from '../app/services/twDaytrade/scanner.server';
import { loadTwDaytrade } from '../app/services/twDaytrade/loader.server';
import { DAYTRADE_RULES, isDaytradePriceEligible, type DaytradeCandle, type DaytradeTrade } from '../app/services/twDaytrade/types';
import { daytradeUniverse } from '../app/services/twDaytrade/market';

const DAY_MS = 86_400_000;
const start = Date.UTC(2026, 8, 1, 1);
const dayBars = (day: number, count = 18): DaytradeCandle[] => Array.from({ length: count }, (_, index) => {
  const openTime = start + day * DAY_MS + index * DAYTRADE_RULES.intervalMs, open = 100 + index * 0.2;
  return { openTime, closeTime: openTime + DAYTRADE_RULES.intervalMs, open, high: open + 0.25, low: open - 0.1, close: open + 0.2, volume: 100_000 };
});
const fixture = (days = 25) => Array.from({ length: days }, (_, day) => dayBars(day)).flat();
const long: StrategyModule = { id: 'fixture_long', name: '做多測試', description: '驗證隔根成交與當日平倉', markets: ['TW'], supportedIntervals: ['1d'],
  warmupBars: 0, supportsShort: false, defaultParams: {}, paramMeta: [], evaluate(ctx) {
    return !ctx.position && sessionMinute(ctx.candles[ctx.index].openTime) === 540
      ? { type: 'ENTRY', side: 'LONG', stopLossPct: 1, reason: '09:00 收盤確認' } : { type: 'HOLD' };
  } };
const risk: StrategyModule = { ...long, id: DAYTRADE_RISK_STRATEGY_ID, name: '量增未破', evaluate: () => ({ type: 'HOLD' }) };
const now = start + 25 * DAY_MS + DAYTRADE_RULES.intervalMs;

function replay(candles: DaytradeCandle[], strategy = long, guard = risk) {
  const prepared = prepareDaytradeHistory(candles, now);
  return replayDaytradeStrategy(prepared.candles, strategy, guard, new IndicatorCache(prepared.candles), prepared.liquidity);
}

test('七個指定策略全部沿用現有公式；量增未破只作做多風控，不修改全域週期', () => {
  const modules = daytradeStrategies();
  assert.equal(modules.length, 7);
  assert.equal(modules.find(module => module.id === 'trend_momentum')!.supportedIntervals.includes('15m'), false);
  assert.equal(modules.find(module => module.id === 'big_fish')!.supportedIntervals.includes('15m'), true);
});

test('Yahoo 排除未收盤、13:30 快照、空量、錯 OHLC；排序且去重', () => {
  const bars = [...dayBars(0), ...dayBars(1, 2)];
  const makePayload = (values: DaytradeCandle[]) => ({ chart: { result: [{ timestamp: values.map(bar => bar.openTime / 1000),
    indicators: { quote: [{ open: values.map(bar => bar.open), high: values.map(bar => bar.high), low: values.map(bar => bar.low), close: values.map(bar => bar.close), volume: values.map(bar => bar.volume) }] } }] } });
  const payload = makePayload([...bars].reverse().concat(bars[0], { ...bars[0], openTime: bars[0].openTime + 18 * DAYTRADE_RULES.intervalMs },
    { ...bars[0], openTime: start + 2 * DAY_MS, volume: 0 }, { ...bars[0], openTime: start + 3 * DAY_MS, low: 999 }));
  const parsed = parseDaytradeChart(payload, bars.at(-1)!.openTime);
  assert.equal(parsed.length, 19);
  assert.equal(parsed[0].openTime, start);
  assert.equal(parsed.at(-1)!.openTime, start + DAY_MS);
  assert.throws(() => parseDaytradeChart({}, now), /有效/);
});

test('新鮮度限制交易日、進場時間、未來與二十分鐘；休市不可變有效', () => {
  const bar = dayBars(25, 1)[0];
  assert.ok(isFreshDaytradeBar(bar, now));
  assert.equal(isFreshDaytradeBar(bar, now - 1), false);
  assert.equal(isFreshDaytradeBar(bar, now + 21 * 60_000), false);
  assert.equal(isFreshDaytradeBar(bar, now + DAY_MS), false);
  assert.equal(isFreshDaytradeBar(dayBars(25)[15], start + 25 * DAY_MS + 4 * 3_600_000 + 60_000), false);
});

test('下一根開盤成交並於 13:15 開盤平倉，五日流動性暖機，不跨日持倉', () => {
  const candles = fixture(), result = replay(candles);
  assert.equal(result.trades.length, 20);
  assert.equal(result.position, null);
  for (const trade of result.trades) {
    assert.equal(sessionMinute(trade.entryTime), 555);
    assert.equal(sessionMinute(trade.exitTime), 795);
    assert.equal(sessionDay(trade.entryTime), sessionDay(trade.exitTime));
    assert.ok(trade.netReturnPct > 0 && trade.netReturnPct < 3);
  }
  assert.equal(result.trades[0].entryTime, dayBars(5)[1].openTime);
});

test('缺一根完整歷史日整日排除；最新缺根回報異常，不掩蓋不可見停損', () => {
  const bars = fixture().filter(bar => bar.openTime !== dayBars(10)[8].openTime);
  assert.equal(daytradeSessions(bars).filter(session => !session.contiguous).length, 1);
  assert.equal(replay(bars).trades.some(trade => sessionDay(trade.entryTime) === sessionDay(dayBars(10)[0].openTime)), false);
  assert.throws(() => analyzeDaytradeStock('2330.TW', '測試', [...fixture(), ...dayBars(25, 3).filter((_, i) => i !== 1)], now + 3 * DAYTRADE_RULES.intervalMs, [long, risk]), /缺少連續/);
});

test('做空訊號與量增未破不建立多單；尾盤訊號不帶到次日', () => {
  const short: StrategyModule = { ...long, evaluate: () => ({ type: 'ENTRY', side: 'SHORT', reason: '做空' }) };
  assert.equal(replay(fixture(), short).trades.length, 0);
  assert.equal(replay(fixture(), long, short).trades.length, 0);
  const closing: StrategyModule = { ...long, evaluate: ctx => sessionMinute(ctx.candles[ctx.index].openTime) === 780
    ? { type: 'ENTRY', side: 'LONG', reason: '13:00 確認' } : { type: 'HOLD' } };
  assert.equal(replay(fixture(), closing).trades.length, 0);
});

test('跳空低於停損以較差開盤成交；平盤交易扣雙邊費、稅與滑價後算輸', () => {
  const candles = fixture();
  const at = candles.findIndex(bar => bar.openTime === dayBars(5)[2].openTime);
  candles[at] = { ...candles[at], open: 95, high: 95.5, low: 94.8, close: 95 };
  const trade = replay(candles).trades[0];
  assert.equal(trade.exitPrice, 95 * 0.9995);
  assert.match(trade.exitReason, /停損/);
  const flat = fixture().map(bar => ({ ...bar, open: 100, close: 100, high: 100, low: 100 }));
  const result = replay(flat).trades;
  assert.ok(result.length > 0 && result.every(item => item.netReturnPct < -0.5));
  assert.equal(summarizeDaytrades(result).wins, 0);
});

test('成交日資料不參與歷史排序；驗證段以完整日分割，暖機不足與負淨期望不入榜', () => {
  const stock = analyzeDaytradeStock('2330.TW', '測試', [...fixture(), ...dayBars(25, 1)], now, [long, risk]);
  assert.equal(stock.strategies[0].historical.trades, 20);
  assert.equal(stock.strategies[0].validation.trades, 8);
  assert.ok(stock.strategies[0].qualified && stock.strategies[0].signal && stock.fresh);
  assert.equal(rankDaytradeStocks([stock], true).length, 1);
  const insufficient = analyzeDaytradeStock('2317.TW', '少量', [...fixture(8)], now, [long, risk]);
  assert.equal(rankDaytradeStocks([insufficient], false).length, 0);
  const flat = fixture().map(bar => ({ ...bar, open: 100, close: 100, high: 100.1, low: 99.9 }));
  const loser = analyzeDaytradeStock('2303.TW', '平盤', flat, now, [long, risk]);
  assert.ok(loser.strategies[0].exclusions.some(text => text.includes('平均報酬')));
});

test('排名最多十檔且每檔一名，近期勝率高者優先，舊行情只留研究榜', () => {
  const stock = analyzeDaytradeStock('2330.TW', '測試', [...fixture(), ...dayBars(25, 1)], now, [long, risk]);
  const stocks = Array.from({ length: 12 }, (_, index) => ({ ...stock, symbol: `${2300 + index}.TW`,
    strategies: [stock.strategies[0], { ...stock.strategies[0], id: 'other' }] }));
  stocks[3].strategies = stocks[3].strategies.map(strategy => ({ ...strategy, validation: { ...strategy.validation, winRatePct: 50 } }));
  const rows = rankDaytradeStocks(stocks, true);
  assert.equal(rows.length, 10); assert.equal(new Set(rows.map(row => row.stock.symbol)).size, 10);
  assert.equal(rows.some(row => row.stock.symbol === stocks[3].symbol), false);
  const stale = { ...stock, fresh: false };
  assert.equal(rankDaytradeStocks([stale], true).length, 0);
  assert.equal(rankDaytradeStocks([stale], false).length, 1);
});

test('零樣本不顯示零勝率，少量全勝的 Wilson 下界低於較多全勝', () => {
  assert.equal(summarizeDaytrades([]).winRatePct, null);
  const sample: DaytradeTrade = { entryTime: 1, exitTime: 2, entryPrice: 100, exitPrice: 101, netReturnPct: 0.3, exitReason: '測試' };
  assert.ok(summarizeDaytrades([sample]).winRateLowerPct! < summarizeDaytrades(Array(20).fill(sample)).winRateLowerPct!);
});

test('價格包含 300 元整，超過上限的動態股與已知報價核心股均不入池', async () => {
  assert.ok(isDaytradePriceEligible(300));
  assert.equal(isDaytradePriceEligible(300.01), false);
  assert.equal(isDaytradePriceEligible(NaN), false);
  const universe = await daytradeUniverse(async () => [
    { symbol: '2330.TW', name: '核心超價', price: 301, volume: 1_000_000, changePct: 0, averageVolume3m: 0 },
    { symbol: '9999.TW', name: '上限邊界', price: 300, volume: 1_000_000, changePct: 0, averageVolume3m: 0 },
  ]);
  assert.equal(universe.pool.some(stock => stock.symbol === '2330.TW'), false);
  assert.ok(universe.pool.some(stock => stock.symbol === '9999.TW'));
});

test('回測開盤超過 300 元取消成交，300 元整仍可成交；兩種排行榜均排除最新超價股', () => {
  const boundary = fixture().map(bar => ({ ...bar, open: 300, close: 300, high: 300.5, low: 299.5 }));
  assert.ok(replay(boundary).trades.length > 0);
  const gap = fixture().map(bar => ({ ...bar, open: sessionMinute(bar.openTime) === 555 ? 301 : 299,
    close: 299, high: 302, low: 298 }));
  assert.equal(replay(gap).trades.length, 0);
  const stock = analyzeDaytradeStock('2330.TW', '測試', [...fixture(), ...dayBars(25, 1)], now, [long, risk]);
  const expensive = { ...stock, price: 301 };
  assert.equal(rankDaytradeStocks([expensive], true).length, 0);
  assert.equal(rankDaytradeStocks([expensive], false).length, 0);
});

test('最新 Yahoo 報價超過 300 元時不留於明細與榜單，價格排除不記為行情錯誤', async () => {
  const result = await scanDaytradeStocks(now, {
    daytradeUniverse: async () => ({ pool: [{ symbol: '2330.TW', name: '超價' }, { symbol: '2317.TW', name: '符合價格' }], source: '測試池' }),
    fetchDaytradeCandles: async symbol => symbol === '2330.TW'
      ? fixture().map(bar => ({ ...bar, open: bar.open * 4, close: bar.close * 4, high: bar.high * 4, low: bar.low * 4 })) : fixture(),
  });
  assert.equal(result.priceExcluded, 1); assert.equal(result.scanned, 1);
  assert.equal(result.stocks[0].symbol, '2317.TW'); assert.equal(result.errors.length, 0);
});

test('部分抓取失敗仍保留其他股票，失敗不偽裝成空訊號', async () => {
  const result = await scanDaytradeStocks(now, {
    daytradeUniverse: async () => ({ pool: [{ symbol: '2330.TW', name: '測試' }, { symbol: '2317.TW', name: '失敗' }], source: '測試股票池' }),
    fetchDaytradeCandles: async symbol => { if (symbol === '2317.TW') throw new Error('Yahoo 429'); return fixture(); },
  });
  assert.equal(result.scanned, 1); assert.equal(result.selected, 2);
  assert.deepEqual(result.errors, [{ symbol: '2317.TW', message: 'Yahoo 429' }]);
});

test('未登入先重新導向，不執行行情掃描', async () => {
  await assert.rejects(() => loadTwDaytrade({ request: new Request('https://example.test/tw-daytrade'), params: {},
    context: { cloudflare: { env: { SESSION_SECRET: 'fixture-test-secret' } } } } as never),
  error => error instanceof Response && error.status === 302 && error.headers.get('Location') === '/login');
});
