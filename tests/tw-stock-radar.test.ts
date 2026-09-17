/** @file 驗證台股 4 小時／日線策略、交易時段合成、硬風控與獨立 Slack 頻道。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeTwStock } from '../app/services/twStockRadar/analysis';
import { aggregateTwStockFourHourCandles, twStockHourlyClosedAt } from '../app/services/twStockRadar/candles';
import { selectTwStockCandidates } from '../app/services/twStockRadar/market';
import { formatTwStockCard, selectTwStockNotice } from '../app/services/twStockRadar/notifications';
import { twStockSlackChannel } from '../app/services/twStockRadar/scanner';
import { isTwStockCandidate, TW_STOCK_FOUR_HOUR_MS, type TwStockCandle,
  type TwStockSnapshot, type TwStockTicker } from '../app/services/twStockRadar/types';
import { slackPostFromStored } from '../app/services/slack/cryptoSignalCard';

const cutoff = Date.UTC(2026, 8, 16, 5, 34);
const intradayFixture = (lastClose = 100.1, lastVolume = 1_000_000, count = 240): TwStockCandle[] =>
  Array.from({ length: count }, (_, index) => {
    const close = index === count - 1 ? lastClose : 100;
    const openTime = cutoff - 34 * 60_000 - (count - index) * TW_STOCK_FOUR_HOUR_MS;
    return { openTime, closeTime: openTime + TW_STOCK_FOUR_HOUR_MS, open: 100,
      high: Math.max(101, close), low: 99, close, volume: index === count - 1 ? lastVolume : 1_000_000 };
  });
const dailyFixture = (rising = false): TwStockCandle[] => Array.from({ length: 70 }, (_, index) => {
  const close = rising ? 80 + index * 0.3 : 100;
  return { openTime: cutoff - (70 - index) * 86_400_000, open: close, high: close + 1,
    low: close - 1, close, volume: 1_000_000 };
});

test('台股經典吃大魚保留 OR 觸發，日線確認後才列為候選', () => {
  const intraday = intradayFixture();
  const signal = analyzeTwStock(intraday, dailyFixture(true), intradayFixture(100), dailyFixture(true));
  assert.equal(signal.bigFish.earlyLong, true);
  assert.equal(signal.bigFish.entry, true);
  assert.equal(signal.dailyTrendUp, true);
  assert.equal(isTwStockCandidate(signal), true);
  const unconfirmed = analyzeTwStock(intraday, dailyFixture(), intradayFixture(100), dailyFixture());
  assert.equal(unconfirmed.bigFish.entry, true);
  assert.equal(isTwStockCandidate(unconfirmed), false);
});

test('台股低成交額與接近漲停屬於硬風控', () => {
  const thinDaily = dailyFixture(true).map(candle => ({ ...candle, volume: 1_000 }));
  const thin = analyzeTwStock(intradayFixture(), thinDaily, intradayFixture(100), dailyFixture(true));
  assert.equal(thin.phase, 'EXCLUDED');
  assert.equal(isTwStockCandidate(thin), false);
  const hot = analyzeTwStock(intradayFixture(110, 2_000_000), dailyFixture(true), intradayFixture(100), dailyFixture(true));
  assert.equal(hot.phase, 'EXTENDED');
  assert.equal(isTwStockCandidate(hot), false);
});

test('台股 09:00–13:00 合成 4h，13:00–13:30 獨立為收盤段', () => {
  const sessionOpen = Date.UTC(2026, 8, 16, 1);
  const hourly = Array.from({ length: 5 }, (_, index) => {
    const openTime = sessionOpen + index * 60 * 60_000;
    return { openTime, closeTime: twStockHourlyClosedAt(openTime), open: 100, high: 101,
      low: 99, close: 100 + index * 0.1, volume: 100 };
  });
  assert.equal(aggregateTwStockFourHourCandles(hourly.slice(0, 3)).length, 0);
  assert.equal(aggregateTwStockFourHourCandles(hourly.slice(0, 4)).length, 1);
  const complete = aggregateTwStockFourHourCandles(hourly);
  assert.equal(complete.length, 2);
  assert.equal(complete[0].volume, 400);
  assert.equal(complete[0].closeTime, Date.UTC(2026, 8, 16, 5));
  assert.equal(complete[1].closeTime, Date.UTC(2026, 8, 16, 5, 30));
});

test('動態候選限制十檔並輪替大型股，不重複代號', () => {
  const universe: TwStockTicker[] = Array.from({ length: 20 }, (_, index) => ({
    symbol: `${1100 + index}.TW`, name: `公司 ${index}`, price: 100, changePct: index,
    volume: 1_000_000 + index, averageVolume3m: 1_000_000,
  }));
  const selected = selectTwStockCandidates(universe, 0);
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map(item => item.symbol)).size, 10);
  assert.ok(selected.some(item => item.symbol === '2330.TW'));
});

test('台股卡片顯示新台幣與 0050，且頻道不 fallback 到其他 Slack', () => {
  const intraday = intradayFixture();
  const signal = analyzeTwStock(intraday, dailyFixture(true), intradayFixture(100), dailyFixture(true));
  const snapshot: TwStockSnapshot = { symbol: '2330.TW', name: '台積電', checkedAt: cutoff, signal, error: null };
  assert.equal(selectTwStockNotice(snapshot, null), 'BIG_FISH');
  const card = slackPostFromStored(formatTwStockCard(snapshot));
  assert.match(card.text, /2330.*台積電.*經典吃大魚.*NT\$/s);
  assert.match(JSON.stringify(card.blocks), /相對 0050.*注意漲跌停/s);
  assert.equal(twStockSlackChannel({ DB: {} as any, SLACK_API_TOKEN: 'token' } as any), null);
  assert.equal(twStockSlackChannel({ DB: {} as any, TW_STOCK_SLACK_CHANNEL_ID: ' C-TW ' } as any), 'C-TW');
});
