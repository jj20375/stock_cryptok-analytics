/** @file 驗證美股雷達的經典吃大魚、量價風控、績效追蹤與獨立 Slack 頻道。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeUsStock, updateUsStockObservation } from '../app/services/usStockRadar/analysis';
import { aggregateUsStockFourHourCandles, usStockHourlyClosedAt } from '../app/services/usStockRadar/candles';
import { assertFreshUsStockBar, selectUsStockCandidates } from '../app/services/usStockRadar/market';
import { slackPostFromStored } from '../app/services/slack/cryptoSignalCard';
import { formatUsStockCard, formatUsStockMessage, selectUsStockNotice } from '../app/services/usStockRadar/notifications';
import { usStockSlackChannel } from '../app/services/usStockRadar/scanner';
import { isUsStockCandidate, US_STOCK_FOUR_HOUR_MS, type UsStockCandle,
  type UsStockObservation, type UsStockSnapshot, type UsStockTicker } from '../app/services/usStockRadar/types';

const cutoff = Date.UTC(2026, 8, 15, 16);
const intradayFixture = (lastClose = 100.1, lastVolume = 500_000, count = 240): UsStockCandle[] =>
  Array.from({ length: count }, (_, index) => {
    const close = index === count - 1 ? lastClose : 100;
    const openTime = cutoff - (count - index) * US_STOCK_FOUR_HOUR_MS;
    return { openTime, closeTime: openTime + US_STOCK_FOUR_HOUR_MS, open: 100,
      high: Math.max(101, close), low: 99, close, volume: index === count - 1 ? lastVolume : 500_000 };
  });
const dailyFixture = (rising = false): UsStockCandle[] => Array.from({ length: 70 }, (_, index) => {
  const close = rising ? 80 + index * 0.3 : 100;
  return { openTime: cutoff - (70 - index) * 86_400_000, open: close, high: close + 1,
    low: close - 1, close, volume: 500_000 };
});

test('4 小時經典吃大魚保留 OR 觸發，已收盤日線確認後才能入選', () => {
  const intraday = intradayFixture();
  const signal = analyzeUsStock(intraday, dailyFixture(true), intradayFixture(100), dailyFixture(true));
  assert.equal(signal.bigFish.earlyLong, true);
  assert.equal(signal.bigFish.trendLong, false);
  assert.equal(signal.bigFish.entry, true);
  assert.equal(signal.phase, 'WAIT');
  assert.equal(isUsStockCandidate(signal), true);
  assert.match(signal.reasons.join(''), /經典吃大魚/);
  const unconfirmed = analyzeUsStock(intraday, dailyFixture(), intradayFixture(100), dailyFixture());
  assert.equal(unconfirmed.bigFish.entry, true);
  assert.equal(isUsStockCandidate(unconfirmed), false);
});

test('流動性與過熱是硬風控，不能被吃大魚訊號繞過', () => {
  const base = intradayFixture();
  const thinDaily = dailyFixture().map(candle => ({ ...candle, volume: 1_000 }));
  const thin = analyzeUsStock(base, thinDaily, intradayFixture(100), dailyFixture());
  assert.equal(thin.bigFish.entry, true);
  assert.equal(thin.phase, 'EXCLUDED');
  assert.equal(isUsStockCandidate(thin), false);
  const hot = analyzeUsStock(intradayFixture(120, 1_500_000), dailyFixture(), intradayFixture(100), dailyFixture());
  assert.equal(hot.bigFish.entry, true);
  assert.equal(hot.phase, 'EXTENDED');
  assert.equal(isUsStockCandidate(hot), false);
});

test('放量突破分類保留日線及 SPY 相對強弱分數', () => {
  const signal = analyzeUsStock(intradayFixture(102, 1_500_000), dailyFixture(true),
    intradayFixture(100), dailyFixture());
  assert.equal(signal.phase, 'BREAKOUT');
  assert.ok(signal.volumeRatio >= 1.5);
  assert.equal(signal.dailyTrendUp, true);
  assert.ok(signal.relative20d > 0);
  assert.ok(signal.score > 50);
});

test('只有最新三十五分鐘內的已收盤 4 小時 K 線可啟動掃描', () => {
  const candles = intradayFixture(100);
  assert.equal(assertFreshUsStockBar(candles, cutoff), cutoff - US_STOCK_FOUR_HOUR_MS);
  assert.throws(() => assertFreshUsStockBar(candles, cutoff + 36 * 60 * 1000), /休市/);
});

test('動態候選限制十檔並加入固定輪替，不重複代號', () => {
  const universe: UsStockTicker[] = Array.from({ length: 20 }, (_, index) => ({
    symbol: `X${index}`, name: `Stock ${index}`, price: 100, changePct: index,
    volume: 1_000_000 + index, averageVolume3m: 1_000_000,
  }));
  const selected = selectUsStockCandidates(universe, 0);
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map(item => item.symbol)).size, 10);
  assert.ok(selected.some(item => item.symbol === 'AAPL'));
});

test('績效以後續交易 K 線追蹤 4 小時、1 日與 5 日，不含入選當根極值', () => {
  const intraday = intradayFixture();
  const signal = analyzeUsStock(intraday, dailyFixture(), intradayFixture(100), dailyFixture());
  const observation: UsStockObservation = { id: 'AAPL:fixture', symbol: 'AAPL', name: 'Apple',
    enteredAt: signal.barTime, detectedAt: cutoff, entryPrice: signal.price, signal,
    checkedThrough: signal.closedAt, returns: { h4: null, d1: null, d5: null },
    maxRise: 0, maxFall: 0, complete: false, error: null };
  const future = Array.from({ length: 10 }, (_, index) => ({ openTime: cutoff + index * US_STOCK_FOUR_HOUR_MS,
    closeTime: cutoff + (index + 1) * US_STOCK_FOUR_HOUR_MS,
    open: 101, high: 103, low: 98, close: index === 9 ? 102 : 101, volume: 500_000 }));
  const next = updateUsStockObservation(observation, [...intraday, ...future]);
  assert.ok(next.returns.h4 != null && next.returns.d1 != null && next.returns.d5 != null);
  assert.equal(next.complete, true);
  assert.ok(next.maxRise < 4 && next.maxFall > -3);
});

test('Yahoo 1 小時資料只在 13:30 與 16:00 收盤後形成兩根交易時段 K 線', () => {
  const sessionOpen = Date.UTC(2026, 8, 15, 13, 30);
  const hourly = Array.from({ length: 7 }, (_, index) => {
    const openTime = sessionOpen + index * 60 * 60_000;
    return { openTime, closeTime: usStockHourlyClosedAt(openTime), open: 100, high: 101,
      low: 99, close: 100 + index * 0.1, volume: 100 };
  });
  assert.equal(aggregateUsStockFourHourCandles(hourly.slice(0, 6)).length, 1);
  const complete = aggregateUsStockFourHourCandles(hourly);
  assert.equal(complete.length, 2);
  assert.equal(complete[0].volume, 400);
  assert.equal(complete[1].volume, 300);
  assert.equal(complete[1].closeTime, Date.UTC(2026, 8, 15, 20));
});

test('通知標示經典吃大魚且美股頻道不 fallback 到虛擬幣頻道', () => {
  const intraday = intradayFixture();
  const signal = analyzeUsStock(intraday, dailyFixture(true), intradayFixture(100), dailyFixture(true));
  const snapshot: UsStockSnapshot = { symbol: 'TSLL', name: 'Direxion Daily TSLA Bull 2X', checkedAt: cutoff, signal, error: null };
  assert.equal(selectUsStockNotice(snapshot, null), 'BIG_FISH');
  assert.match(formatUsStockMessage(snapshot), /美股潛力雷達.*TSLL.*經典吃大魚/s);
  const card = slackPostFromStored(formatUsStockCard(snapshot));
  assert.match(card.text, /TSLL.*經典吃大魚.*進場參考/s);
  assert.ok(card.blocks && card.blocks.length >= 4);
  assert.match(JSON.stringify(card.blocks), /量能.*相對 SPY.*槓桿 ETF/s);
  assert.equal(usStockSlackChannel({ DB: {} as any, SLACK_API_TOKEN: 'token' } as any), null);
  assert.equal(usStockSlackChannel({ DB: {} as any, US_STOCK_SLACK_CHANNEL_ID: ' C123 ' } as any), 'C123');
});
