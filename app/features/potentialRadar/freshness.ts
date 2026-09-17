/** @file 依收盤、排程與最新掃描摘要區分行情狀態；不延長舊訊號的有效期限。 */
import { QUARTER_MS, type RadarRun, type RadarSnapshot } from '../../services/potentialRadar/types';

/** 排程在收盤兩分鐘後啟動，最多五分鐘掃描；七分鐘後仍缺資料才列更新延遲。 */
const SCAN_OFFSET_MS = 120_000;
const SCAN_BUDGET_MS = 300_000;
export const scanDueAt = (now: number) => Math.floor(now / QUARTER_MS) * QUARTER_MS + SCAN_OFFSET_MS;
/** 頁面始終顯示下一個真正會啟動的排程，避免正常等待時被誤認為掃描卡住。 */
export const nextScanAt = (now: number) => {
  const current = scanDueAt(now);
  return current >= now ? current : current + QUARTER_MS;
};

export function snapshotFresh(snapshot: RadarSnapshot, now: number) {
  return !snapshot.error && !!snapshot.signal &&
    snapshot.signal.barTime + QUARTER_MS === Math.floor(now / QUARTER_MS) * QUARTER_MS;
}

export function snapshotState(snapshot: RadarSnapshot, now: number, run: RadarRun | null) {
  /** 退榜幣只為補算歷史績效，沒有最新訊號是預期狀態，不應計入資料異常。 */
  if (!snapshot.signal && snapshot.error?.includes('保留歷史追蹤')) return 'TRACKING';
  if (snapshot.error || !snapshot.signal) return 'ERROR';
  if (snapshotFresh(snapshot, now)) return 'FRESH';
  const cutoff = Math.floor(now / QUARTER_MS) * QUARTER_MS;
  /** 本輪已完成、但此幣沒有被選中，屬有限名額輪替；不能說成 API 抓取失敗。 */
  if (run && !run.error && run.completedAt >= run.startedAt && run.completedAt <= now &&
    Math.floor(run.startedAt / QUARTER_MS) * QUARTER_MS === cutoff && snapshot.checkedAt < run.startedAt) return 'ROTATING';
  if (!run?.error && snapshot.signal.barTime + 2 * QUARTER_MS === cutoff && now <= scanDueAt(now) + SCAN_BUDGET_MS) return 'WAITING';
  return 'DELAYED';
}

export const UPDATE_LABELS = {
  WAITING: '等待本輪排程更新', ROTATING: '本輪未選中，等待輪替掃描',
  TRACKING: '已離開合格池，只保留歷史績效追蹤', DELAYED: '更新延遲，尚未取得最新收盤',
};
