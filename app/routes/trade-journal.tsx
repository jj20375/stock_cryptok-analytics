/** @file 登入者自己的 Bitget 復盤；loader 唯讀，POST 僅同步資料或產生歷史週報。 */
import { redirect, useLoaderData, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router';
import { getUserId } from '../utils/auth';
import { journalPageData } from '../services/bitgetLedger/repository.server';
import { syncLedger } from '../services/bitgetLedger/sync.server';
import { generateJournalReview } from '../services/bitgetLedger/report.server';
import { journalCandles } from '../services/bitgetLedger/chart.server';
import type { LedgerEnv } from '../services/bitgetLedger/credentials.server';
import { JournalPage } from '../features/tradeJournal/JournalPage';
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' };
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as LedgerEnv, userId = await getUserId(request, env);
  if (!userId) throw redirect('/login');
  const url = new URL(request.url), days = Number(url.searchParams.get('days') || 30);
  try {
    const page = await journalPageData(env, userId, url.searchParams.get('account'), [7, 30, 89].includes(days) ? days : 30);
    return Response.json({ ...page, setupError: null }, { headers });
  } catch (error) {
    if (error instanceof Response) throw error;
    /** 未遷移的站台仍可打開導覽；不把 SQL、憑證或內部錯誤輸出給瀏覽器。 */
    return Response.json({ accounts: [], selected: null, journal: null, setupError: '帳本尚未就緒，請先套用資料庫遷移或查看伺服器紀錄' }, { headers });
  }
}
async function readSmallBody(request: Request) {
  if (!request.body) throw new Error('缺少請求內容');
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let length = 0, body = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2048) { await reader.cancel(); throw new Error('請求內容過大'); }
    body += decoder.decode(value, { stream: true });
  }
  return JSON.parse(body + decoder.decode()) as Record<string, unknown>;
}
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as LedgerEnv, userId = await getUserId(request, env);
  if (!userId) return Response.json({ error: '請先登入' }, { status: 401, headers });
  /** 帳本同步及 AI 成本都有副作用，必須同源 JSON POST 才可用登入 Cookie 操作。 */
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(request.url).origin ||
    !request.headers.get('Content-Type')?.startsWith('application/json')) {
    return Response.json({ error: '請使用本站操作介面' }, { status: 403, headers });
  }
  try {
    const body = await readSmallBody(request);
    if (body.operation === 'sync') {
      if (body.environment !== 'DEMO' && body.environment !== 'LIVE') throw new Error('請選擇 DEMO 或 LIVE');
      const days = Number(body.days ?? 30);
      if (![7, 30, 89].includes(days)) throw new Error('匯入天數不正確');
      if (body.dialect && !['UTA_V3', 'CLASSIC_V2'].includes(String(body.dialect))) throw new Error('帳戶種類不正確');
      const result = await syncLedger(env, userId, body.environment, days, body.dialect as 'UTA_V3' | 'CLASSIC_V2' | undefined);
      return Response.json(result, { headers });
    }
    if (typeof body.accountId !== 'string' || !/^[a-f0-9]{64}$/.test(body.accountId)) throw new Error('請選擇帳戶');
    if (body.operation === 'review') return Response.json(await generateJournalReview(env, userId, body.accountId), { headers });
    if (body.operation === 'chart' && typeof body.sessionId === 'string' && body.sessionId.length < 250) {
      return Response.json(await journalCandles(env, userId, body.accountId, body.sessionId), { headers });
    }
    throw new Error('操作不正確');
  } catch (error) {
    if (error instanceof Response) return error;
    /** 服務層錯誤使用固定安全文字；不回傳 stack、headers 或原始交易所錯誤。 */
    const message = error instanceof Error ? error.message : '操作未完成';
    const safe = /同步|Gemini|請|帳戶|憑證|成交|週報|模型|Bitget 歷史行情|K 線|資料已更新|本週沒有/.test(message) && !/SQL|select|insert|encrypted|secret|token|decrypt/i.test(message);
    return Response.json({ error: safe ? message.slice(0, 200) : '操作未完成，請檢查系統設定或稍後重試' }, { status: 400, headers });
  }
}
export default function TradeJournalRoute() {
  return <JournalPage data={useLoaderData() as Awaited<ReturnType<typeof journalPageData>> & { setupError: string | null }} />;
}
