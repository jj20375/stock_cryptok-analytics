/** @file 純量價分析與觀察績效追蹤；無請求、通知或下單副作用。 */
import { DAY_MS, FOUR_HOUR_MS, QUARTER_MS, RADAR_RULES, type RadarCandle, type RadarDepth,
  type RadarObservation, type RadarSignal, type TrendConfirmation } from './types';
import { BIG_FISH_RULES, type BigFishSignal } from './bigFish';

const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
const pct = (value: number, base: number) => (value / base - 1) * 100;

/** 未收盤資料可忽略，但已收盤資料有缺口、重複、非法價格或過期一律拒絕評分。 */
export function closedSeries(input: RadarCandle[], cutoff: number): RadarCandle[] {
  const candles = input.filter(c => c.openTime < cutoff).sort((a, b) => a.openTime - b.openTime);
  if (candles.length < RADAR_RULES.minBars) throw new Error('歷史不足，至少需要 352 根完整 15 分 K 線');
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.openTime, c.open, c.high, c.low, c.close, c.volume, c.turnover].every(Number.isFinite) ||
      c.openTime % QUARTER_MS !== 0 || c.openTime + QUARTER_MS > cutoff ||
      Math.min(c.open, c.close, c.low) <= 0 || c.volume < 0 || c.turnover < 0 ||
      c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close) ||
      (i > 0 && c.openTime !== candles[i - 1].openTime + QUARTER_MS)) {
      throw new Error('15 分行情含缺口或無效資料，暫停判斷');
    }
  }
  if (candles.at(-1)!.openTime + QUARTER_MS !== cutoff) throw new Error('缺少最新已收盤 15 分行情');
  return candles;
}

/**
 * 吃大魚專用的 4 小時已收盤序列驗證：只需 OHLC，至少 201 根（約 34 天）才能算 EMA200。
 * 缺根、未對齊 UTC 4 小時邊界或最新收盤未就緒一律拒絕，寧可本輪不顯示也不以錯誤序列判斷進場。
 */
export function closedFourHourSeries(input: RadarCandle[], fourHourCutoff: number): RadarCandle[] {
  const candles = input.filter(c => c.openTime < fourHourCutoff).sort((a, b) => a.openTime - b.openTime);
  if (candles.length < BIG_FISH_RULES.emaPeriod + 1) throw new Error('4 小時歷史不足 201 根，暫無法判斷吃大魚');
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.openTime, c.open, c.high, c.low, c.close].every(Number.isFinite) || c.openTime % FOUR_HOUR_MS !== 0 ||
      Math.min(c.open, c.close, c.low) <= 0 || c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close) ||
      (i > 0 && c.openTime !== candles[i - 1].openTime + FOUR_HOUR_MS)) {
      throw new Error('4 小時行情含缺口或無效資料，暫停判斷吃大魚');
    }
  }
  if (candles.at(-1)!.openTime + FOUR_HOUR_MS !== fourHourCutoff) throw new Error('缺少最新已收盤 4 小時行情');
  return candles;
}

/** 以 UTC 邊界組成完整週期；不足四根／十六根的尾端不能當成 1h／4h 收盤。 */
export function aggregate(candles: RadarCandle[], bars: number): RadarCandle[] {
  const result: RadarCandle[] = [];
  for (let i = 0; i + bars <= candles.length; i++) {
    if (candles[i].openTime % (QUARTER_MS * bars) !== 0) continue;
    const group = candles.slice(i, i + bars);
    if (!group.every((c, j) => c.openTime === group[0].openTime + j * QUARTER_MS)) continue;
    result.push({ openTime: group[0].openTime, open: group[0].open, close: group.at(-1)!.close,
      high: Math.max(...group.map(c => c.high)), low: Math.min(...group.map(c => c.low)),
      volume: group.reduce((sum, c) => sum + c.volume, 0), turnover: group.reduce((sum, c) => sum + c.turnover, 0) });
    i += bars - 1;
  }
  return result;
}

function trendUp(candles: RadarCandle[]) {
  if (candles.length < 21) return false;
  const average = mean(candles.slice(-20).map(c => c.close));
  return candles.at(-1)!.close > average && average > mean(candles.slice(-21, -1).map(c => c.close));
}

/**
 * 使用同一批 15 分已收盤資料合成中週期趨勢，避免多抓日線讓每輪掃描超出 Worker 請求預算。
 * 1000 根 15 分 K 線約十天，因此日線採 MA7；不足八根完整日線時保留 null，不用短歷史硬判日線向下。
 */
export function analyzeTrendConfirmation(fourHourly: RadarCandle[], daily: RadarCandle[]): TrendConfirmation {
  const unavailable: TrendConfirmation = {
    version: '4h-ma20-daily-ma7-v1', fourHourMa20: null, fourHourMa20Rising: null,
    fourHourPullback: 'UNAVAILABLE', dailyMa7: null, dailyTrend: null, confirmed: false,
  };
  if (fourHourly.length < 21) return unavailable;
  const current = fourHourly.at(-1)!;
  const previous = fourHourly.at(-2)!;
  const ma20 = mean(fourHourly.slice(-20).map(c => c.close));
  const previousMa20 = mean(fourHourly.slice(-21, -1).map(c => c.close));
  /** ATR14 只做回踩容忍帶；不產生交易停損，避免把確認指標誤當成下單規則。 */
  const atr = mean(fourHourly.slice(-14).map((candle, index) => {
    const priorClose = fourHourly[fourHourly.length - 15 + index].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - priorClose), Math.abs(candle.low - priorClose));
  }));
  const maRising = ma20 > previousMa20;
  const touchedMa = Math.min(previous.low, current.low) <= ma20 + atr * 0.5;
  const closeNearMa = current.close >= ma20 - atr * 0.5 && current.close - ma20 <= atr;
  const rebound = current.close > ma20 && current.close > previous.high;
  const fourHourPullback = maRising && touchedMa && closeNearMa
    ? rebound ? 'CONFIRMED' : 'FORMING'
    : 'NONE';
  if (daily.length < 8) return { ...unavailable, fourHourMa20: ma20, fourHourMa20Rising: maRising, fourHourPullback };
  const dailyMa7 = mean(daily.slice(-7).map(c => c.close));
  const previousDailyMa7 = mean(daily.slice(-8, -1).map(c => c.close));
  const dailyTrend = daily.at(-1)!.close > dailyMa7 && dailyMa7 > previousDailyMa7;
  return { version: '4h-ma20-daily-ma7-v1', fourHourMa20: ma20, fourHourMa20Rising: maRising,
    fourHourPullback, dailyMa7, dailyTrend, confirmed: fourHourPullback === 'CONFIRMED' && dailyTrend };
}

function bandWidth(candles: RadarCandle[]) {
  const prices = candles.map(c => c.close);
  const average = mean(prices);
  return 4 * Math.sqrt(mean(prices.map(p => (p - average) ** 2))) / average;
}

function structure(candles: RadarCandle[]) {
  const index = candles.length - 1;
  const current = candles[index];
  const atr = mean(candles.slice(-14).map((c, j) => {
    const previous = candles[index - 14 + j].close;
    return Math.max(c.high - c.low, Math.abs(c.high - previous), Math.abs(c.low - previous));
  }));
  if (!(atr > 0)) throw new Error('近期波動不足，無法建立有效突破距離');
  const levelAt = (i: number) => Math.max(...candles.slice(i - RADAR_RULES.breakoutBars, i).map(c => c.high));
  const volumeAt = (i: number) => {
    const average = mean(candles.slice(i - RADAR_RULES.volumeBars, i).map(c => c.turnover));
    return average > 0 ? candles[i].turnover / average : 0;
  };
  let breakout = levelAt(index);
  let retest = false;
  /** 先找最近四小時已發生且守住的放量突破，回踩續強沿用原突破價。 */
  for (let i = index - 1; i >= index - 16; i--) {
    const level = levelAt(i);
    if (candles[i].close > level && volumeAt(i) >= RADAR_RULES.volumeMultiple &&
      candles.slice(i + 1).every(c => c.close >= level) && current.low <= level + atr * 0.5 &&
      current.close > candles[index - 1].high && volumeAt(index) >= 1.2) {
      breakout = level;
      retest = true;
      break;
    }
  }
  const widths = Array.from({ length: 80 }, (_, offset) => bandWidth(candles.slice(index - 99 + offset, index - 79 + offset)));
  const threshold = [...widths].sort((a, b) => a - b)[15];
  /** 前八根曾落在自身過去帶寬的低 20% 才視為整理；不包含當根突破。 */
  const compressed = widths.slice(-8).some(width => width <= threshold);
  return { atr, breakout, retest, compressed, volumeRatio: volumeAt(index) };
}

/**
 * 所有報酬比較都以相同截止時間計算；相對強勢仍可能是跌得較少。
 * 吃大魚改由呼叫端以 4 小時 K 線另行計算後傳入（undefined 表示本輪尚未算到），這裡不再從 15 分 K 推算，
 * 因為 1000 根 15 分 K 只能合成約 62 根 4 小時線，不足 EMA200 所需的 201 根。
 */
export function analyzePotential(candles: RadarCandle[], btc: RadarCandle[], depth: RadarDepth,
  bigFish?: BigFishSignal | null): RadarSignal {
  const current = candles.at(-1)!;
  if (current.openTime !== btc.at(-1)?.openTime) throw new Error('BTC 與標的行情時間不一致');
  const change = (series: RadarCandle[], bars: number) => pct(series.at(-1)!.close, series.at(-1 - bars)!.close);
  const s = structure(candles);
  const hourly = aggregate(candles, 4);
  const fourHourly = aggregate(candles, 16);
  const daily = aggregate(candles, 96);
  const hourlyUp = trendUp(hourly);
  const fourHourlyUp = trendUp(fourHourly);
  const trendConfirmation = analyzeTrendConfirmation(fourHourly, daily);
  const relative1h = change(candles, 4) - change(btc, 4);
  const relative4h = change(candles, 16) - change(btc, 16);
  const relative24h = change(candles, 96) - change(btc, 96);
  const turnover24h = candles.slice(-96).reduce((sum, c) => sum + c.turnover, 0);
  const change24h = change(candles, 96);
  const distance = (current.close - s.breakout) / s.atr;
  const breakout = current.close > s.breakout && s.volumeRatio >= RADAR_RULES.volumeMultiple;
  const risks: string[] = [];
  if (turnover24h < RADAR_RULES.minTurnover) risks.push('已收盤近 24 小時成交額不足 500 萬 USDT');
  if (!Number.isFinite(depth.spreadPct) || depth.spreadPct < 0 || depth.spreadPct > RADAR_RULES.maxSpreadPct) risks.push('即時買賣價差不合格');
  if (![depth.bid, depth.ask].every(n => Number.isFinite(n) && n >= RADAR_RULES.minDepth)) risks.push('買賣盤深度不足');
  const excluded = risks.length > 0;
  let phase: RadarSignal['phase'] = 'WAIT';
  if (excluded) phase = 'EXCLUDED';
  else if (distance > RADAR_RULES.maxExtensionAtr || change24h > RADAR_RULES.maxChange24h) phase = 'EXTENDED';
  else if (s.retest) phase = 'RETEST';
  else if (breakout) phase = 'BREAKOUT';
  else if (distance >= -1 && distance <= 0 && relative1h > 0 && change(candles, 1) > 0 &&
    (s.volumeRatio >= 2 || (s.compressed && s.volumeRatio >= 1.3))) phase = 'WATCH';
  if (phase === 'EXTENDED') risks.push('偏離突破位或日內漲幅過大，等待整理');
  if (!hourlyUp) risks.push('1 小時趨勢尚未確認');
  if (!fourHourlyUp) risks.push('4 小時趨勢尚未向上');
  if (change(btc, 96) < 0) risks.push('BTC 近 24 小時下跌');
  if (change(candles, 4) <= 0 && relative1h > 0) risks.push('相對強勢僅代表跌得較少');
  /** 五項總分 100；流動性不合格歸零，其餘僅供同版本排序，非勝率。 */
  const parts = {
    volume: Math.round(Math.min(s.volumeRatio / 3, 1) * 25),
    relative: Math.round((Number(relative1h > 0) + Number(relative4h > 0) + Number(relative24h > 0)) / 3 * 25),
    structure: s.retest || breakout ? 25 : distance >= -1 && distance <= 0 ? 15 : 0,
    trend: (hourlyUp ? 7 : 0) + (fourHourlyUp ? 8 : 0), compression: s.compressed ? 10 : 0,
  };
  return { version: RADAR_RULES.version, bigFish, trendConfirmation, phase, score: excluded ? 0 : Object.values(parts).reduce((a, b) => a + b, 0), parts,
    barTime: current.openTime, price: current.close, change15m: change(candles, 1), change1h: change(candles, 4), change24h,
    relative1h, relative4h, relative24h, btcChange24h: change(btc, 96), volumeRatio: s.volumeRatio,
    breakout: s.breakout, distancePct: pct(current.close, s.breakout),
    invalidation: Math.min(...candles.slice(-4).map(c => c.low)), hourlyUp, fourHourlyUp, compressed: s.compressed,
    turnover24h, spreadPct: depth.spreadPct, depth, risks,
    reasons: [`15 分成交額為前 20 根均值 ${s.volumeRatio.toFixed(2)} 倍`,
      `距突破參考 ${pct(current.close, s.breakout).toFixed(2)}%`,
      `近 1 小時報酬領先 BTC ${relative1h.toFixed(2)} 個百分點`,
      ...(s.retest ? ['先前放量突破後守住原突破位，回踩再轉強'] : [])],
  };
}

/** 以入選 K 線收盤為研究基準，排除該根高低；歷史缺口永久標示，避免倖存者偏差。 */
export function updateObservation(observation: RadarObservation, candles: RadarCandle[]): RadarObservation {
  const end = observation.enteredAt + 7 * DAY_MS;
  const future = candles.filter(c => c.openTime >= observation.enteredAt && c.openTime < end);
  const unseen = future.filter(c => c.openTime >= observation.checkedThrough);
  const next = { ...observation, returns: { ...observation.returns } };
  if (unseen.length && unseen[0].openTime > observation.checkedThrough) next.error = '追蹤歷史有缺口，最大漲跌不完整';
  for (const c of unseen) {
    next.maxRise = Math.max(next.maxRise, pct(c.high, observation.entryPrice));
    next.maxFall = Math.min(next.maxFall, pct(c.low, observation.entryPrice));
    next.checkedThrough = c.openTime + QUARTER_MS;
  }
  for (const [key, hours] of [['h24', 24], ['h72', 72], ['d7', 168]] as const) {
    const target = observation.enteredAt + hours * 60 * 60 * 1000;
    const bar = future.find(c => c.openTime + QUARTER_MS === target);
    if (bar) next.returns[key] = pct(bar.close, observation.entryPrice);
    else if (candles.at(-1)!.openTime + QUARTER_MS >= target && next.returns[key] === null) next.error = '部分追蹤時間點缺少行情';
  }
  next.complete = next.checkedThrough >= end && !next.error && Object.values(next.returns).every(n => n !== null);
  return next;
}
