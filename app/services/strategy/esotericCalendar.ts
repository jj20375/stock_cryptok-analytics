/** @file 「玄學」時間假設（月相、水星逆行、吉凶數字時辰）的純函式；只供研究單獨檢驗，不得混入交易決策。 */
/**
 * 【詳細繁體中文註解】：玄學假設檢驗工具
 *
 * 這些因子沒有可信的經濟機制，放在獨立模組是為了：
 *   1. 與技術特徵分開單獨測試命中率，避免被組合模型「偷渡」進權重。
 *   2. 研究結果若無統計優勢，策略模組不 import 本檔（目前即如此）。
 *
 * 時間一律以毫秒 UTC 輸入；「台北時辰」使用 Asia/Taipei（UTC+8，無日光節約）。
 */

/** 天文朔望月平均長度（天）。 */
const SYNODIC_MONTH_DAYS = 29.530588853;
/** 參考新月時刻：2000-01-06 18:14 UTC（常用天文曆元）。 */
const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

/** 月齡（0 = 新月，約 14.77 = 滿月），以平均朔望月近似，誤差約半天，對 ±1 天窗口足夠。 */
export function moonAgeDays(timeMs: number): number {
  const days = (timeMs - REFERENCE_NEW_MOON_MS) / DAY_MS;
  return ((days % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
}

/**
 * 月相假設：新月 ±1 天 → +1（坊間「新月見底」說法）；滿月 ±1 天 → -1（「滿月見頂」說法）；其餘 0。
 */
export function moonPhaseSignal(timeMs: number): -1 | 0 | 1 {
  const age = moonAgeDays(timeMs);
  if (age <= 1 || age >= SYNODIC_MONTH_DAYS - 1) return 1;
  if (Math.abs(age - SYNODIC_MONTH_DAYS / 2) <= 1) return -1;
  return 0;
}

/**
 * 水星逆行期間（UTC 日期，含首尾日），資料取自公開星曆的常見發布日期，誤差 ±1 天。
 * 假設：逆行期間偏空（-1）。只涵蓋研究樣本期間 2024～2026。
 */
const MERCURY_RETROGRADES: [string, string][] = [
  ['2024-04-01', '2024-04-25'], ['2024-08-05', '2024-08-28'], ['2024-11-25', '2024-12-15'],
  ['2025-03-15', '2025-04-07'], ['2025-07-18', '2025-08-11'], ['2025-11-09', '2025-11-29'],
  ['2026-02-26', '2026-03-20'], ['2026-06-29', '2026-07-23'], ['2026-10-24', '2026-11-13'],
];
const RETROGRADE_RANGES = MERCURY_RETROGRADES.map(([from, to]) => [Date.parse(`${from}T00:00:00Z`), Date.parse(`${to}T23:59:59Z`)]);

export function mercuryRetrogradeSignal(timeMs: number): -1 | 0 {
  return RETROGRADE_RANGES.some(([from, to]) => timeMs >= from && timeMs <= to) ? -1 : 0;
}

/**
 * 吉凶數字時辰假設（華人諧音）：台北時間 8 點、18 點（「發」）→ +1；4 點、14 點（「死」）→ -1。
 * 傳入的是訊號 K 收盤時刻，即下一個 4 小時預測窗口的起點。
 */
export function luckyNumberHourSignal(timeMs: number): -1 | 0 | 1 {
  const taipeiHour = new Date(timeMs + 8 * 3_600_000).getUTCHours();
  if (taipeiHour === 8 || taipeiHour === 18) return 1;
  if (taipeiHour === 4 || taipeiHour === 14) return -1;
  return 0;
}
