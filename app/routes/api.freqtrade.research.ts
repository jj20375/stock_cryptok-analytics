/** @file 登入後讀取共用模擬研究；不暴露任何控制端點，禁止共享快取。 */
import type { LoaderFunctionArgs } from 'react-router';
import { getUserId } from '../utils/auth';
import { loadResearchDashboard } from '../services/freqtrade/research.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any).cloudflare.env;
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!await getUserId(request, env)) return Response.json({ error: '請先登入' }, { status: 401, headers });
  const data = await loadResearchDashboard(env);
  return Response.json(data, { status: data.error ? 503 : 200, headers });
}
