/** @file 共用研究讀取層；回測與模擬分開顯示，資料庫異常不能冒充沒有資料。 */
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq } from 'drizzle-orm';
import { freqtradeRuns } from '../../db/freqtradeSchema';
import { parseFreqtradeSyncPayload, type FreqtradeSyncPayload } from './sync';

export interface ResearchSnapshot extends FreqtradeSyncPayload { syncedAt: number; stale: boolean }
export interface ResearchDashboard { runs: ResearchSnapshot[]; error: string | null; checkedAt: number }

export async function loadResearchDashboard(env: { DB: D1Database }, now = Date.now()): Promise<ResearchDashboard> {
  try {
    const db = drizzle(env.DB);
    const runs: ResearchSnapshot[] = [];
    for (const mode of ['DRY_RUN', 'BACKTEST'] as const) {
      const [row] = await db.select().from(freqtradeRuns).where(eq(freqtradeRuns.mode, mode))
        .orderBy(desc(freqtradeRuns.generatedAt)).limit(1);
      if (!row) continue;
      const research = JSON.parse(row.researchJson);
      /** 歷史回測沒有心跳；驗證時間採原快照，超過一年仍能查看研究日期。 */
      const parsed = parseFreqtradeSyncPayload({ ...row, schemaVersion: 1, metrics: JSON.parse(row.metricsJson),
        ...(research.pairs ? { research } : {}),
      }, row.generatedAt);
      runs.push({ ...parsed, syncedAt: row.syncedAt,
        stale: mode === 'DRY_RUN' && (now - row.generatedAt > 5 * 60_000 || row.generatedAt > now + 60_000),
      });
    }
    return { runs, error: null, checkedAt: now };
  } catch {
    return { runs: [], error: '研究資料暫時無法讀取，請檢查資料庫更新與連線。', checkedAt: now };
  }
}
