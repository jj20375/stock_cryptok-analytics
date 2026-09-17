/** @file 將 Yahoo 台股正常交易時段 1 小時資料合成 4 小時與收盤段 K 線。 */
import type { TwStockCandle } from './types';

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const taipeiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
});
const taipeiClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit',
});

const clockParts = (time: number) => Object.fromEntries(taipeiClock.formatToParts(time)
  .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])) as { hour: number; minute: number };

export function twStockHourlyClosedAt(openTime: number) {
  const { hour } = clockParts(openTime);
  return openTime + (hour === 13 ? HALF_HOUR_MS : HOUR_MS);
}

export function twStockFourHourClosedAt(openTime: number) {
  const { hour } = clockParts(openTime);
  return openTime + (hour >= 13 ? HALF_HOUR_MS : 4 * HOUR_MS);
}

/** 台股 09:00–13:00 合成第一根 4h，13:00–13:30 獨立為收盤段；不規則盤中快照直接忽略。 */
export function aggregateTwStockFourHourCandles(hourly: TwStockCandle[]): TwStockCandle[] {
  const sessions = new Map<string, TwStockCandle[]>();
  for (const candle of [...hourly].sort((left, right) => left.openTime - right.openTime)) {
    const { hour, minute } = clockParts(candle.openTime);
    if (minute !== 0 || hour < 9 || hour > 13) continue;
    const key = taipeiDate.format(candle.openTime);
    const session = sessions.get(key) ?? [];
    session.push(candle);
    sessions.set(key, session);
  }
  const result: TwStockCandle[] = [];
  for (const session of sessions.values()) {
    const first = session.filter(candle => clockParts(candle.openTime).hour < 13);
    if (first.length === 4) result.push({
      openTime: first[0].openTime, closeTime: first.at(-1)!.closeTime ?? twStockHourlyClosedAt(first.at(-1)!.openTime),
      open: first[0].open, high: Math.max(...first.map(candle => candle.high)), low: Math.min(...first.map(candle => candle.low)),
      close: first.at(-1)!.close, volume: first.reduce((sum, candle) => sum + candle.volume, 0),
    });
    const closing = session.find(candle => clockParts(candle.openTime).hour === 13);
    if (closing) result.push({ ...closing, closeTime: closing.closeTime ?? twStockHourlyClosedAt(closing.openTime) });
  }
  return result;
}
