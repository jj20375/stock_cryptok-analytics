/** @file 台股潛力雷達頁面資料；登入後才讀取 D1，且不外洩 Slack 憑證。 */
import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { twStockObservations, twStockRadar, twStockRadarRun } from '../../db/twStockRadarSchema';
import { getUserId } from '../../utils/auth';
import { TW_STOCK_RADAR_RULES, type TwStockObservation, type TwStockRadarRun, type TwStockSnapshot } from './types';

export async function loadTwStockRadar({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: Record<string, any> } }).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  const base = {
    now: Date.now(), enabled: env.TW_STOCK_RADAR_ENABLED === 'true',
    /** 只回傳是否已設定，token 與頻道 ID 絕不傳給瀏覽器。 */
    slackConfigured: Boolean(env.SLACK_API_TOKEN && env.TW_STOCK_SLACK_CHANNEL_ID),
  };
  try {
    const db = drizzle(env.DB);
    const [snapshots, observations, runs] = await Promise.all([
      db.select().from(twStockRadar),
      db.select().from(twStockObservations).orderBy(desc(twStockObservations.enteredAt)).limit(100),
      db.select().from(twStockRadarRun),
    ]);
    const parsedSnapshots = snapshots.map(row => JSON.parse(row.snapshotJson) as TwStockSnapshot);
    const parsedObservations = observations.map(row => JSON.parse(row.observationJson) as TwStockObservation);
    const run = runs[0]?.summaryJson ? JSON.parse(runs[0].summaryJson) as TwStockRadarRun : null;
    return {
      ...base,
      snapshots: parsedSnapshots.filter(item => !item.signal || item.signal.version === TW_STOCK_RADAR_RULES.version),
      observations: parsedObservations.filter(item => item.signal.version === TW_STOCK_RADAR_RULES.version),
      run: run?.version === TW_STOCK_RADAR_RULES.version ? run : null,
      error: null as string | null,
    };
  } catch {
    return { ...base, snapshots: [] as TwStockSnapshot[], observations: [] as TwStockObservation[],
      run: null as TwStockRadarRun | null, error: '台股雷達資料尚未就緒，請確認資料庫更新與排程設定。' };
  }
}
