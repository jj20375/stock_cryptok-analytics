/**
 * @file Solana 迷因幣防 Rug 戰情室 API 路由。
 * 只負責認證檢查與 request/response 轉發，核心 14 關審查與帳本邏輯皆位於 `app/services/memeDesk/`。
 */
import { drizzle } from 'drizzle-orm/d1';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { ensureMemeDeskTables, sellMemePosition, watchMemePositions } from '../services/memeDesk/book';
import {
  checkSolanaMint,
  loadMemeDeskDashboard,
  scanFreshSolanaTokens,
  type MemeDeskEnv,
} from '../services/memeDesk/deskRunner';
import { fetchDexPoolSnapshot } from '../services/memeDesk/market';
import type { MemeCheckResult } from '../services/memeDesk/types';
import { getUserId } from '../utils/auth';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: MemeDeskEnv } }).cloudflare.env;
  if (!await getUserId(request, env as Record<string, any>)) {
    return Response.json({ error: '請先登入' }, { status: 401 });
  }
  const payload = await loadMemeDeskDashboard(env);
  return Response.json(payload);
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context as { cloudflare: { env: MemeDeskEnv } }).cloudflare.env;
  if (!await getUserId(request, env as Record<string, any>)) {
    return Response.json({ error: '請先登入' }, { status: 401 });
  }

  try {
    const body: any = await request.json();
    const intent = String(body?.intent || '');

    if (intent === 'check_mint') {
      const mint = String(body?.mint || '').trim();
      const bypassLimits = Boolean(body?.bypassLimits);
      const result = await checkSolanaMint(env, mint, {
        bypassLimits,
        prefetchedRugcheckRaw: body?.prefetchedRugcheckRaw,
        prefetchedDexRaw: body?.prefetchedDexRaw,
      });
      return Response.json({ ok: true, result });
    }

    if (intent === 'scan_fresh') {
      /**
       * 若瀏覽器端已預先抓好最新 5 顆代幣的公開資料（防止本機開發伺服器處於受限網路環境），
       * 直接逐顆傳入 checkSolanaMint 進行 14 關審查與寫入 D1；否則由伺服器端直接抓取。
       */
      if (Array.isArray(body?.prefetchedTokens) && body.prefetchedTokens.length > 0) {
        const results: MemeCheckResult[] = [];
        for (const item of body.prefetchedTokens.slice(0, 5)) {
          const mint = String(item?.mint || '').trim();
          if (!mint) continue;
          const res = await checkSolanaMint(env, mint, {
            bypassLimits: true,
            prefetchedRugcheckRaw: item?.rugcheckRaw,
            prefetchedDexRaw: item?.dexRaw,
          });
          results.push(res);
        }
        return Response.json({ ok: true, results });
      }

      const results = await scanFreshSolanaTokens(env);
      return Response.json({ ok: true, results });
    }

    if (intent === 'watch_positions') {
      if (!env.DB) return Response.json({ error: '未設定 D1 資料庫' }, { status: 500 });
      await ensureMemeDeskTables(env.DB);
      const events = await watchMemePositions(drizzle(env.DB));
      return Response.json({ ok: true, events });
    }

    if (intent === 'close_position') {
      if (!env.DB) return Response.json({ error: '未設定 D1 資料庫' }, { status: 500 });
      const mint = String(body?.mint || '').trim();
      await ensureMemeDeskTables(env.DB);
      const db = drizzle(env.DB);
      const pool = await fetchDexPoolSnapshot(mint).catch(() => null);
      const exitPrice = pool?.priceUsd ?? Number(body?.fallbackPrice || 0);
      const closed = await sellMemePosition(db, mint, 1.0, exitPrice, 'manual');
      return Response.json({ ok: true, closed });
    }

    return Response.json({ error: `不支援的操作: ${intent}` }, { status: 400 });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || '執行失敗' },
      { status: 400 },
    );
  }
}
