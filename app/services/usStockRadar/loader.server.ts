/** @file 美股雷達頁只讀登入者可見的 D1 快照；重新整理不觸發外部行情或 Slack。 */
import { desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { usStockObservations, usStockRadar, usStockRadarRun } from '../../db/usStockRadarSchema';
import { getUserId } from '../../utils/auth';
import { US_STOCK_RADAR_RULES, type UsStockObservation, type UsStockRadarRun, type UsStockSnapshot } from './types';

export async function loadUsStockRadar({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: Record<string, any> } }).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  const base = {
    now: Date.now(),
    enabled: env.US_STOCK_RADAR_ENABLED === 'true',
    /** 只回傳是否齊全，不把 Slack token 或頻道 ID 暴露到瀏覽器。 */
    slackConfigured: Boolean(env.SLACK_API_TOKEN && env.US_STOCK_SLACK_CHANNEL_ID),
  };
  try {
    const db = drizzle(env.DB);
    const [snapshots, observations, runs] = await Promise.all([
      db.select().from(usStockRadar),
      db.select().from(usStockObservations).orderBy(desc(usStockObservations.enteredAt)).limit(100),
      db.select().from(usStockRadarRun),
    ]);
    const parsedSnapshots = snapshots.map(row => JSON.parse(row.snapshotJson) as UsStockSnapshot);
    const parsedObservations = observations.map(row => JSON.parse(row.observationJson) as UsStockObservation);
    const run = runs[0]?.summaryJson ? JSON.parse(runs[0].summaryJson) as UsStockRadarRun : null;
    return {
      ...base,
      /** 週期改版後不把舊 15 分結果混入 4h／日線頁面或績效分母。 */
      snapshots: parsedSnapshots.filter(item => !item.signal || item.signal.version === US_STOCK_RADAR_RULES.version),
      observations: parsedObservations.filter(item => item.signal.version === US_STOCK_RADAR_RULES.version),
      run: run?.version === US_STOCK_RADAR_RULES.version ? run : null,
      error: null as string | null,
    };
  } catch {
    return { ...base, snapshots: [] as UsStockSnapshot[], observations: [] as UsStockObservation[],
      run: null as UsStockRadarRun | null, error: '美股雷達資料尚未就緒，請確認資料庫更新與排程設定。' };
  }
}
