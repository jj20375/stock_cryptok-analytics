/** @file 登入後讀取選定股票的公開參考資料；格式驗證在任何外部請求之前完成。 */
import type { LoaderFunctionArgs } from 'react-router';
import { getUserId } from '../utils/auth';
import { buildStockBrief } from '../services/stockBrief/brief.server';
import { normalizeBriefSymbol, type BriefMarket } from '../services/stockBrief/types';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: any } }).cloudflare.env;
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!await getUserId(request, env)) return Response.json({ error: '請先登入以查看基本面與消息。' }, { status: 401, headers });
  const url = new URL(request.url), market = url.searchParams.get('market') ?? '';
  const symbol = normalizeBriefSymbol(url.searchParams.get('symbol') ?? '', market);
  if (!symbol) return Response.json({ error: '請選擇有效的台股或美股代號。' }, { status: 400, headers });
  try {
    return Response.json(await buildStockBrief(symbol, market as BriefMarket), { headers });
  } catch {
    return Response.json({ error: '參考資料暫時無法載入，請稍後重試。' }, { status: 502, headers });
  }
}
