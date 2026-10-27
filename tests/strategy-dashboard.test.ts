/** @file 即時戰略 Dashboard：驗證標示、進場區間、排序、D1 優先與即時補算、失敗時的空清單說明；資料為離線合成範例。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeTwStock } from '../app/services/twStockRadar/analysis';
import { TW_STOCK_FOUR_HOUR_MS, type TwStockCandle, type TwStockSnapshot } from '../app/services/twStockRadar/types';
import { buildLevels, explainEmpty, rankPicks, stockSnapshotToPick } from '../app/services/strategyDashboard/picks';
import { loadStockPanel, STOCK_ADAPTERS } from '../app/services/strategyDashboard/stockPanel.server';
import { strategyDashboardResponse } from '../app/services/strategyDashboard/loader.server';
import { backtestLookupKey, backtestSymbolKey, parseBacktestSummary, resolveValidation,
  type BacktestSummary } from '../app/services/strategyDashboard/validation';
import { commitSession, getSession } from '../app/utils/auth';

const cutoff = Date.UTC(2026, 8, 16, 5, 34);
const intradayFixture = (lastClose = 100.1, count = 240): TwStockCandle[] => Array.from({ length: count }, (_, index) => {
  const close = index === count - 1 ? lastClose : 100;
  const openTime = cutoff - 34 * 60_000 - (count - index) * TW_STOCK_FOUR_HOUR_MS;
  return { openTime, closeTime: openTime + TW_STOCK_FOUR_HOUR_MS, open: 100, high: Math.max(101, close), low: 99, close, volume: 1_000_000 };
});
const dailyFixture = (): TwStockCandle[] => Array.from({ length: 70 }, (_, index) => {
  const close = 80 + index * 0.3;
  return { openTime: cutoff - (70 - index) * 86_400_000, open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 };
});
/** 經典吃大魚觸發且日線多頭的台股候選。 */
const candidateSignal = () => analyzeTwStock(intradayFixture(), dailyFixture(), intradayFixture(100), dailyFixture());
const snapshotOf = (symbol: string): TwStockSnapshot => ({ symbol, name: `測試 ${symbol}`, checkedAt: cutoff, signal: candidateSignal(), error: null });
const backtest = (totalTrades: number, totalReturnPct = 5): BacktestSummary => ({ backtestId: 7, strategyId: 'big_fish',
  symbol: '2330', interval: '4h', totalTrades, winRatePct: 45, totalReturnPct, profitFactor: 1.3 });

test('進場區間只採介於停損與收盤之間的既有支撐；失效價不低於收盤時不提供', () => {
  const levels = buildLevels(100, 90, [{ value: 95, basis: '突破位' }, { value: 97, basis: '4 小時 EMA20' }])!;
  assert.deepEqual([levels.entryLow, levels.entryHigh, levels.stopLoss, levels.entryBasis], [95, 100, 90, '突破位']);
  assert.equal(levels.riskPct, 10);
  const fallback = buildLevels(100, 90, [{ value: 85, basis: '突破位' }, { value: 101, basis: 'EMA20' }])!;
  assert.equal(fallback.entryLow, 100);
  assert.equal(fallback.entryBasis, '收盤參考價');
  assert.equal(buildLevels(100, 100, []), null);
  assert.equal(buildLevels(100, Number.NaN, []), null);
});

test('驗證標示：回測足量優先、追蹤足量次之，其餘一律標示未經回測驗證', () => {
  const track = { groupLabel: '經典吃大魚', windowLabel: '5 日', completed: 25, average: 1.2, positiveRate: 56 };
  assert.equal(resolveValidation('TW', backtest(30), track).status, 'BACKTEST');
  const tracked = resolveValidation('TW', backtest(5), track);
  assert.equal(tracked.status, 'TRACKED');
  const unverified = resolveValidation('TW', backtest(5), { ...track, completed: 3 });
  assert.equal(unverified.status, 'UNVERIFIED');
  assert.equal(unverified.label, '未經回測驗證');
  assert.match(unverified.detail, /僅 5 筆交易/);
  assert.equal(resolveValidation('CRYPTO', null, null).status, 'UNVERIFIED');
});

test('回測摘要解析失敗時回傳 null，不以 0 冒充績效；代號忽略交易所尾碼', () => {
  assert.equal(parseBacktestSummary({ id: 1, strategyId: 'big_fish', symbol: '2330', interval: '4h', resultJson: '{bad' }), null);
  assert.equal(parseBacktestSummary({ id: 1, strategyId: 'big_fish', symbol: '2330', interval: '4h', resultJson: '{"totalTrades":3}' }), null);
  assert.equal(parseBacktestSummary({ id: 1, strategyId: 'big_fish', symbol: '2330', interval: '4h',
    resultJson: '{"totalTrades":30,"winRatePct":40,"totalReturnPct":-2,"profitFactor":0.8}' })?.totalReturnPct, -2);
  assert.equal(backtestSymbolKey('2330.TW'), '2330');
  assert.equal(backtestLookupKey('big_fish', '4h', '6488.TWO'), backtestLookupKey('big_fish', '4h', '6488'));
});

test('雷達快照轉成清單項目：保留策略標籤、停損與新鮮度，並對應同策略同週期回測', () => {
  const snapshot = snapshotOf('2330.TW');
  const backtests = new Map([[backtestLookupKey('big_fish', '4h', '2330'), backtest(30)]]);
  const { pick } = stockSnapshotToPick(snapshot, { market: 'TW', latestBarTime: snapshot.signal!.barTime, backtests }, () => null);
  assert.equal(pick.fresh, true);
  assert.ok(pick.strategies.some(label => label.includes('經典')));
  assert.equal(pick.validation.status, 'BACKTEST');
  assert.equal(pick.levels?.stopLoss, snapshot.signal!.invalidation);
  assert.equal(pick.signalClosedAt, snapshot.signal!.closedAt);
  const stale = stockSnapshotToPick(snapshot, { market: 'TW', latestBarTime: snapshot.signal!.barTime + TW_STOCK_FOUR_HOUR_MS,
    backtests: new Map() }, () => null).pick;
  assert.equal(stale.fresh, false);
  assert.equal(stale.validation.status, 'UNVERIFIED');
});

test('排序：既有雷達優先序 → 驗證期望 → 分數；負期望墊後', () => {
  const base = stockSnapshotToPick(snapshotOf('A'), { market: 'TW', latestBarTime: null, backtests: new Map() }, () => null).pick;
  const item = (symbol: string, priority: number, edge: number, score: number) => ({ pick: { ...base, symbol, score }, priority, edge });
  const ranked = rankPicks([item('LOW', 0, 0, 90), item('NEG', 1, -1, 99), item('POS', 1, 1, 10), item('MID', 1, 0, 50)]);
  assert.deepEqual(ranked.map(pick => pick.symbol), ['POS', 'MID', 'NEG', 'LOW']);
});

test('沒有候選時說明實際原因，不留空白', () => {
  assert.match(explainEmpty(5, ['EXTENDED', 'EXTENDED', 'WAIT', 'EXCLUDED', 'WAIT']), /2 檔漲幅過熱.*1 檔流動性不合格.*2 檔仍在等待/);
  assert.match(explainEmpty(0, []), /沒有任何標的完成分析/);
});

const fixtureAdapter = (dbSnapshots: TwStockSnapshot[], recalcSymbols: string[]) => ({
  ...STOCK_ADAPTERS.TW,
  readDb: async () => ({ snapshots: dbSnapshots.map(item => JSON.stringify(item)), observations: [] }),
  fetchUniverse: async () => recalcSymbols.map(symbol => ({ symbol, name: symbol, price: 100, changePct: 1, volume: 1, averageVolume3m: 1 })),
  selectCandidates: (universe: any[]) => universe,
  fetchCandles: async (symbol: string, interval: '4h' | '1d') => ({ symbol, name: symbol,
    candles: interval === '4h' ? intradayFixture(symbol === '0050.TW' ? 100 : 100.1) : dailyFixture() }),
});

test('D1 已是最新收盤段時直接採用，不另外補算', async () => {
  const panel = await loadStockPanel(fixtureAdapter([snapshotOf('2330.TW')], ['9999.TW']), {} as any, new Map(), cutoff);
  assert.equal(panel.source, 'RADAR_DB');
  assert.deepEqual(panel.picks.map(pick => pick.symbol), ['2330.TW']);
  assert.equal(panel.picks[0].fresh, true);
  assert.equal(panel.stale, false);
});

test('D1 落後或沒有資料時，用同一套雷達函式即時補算並說明原因', async () => {
  const old = snapshotOf('2330.TW');
  old.signal = { ...old.signal!, barTime: old.signal!.barTime - TW_STOCK_FOUR_HOUR_MS };
  const panel = await loadStockPanel(fixtureAdapter([old], ['2317.TW']), {} as any, new Map(), cutoff);
  assert.equal(panel.source, 'LIVE_RECALC');
  assert.deepEqual(panel.picks.map(pick => pick.symbol), ['2317.TW']);
  assert.ok(panel.notes.some(note => note.includes('已落後最新收盤段')));
});

test('行情與 D1 都不可用時回傳錯誤與空清單原因，不產生假資料', async () => {
  const adapter = { ...fixtureAdapter([], []), fetchCandles: async () => { throw new Error('Yahoo 逾時'); } };
  const panel = await loadStockPanel(adapter, null, new Map(), cutoff);
  assert.equal(panel.picks.length, 0);
  assert.ok(panel.emptyReason);
  assert.ok(panel.errors.some(error => error.includes('Yahoo 逾時')));
  assert.equal(panel.watchlist.length, 0);
});

test('未達候選條件的標的列入觀察清單並寫出卡住的條件，不混入候選', async () => {
  const hot = snapshotOf('2454.TW');
  hot.signal = analyzeTwStock(intradayFixture(110), dailyFixture(), intradayFixture(100), dailyFixture());
  const panel = await loadStockPanel(fixtureAdapter([snapshotOf('2330.TW'), hot], []), {} as any, new Map(), cutoff);
  assert.deepEqual(panel.picks.map(pick => pick.symbol), ['2330.TW']);
  assert.deepEqual(panel.watchlist.map(item => item.symbol), ['2454.TW']);
  assert.ok(panel.watchlist[0].blockers.some(blocker => blocker.includes('過熱')));
});

test('API 需登入且只接受 TW／US／CRYPTO', async () => {
  const env = { SESSION_SECRET: 'test-only-session-secret' };
  const anonymous = await strategyDashboardResponse(new Request('https://example.test/api/strategy-dashboard?market=TW'), env);
  assert.equal(anonymous.status, 401);
  const session = await getSession(new Request('https://example.test'), env);
  session.set('userId', 1);
  const cookie = (await commitSession(session, env)).split(';')[0];
  const invalid = await strategyDashboardResponse(new Request('https://example.test/api/strategy-dashboard?market=JP',
    { headers: { Cookie: cookie } }), env);
  assert.equal(invalid.status, 400);
});

test('卡片呈現驗證標示與 K 線入口，免責提示固定出現，且沒有任何下單按鈕', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PickCard } = await import('../app/features/strategyDashboard/PickCard');
  const { Disclaimer } = await import('../app/features/strategyDashboard/PanelStatus');
  const { pick } = stockSnapshotToPick(snapshotOf('2330.TW'), { market: 'TW', latestBarTime: null, backtests: new Map() }, () => null);
  const html = renderToStaticMarkup(createElement('div', null,
    createElement(Disclaimer), createElement(PickCard, { pick, rank: 1, now: cutoff, onOpenChart: () => {} })));
  assert.match(html, /僅供參考，非投資建議/);
  assert.match(html, /未經回測驗證/);
  assert.match(html, /停損參考/);
  assert.match(html, /查看 K 線/);
  assert.match(html, /非最新收盤段/);
  assert.doesNotMatch(html, /下單<\/button>|買進<\/button>|送出訂單/);
});
