/** @file 以手算值驗證 TradingView 訊號配對與紙上績效；不連外、不寫入資料庫。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeReturnPct, resolveTradeEffect, type OpenTrade } from '../app/services/tradingview/pairing';
import { filterTrades, summarizeBySymbol, summarizeTrades, type TradeRecord } from '../app/services/tradingview/performance';

const openLong: OpenTrade = { id: 'trade-1', direction: 'LONG', entryPrice: 100 };
const openShort: OpenTrade = { id: 'trade-2', direction: 'SHORT', entryPrice: 100 };

const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 'x', market: 'crypto', symbol: 'SOLUSDT', direction: 'LONG', entryAt: 1, entryPrice: 100,
  entryNote: null, exitAt: 2, exitPrice: 110, returnPct: 10, closed: true, ...over,
});

test('多單進出場配對後以進場價為分母計算報酬', () => {
  const entry = resolveTradeEffect({ action: 'BUY', price: 100 }, null);
  assert.deepEqual(entry, { kind: 'OPEN', direction: 'LONG' });

  const exit = resolveTradeEffect({ action: 'SELL', price: 110 }, openLong);
  assert.equal(exit.kind, 'CLOSE');
  assert.equal(exit.kind === 'CLOSE' && exit.tradeId, 'trade-1');
  assert.ok(exit.kind === 'CLOSE' && Math.abs(exit.returnPct - 10) < 1e-9);
});

test('空單報酬方向相反，且回補用的 BUY 必須能平倉', () => {
  assert.ok(Math.abs(computeReturnPct('SHORT', 100, 90) - 10) < 1e-9);
  const cover = resolveTradeEffect({ action: 'BUY', price: 90 }, openShort);
  assert.equal(cover.kind, 'CLOSE');
  assert.ok(cover.kind === 'CLOSE' && Math.abs(cover.returnPct - 10) < 1e-9);
});

test('同方向重複進場不加碼，空單收到 SELL 也不誤判為平倉', () => {
  assert.equal(resolveTradeEffect({ action: 'BUY', price: 120 }, openLong).kind, 'IGNORE');
  assert.equal(resolveTradeEffect({ action: 'SELL', price: 120 }, openShort).kind, 'IGNORE');
  /** CLOSE／EXIT 是明確指令，任何方向都應平倉。 */
  assert.equal(resolveTradeEffect({ action: 'EXIT', price: 120 }, openShort).kind, 'CLOSE');
});

test('缺價格、缺方向與無部位可平的訊號一律不計入績效', () => {
  assert.equal(resolveTradeEffect({ action: 'BUY', price: null }, null).kind, 'IGNORE');
  assert.equal(resolveTradeEffect({ action: 'BUY', price: 0 }, null).kind, 'IGNORE');
  assert.equal(resolveTradeEffect({ action: null, price: 100 }, null).kind, 'IGNORE');
  assert.equal(resolveTradeEffect({ action: 'EXIT', price: 100 }, null).kind, 'IGNORE');
  assert.equal(resolveTradeEffect({ action: '吃大魚', price: 100 }, null).kind, 'IGNORE');
});

test('沒有持倉時的 SELL 視為做空進場', () => {
  assert.deepEqual(resolveTradeEffect({ action: 'SELL', price: 100 }, null), { kind: 'OPEN', direction: 'SHORT' });
});

test('未平倉不計入報酬分母，複利依出場時間序連乘', () => {
  const summary = summarizeTrades([
    trade({ id: 'a', exitAt: 10, returnPct: 10 }),
    trade({ id: 'b', exitAt: 20, returnPct: -5 }),
    trade({ id: 'c', exitAt: null, exitPrice: null, returnPct: null, closed: false }),
  ]);
  assert.equal(summary.totalTrades, 3);
  assert.equal(summary.closedTrades, 2);
  assert.equal(summary.openTrades, 1);
  assert.equal(summary.winRate, 50);
  assert.ok(Math.abs((summary.averageReturn as number) - 2.5) < 1e-9);
  assert.ok(Math.abs((summary.sumReturn as number) - 5) < 1e-9);
  /** 1.10 × 0.95 − 1 = 4.5%，與等權重加總的 5% 刻意並列呈現。 */
  assert.ok(Math.abs((summary.compoundReturn as number) - 4.5) < 1e-9);
  assert.equal(summary.lastExitAt, 20);
});

test('沒有已平倉樣本時勝率與報酬保持 null，不得顯示成 0', () => {
  const summary = summarizeTrades([trade({ exitAt: null, exitPrice: null, returnPct: null, closed: false })]);
  assert.equal(summary.winRate, null);
  assert.equal(summary.averageReturn, null);
  assert.equal(summary.compoundReturn, null);
  assert.equal(summary.lastExitAt, null);
});

test('依標的分組並可用市場與代號篩選', () => {
  const trades = [
    trade({ id: 'a', symbol: 'SOLUSDT', returnPct: 10 }),
    trade({ id: 'b', symbol: '2330', market: 'tw_stock', returnPct: 20 }),
  ];
  const groups = summarizeBySymbol(trades);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].symbol, '2330');

  assert.equal(filterTrades(trades, { market: 'tw_stock' }).length, 1);
  assert.equal(filterTrades(trades, { symbol: 'sol' }).length, 1);
  assert.equal(filterTrades(trades, { market: 'all' }).length, 2);
});
