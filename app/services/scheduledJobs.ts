/** @file 股票收盤與 Demo 自動化排程；一分鐘檢查訊號，每五分鐘執行既有持倉保護。 */
export const SCHEDULES = {
  /** UTC 05 點對應台北 13 點，兩段收盤各有兩次檢查／補送機會。 */
  twRadar: '8,23,38,53 5 * * 1-5',
  /** 同時涵蓋紐約夏令／冬令時間；休市及非收盤段由雷達新鮮度驗證略過。 */
  usRadar: '7,22,37,52 17,18,20,21 * * 1-5',
  protection: '* * * * *',
  twDaily: '0,15 6 * * 1-5',
  usDaily: '30,45 20,21 * * 1-5',
} as const;

/**
 * 台股開盤前羅盤快照時間：台北週一至週五 08:30（UTC 00:30，台灣無夏令時間）。
 * Cron Trigger 名額已用滿，因此掛在每分鐘的 protection 排程上，以排程時間判斷是否執行。
 */
export function isTwPreopenSnapshotTime(scheduledAt: number) {
  const at = new Date(scheduledAt);
  const weekday = at.getUTCDay();
  return weekday >= 1 && weekday <= 5 && at.getUTCHours() === 0 && at.getUTCMinutes() === 30;
}

/** 美股日報只在紐約 16:30／16:45 執行，另一個 UTC 時段直接略過，避免換季時重送或提早報告。 */
export function isUsDailyReportTime(scheduledAt: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(scheduledAt);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return hour === 16 && (minute === 30 || minute === 45);
}
