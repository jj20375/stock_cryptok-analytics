/** @file 玄學模組的時間換算：時區日期、日期加減、台灣舊時制修正。全部不依賴執行環境的系統時區。 */

/** 一天的毫秒數。 */
export const DAY_MS = 86_400_000;

/** 年月日時分（牆上時鐘時間，不含時區）。 */
export interface WallTime { year: number; month: number; day: number; hour: number; minute: number }

/**
 * 台灣時鐘比標準時間（UTC+8）快 1 小時的區間，以 UTC 表示 [start, end)。
 * 資料來源：IANA tzdata `Asia/Taipei`（2026-11-09 以 Node Intl 逐小時掃描 1900–1985 取得）。
 * 1937-10-01～1945-09-20 是日治時期改用 UTC+9，其餘是日光節約時間；排盤一律換回 UTC+8 標準時間。
 */
export const TAIPEI_PLUS9_RANGES: ReadonlyArray<readonly [string, string]> = [
  ['1937-09-30T16:00:00Z', '1945-09-20T16:00:00Z'],
  ['1946-05-14T16:00:00Z', '1946-09-30T15:00:00Z'],
  ['1947-04-14T16:00:00Z', '1947-10-31T15:00:00Z'],
  ['1948-04-30T16:00:00Z', '1948-09-30T15:00:00Z'],
  ['1949-04-30T16:00:00Z', '1949-09-30T15:00:00Z'],
  ['1950-04-30T16:00:00Z', '1950-09-30T15:00:00Z'],
  ['1951-04-30T16:00:00Z', '1951-09-30T15:00:00Z'],
  ['1952-02-29T16:00:00Z', '1952-10-31T15:00:00Z'],
  ['1953-03-31T16:00:00Z', '1953-10-31T15:00:00Z'],
  ['1954-03-31T16:00:00Z', '1954-10-31T15:00:00Z'],
  ['1955-03-31T16:00:00Z', '1955-09-30T15:00:00Z'],
  ['1956-03-31T16:00:00Z', '1956-09-30T15:00:00Z'],
  ['1957-03-31T16:00:00Z', '1957-09-30T15:00:00Z'],
  ['1958-03-31T16:00:00Z', '1958-09-30T15:00:00Z'],
  ['1959-03-31T16:00:00Z', '1959-09-30T15:00:00Z'],
  ['1960-05-31T16:00:00Z', '1960-09-30T15:00:00Z'],
  ['1961-05-31T16:00:00Z', '1961-09-30T15:00:00Z'],
  ['1974-03-31T16:00:00Z', '1974-09-30T15:00:00Z'],
  ['1975-03-31T16:00:00Z', '1975-09-30T15:00:00Z'],
  ['1979-06-30T16:00:00Z', '1979-09-30T15:00:00Z'],
];
const PLUS9_MS = TAIPEI_PLUS9_RANGES.map(([s, e]) => [Date.parse(s), Date.parse(e)] as const);

/**
 * 把台灣出生的牆上時間換成 UTC+8 標準時間。
 * 做法：假設牆上時間是 +9 換成 UTC 瞬間，若該瞬間落在 +9 區間內就減 1 小時。
 * 區間交界的那一小時本身有歧義，命理實務上也無法分辨，這裡以「落在區間內」為準。
 */
export function toTaipeiStandardTime(wall: WallTime): { wall: WallTime; corrected: boolean } {
  const assumedPlus9Utc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour - 9, wall.minute);
  const corrected = PLUS9_MS.some(([start, end]) => assumedPlus9Utc >= start && assumedPlus9Utc < end);
  if (!corrected) return { wall, corrected: false };
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour - 1, wall.minute));
  return {
    wall: { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() },
    corrected: true,
  };
}

/** 回傳某個 UTC 瞬間在指定 IANA 時區的當地日期 YYYY-MM-DD（en-CA 格式即 ISO 日期）。 */
export function localDateOf(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(utcMs));
}

/** 'YYYY-MM-DD' 加減天數（以 UTC 計算日曆日，不受時區影響）。 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 年月日數字。 */
export function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}
