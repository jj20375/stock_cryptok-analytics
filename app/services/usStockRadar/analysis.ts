/** @file 美股 4 小時量價、經典吃大魚與日線趨勢的純分析；不抓資料、不通知、不下單。 */
import { IndicatorCache } from '../strategy/indicatorCache';
import { analyzeBigFish } from '../strategy/bigFish';
import { US_STOCK_RADAR_RULES, type UsStockCandle,
  type UsStockObservation, type UsStockSignal } from './types';
import { usStockFourHourClosedAt } from './candles';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const pct = (value: number, base: number) => (value / base - 1) * 100;

function structure(candles: UsStockCandle[], atr14: number) {
  const index = candles.length - 1;
  const current = candles[index];
  const dollarVolume = (at: number) => candles[at].close * candles[at].volume;
  const averageDollarVolume = mean(candles.slice(index - 20, index).map(candle => candle.close * candle.volume));
  const volumeRatio = averageDollarVolume > 0 ? dollarVolume(index) / averageDollarVolume : 0;
  let breakout = Math.max(...candles.slice(index - 20, index).map(candle => candle.high));
  let retest = false;
  /** 最近兩個交易日內已發生放量突破、其後收盤未失守，才把本根回踩轉強歸類為續強。 */
  for (let at = index - 1; at >= Math.max(21, index - 4); at--) {
    const level = Math.max(...candles.slice(at - 20, at).map(candle => candle.high));
    const priorAverage = mean(candles.slice(at - 20, at).map(candle => candle.close * candle.volume));
    const breakoutVolume = priorAverage > 0 ? dollarVolume(at) / priorAverage : 0;
    if (candles[at].close > level && breakoutVolume >= US_STOCK_RADAR_RULES.breakoutVolumeMultiple &&
      candles.slice(at + 1).every(candle => candle.close >= level) && current.low <= level + atr14 * 0.5 &&
      current.close > candles[index - 1].high) {
      breakout = level;
      retest = true;
      break;
    }
  }
  return { breakout, volumeRatio, retest };
}

/**
 * 經典吃大魚的 MACD／Supertrend OR 規則完整套用在 4 小時線；已收盤日線負責方向確認。
 * SPY 日線保留為品質與風險條件，不會把單一市場逆風誤寫成個股訊號消失。
 */
export function analyzeUsStock(
  intraday: UsStockCandle[],
  daily: UsStockCandle[],
  spyIntraday: UsStockCandle[],
  spyDaily: UsStockCandle[],
): UsStockSignal {
  const current = intraday.at(-1)!;
  if (current.openTime !== spyIntraday.at(-1)?.openTime) throw new Error('標的與 SPY 最新 4 小時收盤時間不一致');
  const intradayIndicators = new IndicatorCache(intraday);
  const dailyIndicators = new IndicatorCache(daily);
  const spyDailyIndicators = new IndicatorCache(spyDaily);
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
  const spyDailyEma20 = spyDailyIndicators.ema(20).at(-1)!;
  const spyDailyEma50 = spyDailyIndicators.ema(50).at(-1)!;
  const bigFish = analyzeBigFish(intraday);
  if (!bigFish || !(atr14 > 0)) throw new Error('技術指標暖機不足或近期波動無效');
  const s = structure(intraday, atr14);
  const averageDollarVolume20d = mean(daily.slice(-20).map(candle => candle.close * candle.volume));
  const change20d = pct(daily.at(-1)!.close, daily.at(-21)!.close);
  const spyChange20d = pct(spyDaily.at(-1)!.close, spyDaily.at(-21)!.close);
  const relative20d = change20d - spyChange20d;
  const change4h = pct(current.close, intraday.at(-2)!.close);
  /** 美股正常交易日合成兩根 4h／收盤段 K，因此兩根近似一個交易日。 */
  const change1d = pct(current.close, intraday.at(-3)!.close);
  /** 盤中使用上一個完整日線收盤；收盤定版後則用倒數第二根，避免當日漲幅變成零。 */
  const sameTradingDay = Math.abs(current.openTime - daily.at(-1)!.openTime) < 12 * 60 * 60 * 1000;
  const previousDailyClose = daily.at(sameTradingDay ? -2 : -1)!.close;
  const changeDay = pct(current.close, previousDailyClose);
  const dailyTrendUp = daily.at(-1)!.close > dailyEma20 && dailyEma20 > dailyEma50;
  const marketTrendUp = spyDaily.at(-1)!.close > spyDailyEma20 && spyDailyEma20 > spyDailyEma50;
  const trendAligned = current.close > ema20 && ema20 > ema50 && ema50 > ema200;
  const breakoutNow = current.close > s.breakout && s.volumeRatio >= US_STOCK_RADAR_RULES.breakoutVolumeMultiple;
  const distanceEma20Atr = (current.close - ema20) / atr14;
  const liquid = current.close >= US_STOCK_RADAR_RULES.minPriceUsd &&
    averageDollarVolume20d >= US_STOCK_RADAR_RULES.minAverageDollarVolumeUsd;
  const extended = distanceEma20Atr > US_STOCK_RADAR_RULES.maxExtensionAtr ||
    changeDay > US_STOCK_RADAR_RULES.maxDayChangePct;
  let phase: UsStockSignal['phase'] = 'WAIT';
  if (!liquid) phase = 'EXCLUDED';
  else if (extended) phase = 'EXTENDED';
  else if (s.retest) phase = 'RETEST';
  else if (breakoutNow) phase = 'BREAKOUT';
  else if (dailyTrendUp && relative20d > 0 && change4h > 0 && s.volumeRatio >= 1.1 &&
    current.close >= s.breakout - atr14 * 0.75) phase = 'WATCH';

  const risks: string[] = [];
  if (current.close < US_STOCK_RADAR_RULES.minPriceUsd) risks.push('股價低於 2 美元，跳空與價差風險偏高');
  if (averageDollarVolume20d < US_STOCK_RADAR_RULES.minAverageDollarVolumeUsd) risks.push('20 日平均成交額低於 2,000 萬美元');
  if (extended) risks.push('距 4 小時 EMA20 過遠或當日漲幅過大，等待整理');
  if (!dailyTrendUp) risks.push('個股日線 EMA20／EMA50 尚未多頭排列');
  if (!marketTrendUp) risks.push('SPY 日線趨勢尚未確認，市場逆風');
  if (relative20d <= 0) risks.push('近 20 日報酬尚未領先 SPY');
  if (bigFish.entry && current.close < ema200) risks.push('吃大魚觸發時價格仍在 4 小時 EMA200 下方，長期趨勢尚未站回');

  const parts = {
    trend: (trendAligned ? 18 : 0) + (dailyTrendUp ? 12 : 0),
    relative: relative20d >= 5 ? 25 : relative20d > 0 ? 15 : 0,
    volume: Math.round(Math.min(s.volumeRatio / 2, 1) * 20),
    structure: s.retest || breakoutNow ? 15 : current.close >= s.breakout - atr14 * 0.75 ? 8 : 0,
    momentum: rsi14 >= 45 && rsi14 <= 70 && macd.hist[index] > macd.hist[index - 1] ? 10 : 0,
  };
  const reasons = [
    `4 小時成交額為前 20 根均值 ${s.volumeRatio.toFixed(2)} 倍`,
    `近 20 日報酬相對 SPY ${relative20d >= 0 ? '+' : ''}${relative20d.toFixed(2)} 個百分點`,
    `日線 EMA20／EMA50 ${dailyTrendUp ? '多頭排列' : '尚未多頭排列'}`,
  ];
  if (bigFish.earlyLong) reasons.unshift('經典吃大魚：MACD 金叉且收盤高於 EMA200 × 0.98');
  if (bigFish.trendLong) reasons.unshift('經典吃大魚：Supertrend（ATR 10、係數 4）翻綠');
  if (s.retest) reasons.push('先前放量突破後守住突破位，本根回踩再轉強');
  else if (breakoutNow) reasons.push('本根收盤突破前 20 根高點並放量');
  /** 失效價取近期低點與 EMA20-ATR 的較低者，僅供風險距離研究，跳空時無法保證成交。 */
  const invalidation = Math.min(Math.min(...intraday.slice(-4).map(candle => candle.low)), ema20 - atr14);
  return {
    version: US_STOCK_RADAR_RULES.version, phase,
    score: liquid ? Object.values(parts).reduce((sum, value) => sum + value, 0) : 0,
    parts, bigFish: { ...bigFish, timeframe: '4h' }, barTime: current.openTime,
    closedAt: current.closeTime ?? usStockFourHourClosedAt(current.openTime),
    price: current.close, change4h, change1d, changeDay,
    change20d, spyChange20d, relative20d, volumeRatio: s.volumeRatio, averageDollarVolume20d,
    breakout: s.breakout, ema20, ema50, ema200, dailyEma20, dailyEma50, rsi14, atr14,
    distanceEma20Atr, invalidation, dailyTrendUp, marketTrendUp, reasons, risks,
  };
}

/** 以後續實際交易時段 K 線追蹤，不把週末誤算成少一天，也不使用入選當根高低。 */
export function updateUsStockObservation(observation: UsStockObservation, candles: UsStockCandle[]): UsStockObservation {
  const future = candles.filter(candle => candle.openTime > observation.enteredAt);
  const next: UsStockObservation = { ...observation, returns: { ...observation.returns } };
  const unseen = future.filter(candle => (candle.closeTime ?? usStockFourHourClosedAt(candle.openTime)) > observation.checkedThrough);
  for (const candle of unseen) {
    next.maxRise = Math.max(next.maxRise, pct(candle.high, observation.entryPrice));
    next.maxFall = Math.min(next.maxFall, pct(candle.low, observation.entryPrice));
    next.checkedThrough = candle.closeTime ?? usStockFourHourClosedAt(candle.openTime);
  }
  for (const [key, bars] of [['h4', 1], ['d1', 2], ['d5', 10]] as const) {
    const candle = future[bars - 1];
    if (candle && next.returns[key] === null) next.returns[key] = pct(candle.close, observation.entryPrice);
  }
  next.complete = future.length >= 10 && Object.values(next.returns).every(value => value !== null);
  return next;
}
