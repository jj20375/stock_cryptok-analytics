/** @file 當沖研究頁面 loader；與現有台股雷達相同先驗證登入，再抓公開行情。 */
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { getUserId } from '../../utils/auth';
import { latestDaytradeScan } from './scanner.server';
import type { DaytradeScan } from './types';

export async function loadTwDaytrade({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: Record<string, unknown> } }).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  try { return { scan: await latestDaytradeScan(), error: null as string | null }; }
  catch { return { scan: null as DaytradeScan | null, error: '公開行情掃描未完成，請稍後重新掃描。' }; }
}
