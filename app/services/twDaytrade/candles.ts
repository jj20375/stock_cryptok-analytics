/** @file Yahoo 台股 15 分 K 驗證與交易時段工具；不使用未收盤、不補價格、不製造缺失成交量。 */
import { DAYTRADE_RULES, type DaytradeCandle } from './types';

/** 台北 UTC+8 無夏令時間；以交易日毫秒起點避免執行主機時區污染回測。 */
const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
export const sessionDay = (time: number) => Math.floor((time + TAIPEI_OFFSET_MS) / DAY_MS);
export const sessionMinute = (time: number) => Math.floor(((time + TAIPEI_OFFSET_MS) % DAY_MS) / 60_000);
export function entryWindow(time: number) {
  const minute = sessionMinute(time);
  return minute >= 9 * 60 + 15 && minute <= DAYTRADE_RULES.lastEntryMinute;
}
export function isFreshDaytradeBar(candle: Pick<DaytradeCandle, 'openTime' | 'closeTime'>, now: number) {
  return sessionDay(candle.openTime) === sessionDay(now) && entryWindow(now) &&
    candle.closeTime <= now && now - candle.closeTime <= DAYTRADE_RULES.maxAgeMs && entryWindow(candle.closeTime);
}

export function parseDaytradeChart(payload: unknown, cutoff: number): DaytradeCandle[] {
  const result = (payload as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>> } }> } })?.chart?.result?.[0];
  if (!result?.timestamp || !Array.isArray(result.timestamp)) throw new Error('Yahoo 沒有有效 15 分行情');
  const quote = result.indicators?.quote?.[0];
  if (!quote) throw new Error('Yahoo 缺少 OHLCV 資料');
  const unique = new Map<number, DaytradeCandle>();
  result.timestamp.forEach((timestamp, index) => {
    const openTime = timestamp * 1000, closeTime = openTime + DAYTRADE_RULES.intervalMs;
    const minute = sessionMinute(openTime);
    if (!Number.isFinite(openTime) || minute < 540 || minute > 795 || minute % 15 !== 0 || openTime % 60_000 !== 0 || closeTime > cutoff) return;
    const open = quote.open?.[index], high = quote.high?.[index], low = quote.low?.[index], close = quote.close?.[index], volume = quote.volume?.[index];
    if ([open, high, low, close, volume].some(value => typeof value !== 'number' || !Number.isFinite(value)) ||
      Math.min(open!, high!, low!, close!) <= 0 || volume! <= 0 || high! < Math.max(open!, close!) || low! > Math.min(open!, close!)) return;
    unique.set(openTime, { openTime, closeTime, open: open!, high: high!, low: low!, close: close!, volume: volume! });
  });
  return [...unique.values()].sort((a, b) => a.openTime - b.openTime);
}

/** 只有從 09:00 起連續完整的交易日才重放；歷史缺任何一根就整日排除，避免隱藏停損。 */
export function daytradeSessions(candles: DaytradeCandle[]) {
  const groups = new Map<number, DaytradeCandle[]>();
  for (const candle of candles) {
    const day = sessionDay(candle.openTime);
    const group = groups.get(day) ?? [];
    group.push(candle); groups.set(day, group);
  }
  return [...groups.values()].map(bars => ({ bars,
    contiguous: sessionMinute(bars[0].openTime) === 540 && bars.every((bar, i) => i === 0 || bar.openTime - bars[i - 1].openTime === DAYTRADE_RULES.intervalMs),
    complete: bars.length === 18 && sessionMinute(bars.at(-1)!.openTime) === 795,
  }));
}
