/** @file 登入後讀取報告；頁面重新整理只讀 D1，手動掃描需同源 POST 並經共享租約限速。 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { stockTokenRadarRun } from '../../db/stockTokenRadarSchema';
import { getUserId } from '../../utils/auth';
import { runStockTokenRadar } from './runner.server';
import { STOCK_TOKEN_RULES, type StockTokenEnv, type StockTokenReport } from './types';

async function authenticatedEnv({ context, request }: LoaderFunctionArgs | ActionFunctionArgs) {
  const env = (context as { cloudflare: { env: StockTokenEnv } }).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  return env;
}

export async function loadStockTokenRadar(args: LoaderFunctionArgs) {
  const env = await authenticatedEnv(args);
  const base = { now: Date.now(), enabled: env.STOCK_TOKEN_RADAR_ENABLED === 'true',
    slackConfigured: Boolean(env.SLACK_API_TOKEN && env.US_STOCK_SLACK_CHANNEL_ID?.trim()) };
  try {
    const [row] = await drizzle(env.DB).select().from(stockTokenRadarRun).where(eq(stockTokenRadarRun.id, 'scan'));
    const report = row?.reportJson ? JSON.parse(row.reportJson) as StockTokenReport : null;
    return { ...base, report: report?.version === STOCK_TOKEN_RULES.version ? report : null, error: null as string | null };
  } catch {
    return { ...base, report: null as StockTokenReport | null, error: '代幣雷達尚未就緒，請確認 0030 migration 與 D1 設定。' };
  }
}

export async function scanStockTokenRadar(args: ActionFunctionArgs) {
  if (args.request.method !== 'POST') throw new Response('不支援此方法', { status: 405 });
  /** 手動掃描可能寫入 D1 並發 Slack，因此拒絕缺 Origin 或跨站提交；不接受任意報價或代號。 */
  if (args.request.headers.get('Origin') !== new URL(args.request.url).origin) throw new Response('請從本站發起掃描', { status: 403 });
  const env = await authenticatedEnv(args);
  try {
    const result = await runStockTokenRadar(env, { manual: true });
    const messages = { completed: '掃描完成；合格新訊號依頻道設定通知。', cooldown: '四分鐘內已掃描，請稍後再試。',
      busy: '已有掃描執行中，稍後重新整理。', disabled: '自動掃描未開啟。', error: '本輪行情無法取得，請查看報告錯誤。' };
    return { message: messages[result.status] };
  } catch { return { message: '掃描未完成，請確認資料庫與執行器連線。' }; }
}
