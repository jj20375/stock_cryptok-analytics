/** @file 台股 4 小時量價、經典吃大魚與日線趨勢的純分析；不抓資料、不通知、不下單。 */
import { IndicatorCache } from '../strategy/indicatorCache';
import { analyzeBigFish } from '../strategy/bigFish';
import { twStockFourHourClosedAt } from './candles';
import { TW_STOCK_RADAR_RULES, type TwStockCandle, type TwStockObservation, type TwStockSignal } from './types';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const pct = (value: number, base: number) => (value / base - 1) * 100;

function structure(candles: TwStockCandle[], atr14: number) {
  const index = candles.length - 1;
  const current = candles[index];
  const turnover = (at: number) => candles[at].close * candles[at].volume;
  const averageTurnover = mean(candles.slice(index - 20, index).map(candle => candle.close * candle.volume));
  const volumeRatio = averageTurnover > 0 ? turnover(index) / averageTurnover : 0;
  let breakout = Math.max(...candles.slice(index - 20, index).map(candle => candle.high));
  let retest = false;
  /** 最近兩個交易日曾放量突破且其後未失守，才把本根回踩轉強歸類為續強。 */
  for (let at = index - 1; at >= Math.max(21, index - 4); at--) {
    const level = Math.max(...candles.slice(at - 20, at).map(candle => candle.high));
    const priorAverage = mean(candles.slice(at - 20, at).map(candle => candle.close * candle.volume));
    const breakoutVolume = priorAverage > 0 ? turnover(at) / priorAverage : 0;
    if (candles[at].close > level && breakoutVolume >= TW_STOCK_RADAR_RULES.breakoutVolumeMultiple &&
      candles.slice(at + 1).every(candle => candle.close >= level) && current.low <= level + atr14 * 0.5 &&
      current.close > candles[index - 1].high) {
      breakout = level; retest = true; break;
    }
  }
  return { breakout, volumeRatio, retest };
}

/** 4h 保留 MACD／Supertrend OR 觸發，最終候選另由日線 EMA20／EMA50 多頭確認。 */
export function analyzeTwStock(
  intraday: TwStockCandle[], daily: TwStockCandle[], benchmarkIntraday: TwStockCandle[], benchmarkDaily: TwStockCandle[],
): TwStockSignal {
  const current = intraday.at(-1)!;
  if (current.openTime !== benchmarkIntraday.at(-1)?.openTime) throw new Error('標的與 0050 最新 4 小時收盤時間不一致');
  const intradayIndicators = new IndicatorCache(intraday);
  const dailyIndicators = new IndicatorCache(daily);
  const benchmarkDailyIndicators = new IndicatorCache(benchmarkDaily);
  const index = intraday.length - 1;
  const dailyIndex = daily.length - 1;
  const ema20 = intradayIndicators.ema(20)[index];
  const ema50 = intradayIndicators.ema(50)[index];
  const ema200 = intradayIndicators.ema(200)[index];
  const atr14 = intradayIndicators.atr(14)[index];
  const rsi14 = intradayIndicators.rsi(14)[index];
  const macd = intradayIndicators.macd(12, 26, 9);
  const dailyEma20 = dailyIndicators.ema(20)[dailyIndex];
  const dailyEma50 = dailyIndicators.ema(50)[dailyIndex];
  const benchmarkDailyEma20 = benchmarkDailyIndicators.ema(20).at(-1)!;
  const benchmarkDailyEma50 = benchmarkDailyIndicators.ema(50).at(-1)!;
  const bigFish = analyzeBigFish(intraday);
  if (!bigFish || !(atr14 > 0)) throw new Error('技術指標暖機不足或近期波動無效');
  const s = structure(intraday, atr14);
  const averageDollarVolume20d = mean(daily.slice(-20).map(candle => candle.close * candle.volume));
  const change20d = pct(daily.at(-1)!.close, daily.at(-21)!.close);
  const spyChange20d = pct(benchmarkDaily.at(-1)!.close, benchmarkDaily.at(-21)!.close);
  const relative20d = change20d - spyChange20d;
  const change4h = pct(current.close, intraday.at(-2)!.close);
  const change1d = pct(current.close, intraday.at(-3)!.close);
  const sameTradingDay = Math.abs(current.openTime - daily.at(-1)!.openTime) < 12 * 60 * 60 * 1000;
  const previousDailyClose = daily.at(sameTradingDay ? -2 : -1)!.close;
  const changeDay = pct(current.close, previousDailyClose);
  const dailyTrendUp = daily.at(-1)!.close > dailyEma20 && dailyEma20 > dailyEma50;
  const marketTrendUp = benchmarkDaily.at(-1)!.close > benchmarkDailyEma20 && benchmarkDailyEma20 > benchmarkDailyEma50;
  const trendAligned = current.close > ema20 && ema20 > ema50 && ema50 > ema200;
  const breakoutNow = current.close > s.breakout && s.volumeRatio >= TW_STOCK_RADAR_RULES.breakoutVolumeMultiple;
  const distanceEma20Atr = (current.close - ema20) / atr14;
  const liquid = current.close >= TW_STOCK_RADAR_RULES.minPriceTwd &&
    averageDollarVolume20d >= TW_STOCK_RADAR_RULES.minAverageTurnoverTwd;
  const extended = distanceEma20Atr > TW_STOCK_RADAR_RULES.maxExtensionAtr ||
    changeDay >= TW_STOCK_RADAR_RULES.maxDayChangePct;
  let phase: TwStockSignal['phase'] = 'WAIT';
  if (!liquid) phase = 'EXCLUDED';
  else if (extended) phase = 'EXTENDED';
  else if (s.retest) phase = 'RETEST';
  else if (breakoutNow) phase = 'BREAKOUT';
  else if (dailyTrendUp && relative20d > 0 && change4h > 0 && s.volumeRatio >= 1.1 &&
    current.close >= s.breakout - atr14 * 0.75) phase = 'WATCH';

  const risks: string[] = [];
  if (current.close < TW_STOCK_RADAR_RULES.minPriceTwd) risks.push('股價低於 10 元，流動性與價差風險偏高');
  if (averageDollarVolume20d < TW_STOCK_RADAR_RULES.minAverageTurnoverTwd) risks.push('20 日平均成交額低於 5,000 萬元');
  if (extended) risks.push('距 4 小時 EMA20 過遠或接近漲停，等待整理');
  if (!dailyTrendUp) risks.push('個股日線 EMA20／EMA50 尚未多頭排列');
  if (!marketTrendUp) risks.push('0050 日線趨勢尚未確認，大盤逆風');
  if (relative20d <= 0) risks.push('近 20 日報酬尚未領先 0050');
  if (bigFish.entry && current.close < ema200) risks.push('Supertrend 翻綠，但價格仍在 4 小時 EMA200 下方');

  const parts = {
    trend: (trendAligned ? 18 : 0) + (dailyTrendUp ? 12 : 0),
    relative: relative20d >= 5 ? 25 : relative20d > 0 ? 15 : 0,
    volume: Math.round(Math.min(s.volumeRatio / 2, 1) * 20),
    structure: s.retest || breakoutNow ? 15 : current.close >= s.breakout - atr14 * 0.75 ? 8 : 0,
    momentum: rsi14 >= 45 && rsi14 <= 70 && macd.hist[index] > macd.hist[index - 1] ? 10 : 0,
  };
  const reasons = [
    `4 小時成交額為前 20 根均值 ${s.volumeRatio.toFixed(2)} 倍`,
    `近 20 日報酬相對 0050 ${relative20d >= 0 ? '+' : ''}${relative20d.toFixed(2)} 個百分點`,
    `日線 EMA20／EMA50 ${dailyTrendUp ? '多頭排列' : '尚未多頭排列'}`,
  ];
  if (bigFish.earlyLong) reasons.unshift('經典吃大魚：MACD 金叉且收盤高於 EMA200 × 0.98');
  if (bigFish.trendLong) reasons.unshift('經典吃大魚：Supertrend（ATR 10、係數 4）翻綠');
  if (s.retest) reasons.push('先前放量突破後守住突破位，本根回踩再轉強');
  else if (breakoutNow) reasons.push('本根收盤突破前 20 根高點並放量');
  const invalidation = Math.min(Math.min(...intraday.slice(-4).map(candle => candle.low)), ema20 - atr14);
  return {
    version: TW_STOCK_RADAR_RULES.version, phase,
    score: liquid ? Object.values(parts).reduce((sum, value) => sum + value, 0) : 0,
    parts, bigFish: { ...bigFish, timeframe: '4h' }, barTime: current.openTime, closedAt: current.closeTime ?? twStockFourHourClosedAt(current.openTime),
    price: current.close, change4h, change1d, changeDay, change20d, spyChange20d, relative20d,
    volumeRatio: s.volumeRatio, averageDollarVolume20d, breakout: s.breakout, ema20, ema50, ema200,
    dailyEma20, dailyEma50, rsi14, atr14, distanceEma20Atr, invalidation,
    dailyTrendUp, marketTrendUp, reasons, risks,
  };
}

/** 兩根約一個台股交易日；績效追蹤以後續已收盤 K 線計算，不含入選當根高低。 */
export function updateTwStockObservation(observation: TwStockObservation, candles: TwStockCandle[]): TwStockObservation {
  const future = candles.filter(candle => candle.openTime > observation.enteredAt);
  const next: TwStockObservation = { ...observation, returns: { ...observation.returns } };
  const unseen = future.filter(candle => (candle.closeTime ?? twStockFourHourClosedAt(candle.openTime)) > observation.checkedThrough);
  for (const candle of unseen) {
    next.maxRise = Math.max(next.maxRise, pct(candle.high, observation.entryPrice));
    next.maxFall = Math.min(next.maxFall, pct(candle.low, observation.entryPrice));
    next.checkedThrough = candle.closeTime ?? twStockFourHourClosedAt(candle.openTime);
  }
  for (const [key, bars] of [['h4', 1], ['d1', 2], ['d5', 10]] as const) {
    const candle = future[bars - 1];
    if (candle && next.returns[key] === null) next.returns[key] = pct(candle.close, observation.entryPrice);
  }
  next.complete = future.length >= 10 && Object.values(next.returns).every(value => value !== null);
  return next;
}
