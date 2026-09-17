/** @file 頁面只讀已驗證登入者可見的共享雷達快照；重新整理不觸發行情掃描或其他副作用。 */
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { getUserId } from '../../utils/auth';
import { potentialObservations, potentialRadar, potentialRun } from '../../db/potentialSchema';
import type { RadarObservation, RadarRun, RadarSnapshot } from './types';

export async function loadPotentialRadar({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: Record<string, any> } }).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  const base = { now: Date.now(), enabled: env.POTENTIAL_RADAR_ENABLED === 'true' };
  try {
    const db = drizzle(env.DB);
    const [rows, observations, runs] = await Promise.all([
      db.select().from(potentialRadar),
      db.select().from(potentialObservations).orderBy(desc(potentialObservations.enteredAt)).limit(100),
      db.select().from(potentialRun),
    ]);
    return { ...base, snapshots: rows.map(r => JSON.parse(r.snapshotJson) as RadarSnapshot),
      observations: observations.map(r => JSON.parse(r.observationJson) as RadarObservation),
      run: runs[0]?.summaryJson ? JSON.parse(runs[0].summaryJson) as RadarRun : null, error: null as string | null };
  } catch {
    return { ...base, snapshots: [] as RadarSnapshot[], observations: [] as RadarObservation[], run: null as RadarRun | null,
      error: '潛力幣資料尚未就緒，請先套用資料庫更新並確認排程設定。' };
  }
}
