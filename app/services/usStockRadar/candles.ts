/** @file 將 Yahoo 正常交易時段 1 小時資料合成美股 4 小時 K 線；不抓資料、不產生訊號。 */
import type { UsStockCandle } from './types';

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const newYorkDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
});

const clockParts = (time: number) => Object.fromEntries(newYorkClock.formatToParts(time)
  .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])) as { hour: number; minute: number };

/** Yahoo 最後一根正常交易時段 1h K 從 15:30 開始，實際只到 16:00，不能多算半小時。 */
export function usStockHourlyClosedAt(openTime: number) {
  const { hour, minute } = clockParts(openTime);
  return openTime + (hour === 15 && minute >= 30 ? HALF_HOUR_MS : HOUR_MS);
}

/** 舊快照沒有 closedAt 時使用：09:30 那根於 13:30 收盤，13:30 那根於 16:00 收盤。 */
export function usStockFourHourClosedAt(openTime: number) {
  const { hour } = clockParts(openTime);
  return openTime + (hour >= 13 ? 2.5 * HOUR_MS : 4 * HOUR_MS);
}

/**
 * 以紐約當地 09:30 開盤對齊，兩段分別為 09:30–13:30、13:30–16:00。
 * 必須逐小時齊全；缺資料時捨棄該段，不能依陣列位置把下午 K 拼到上午造成假金叉。
 * 夏令時間由時區轉換處理；提早收盤日未取得完整正常時段時不自行猜測收盤時間。
 */
export function aggregateUsStockFourHourCandles(hourly: UsStockCandle[]): UsStockCandle[] {
  const sessions = new Map<string, Map<number, UsStockCandle>>();
  for (const candle of [...hourly].sort((left, right) => left.openTime - right.openTime)) {
    const { hour, minute } = clockParts(candle.openTime);
    if (minute !== 30 || hour < 9 || hour > 15) continue;
    const key = newYorkDate.format(candle.openTime);
    const session = sessions.get(key) ?? new Map<number, UsStockCandle>();
    session.set(hour, candle);
    sessions.set(key, session);
  }
  const result: UsStockCandle[] = [];
  for (const session of sessions.values()) {
    for (const hours of [[9, 10, 11, 12], [13, 14, 15]]) {
      const chunk = hours.map(hour => session.get(hour));
      if (chunk.some(candle => !candle)) continue;
      const complete = chunk as UsStockCandle[];
      result.push({
        openTime: complete[0].openTime,
        closeTime: complete.at(-1)!.closeTime ?? usStockHourlyClosedAt(complete.at(-1)!.openTime),
        open: complete[0].open,
        high: Math.max(...complete.map(candle => candle.high)),
        low: Math.min(...complete.map(candle => candle.low)),
        close: complete.at(-1)!.close,
        volume: complete.reduce((sum, candle) => sum + candle.volume, 0),
      });
    }
  }
  return result;
}
