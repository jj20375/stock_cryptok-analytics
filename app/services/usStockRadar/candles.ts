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
 * 每個正常交易日由 7 根 Yahoo 1h 組成：前四根合成完整 4h，後三根合成收盤段。
 * 最新交易日的收盤段只有在 15:30 原始 K 已收盤後才建立，避免盤中每小時漂移。
 */
export function aggregateUsStockFourHourCandles(hourly: UsStockCandle[]): UsStockCandle[] {
  /** Yahoo 會額外附一筆 16:00、成交量 0 的收盤快照；它不是新 K 線，必須先移除。 */
  const sorted = hourly.filter(candle => {
    const clock = clockParts(candle.openTime);
    return !(clock.hour >= 16 && candle.volume === 0);
  }).sort((left, right) => left.openTime - right.openTime);
  const sessions = new Map<string, UsStockCandle[]>();
  for (const candle of sorted) {
    const key = newYorkDate.format(candle.openTime);
    const session = sessions.get(key) ?? [];
    session.push(candle);
    sessions.set(key, session);
  }
  const latestKey = sorted.length ? newYorkDate.format(sorted.at(-1)!.openTime) : '';
  const result: UsStockCandle[] = [];
  for (const [key, session] of sessions) {
    const chunks = [session.slice(0, 4), session.slice(4, 8)];
    for (const [index, chunk] of chunks.entries()) {
      if (!chunk.length || (index === 0 && chunk.length < 4)) continue;
      /** 歷史日期已完整；最新日期的第二段必須看到 15:30 K，才代表正式收盤。 */
      if (index === 1 && key === latestKey && clockParts(chunk.at(-1)!.openTime).hour < 15) continue;
      result.push({
        openTime: chunk[0].openTime,
        closeTime: chunk.at(-1)!.closeTime ?? usStockHourlyClosedAt(chunk.at(-1)!.openTime),
        open: chunk[0].open,
        high: Math.max(...chunk.map(candle => candle.high)),
        low: Math.min(...chunk.map(candle => candle.low)),
        close: chunk.at(-1)!.close,
        volume: chunk.reduce((sum, candle) => sum + candle.volume, 0),
      });
    }
  }
  return result;
}
