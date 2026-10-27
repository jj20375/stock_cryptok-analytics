/**
 * @file 即時戰略 Dashboard 的 API 資料入口：驗證登入、讀取使用者自己的回測摘要，再分派到各市場面板。
 * 只讀 D1 與公開行情；不寫入任何資料表、不觸發雷達排程、不推播、不下單。
 */
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { backtests } from '../../db/schema';
import { getUserId } from '../../utils/auth';
import { loadCryptoPanel } from './cryptoPanel.server';
import { loadStockPanel, STOCK_ADAPTERS } from './stockPanel.server';
import { DASHBOARD_RULES, isDashboardMarket, type DashboardMarket, type DashboardPanelData } from './types';
import { BIG_FISH_BACKTEST, backtestLookupKey, parseBacktestSummary, type BacktestSummary } from './validation';

type Env = Record<string, any>;

/** 依「使用者＋市場」快取 5 分鐘；多個分頁或快速切換面板時不重複抓公開行情。 */
const panelCache = new Map<string, { expiresAt: number; data: DashboardPanelData }>();
/** 同一個 key 的請求合併成一個進行中的 Promise，避免同時觸發多次即時補算。 */
const inflight = new Map<string, Promise<DashboardPanelData>>();

/** 只取使用者自己跑完的吃大魚 4 小時回測；同一標的保留最新一筆（id 由大到小，先寫入者優先）。 */
async function loadBacktests(db: ReturnType<typeof drizzle>, userId: number) {
  const map = new Map<string, BacktestSummary>();
  try {
    const rows = await db.select({ id: backtests.id, strategyId: backtests.strategyId, symbol: backtests.symbol,
      interval: backtests.interval, resultJson: backtests.resultJson }).from(backtests)
      .where(and(eq(backtests.userId, userId), eq(backtests.status, 'DONE'),
        eq(backtests.strategyId, BIG_FISH_BACKTEST.strategyId), eq(backtests.interval, BIG_FISH_BACKTEST.interval)))
      .orderBy(desc(backtests.id)).limit(200);
    for (const row of rows) {
      const summary = parseBacktestSummary(row);
      const key = backtestLookupKey(row.strategyId, row.interval, row.symbol);
      if (summary && !map.has(key)) map.set(key, summary);
    }
  } catch { /** 回測表不可用時所有訊號標示「未經回測驗證」，不影響清單本身。 */ }
  return map;
}

export async function buildDashboardPanel(env: Env, userId: number, market: DashboardMarket, now = Date.now()) {
  const db = env.DB ? drizzle(env.DB) : null;
  const backtestMap = db ? await loadBacktests(db, userId) : new Map<string, BacktestSummary>();
  if (market === 'CRYPTO') return loadCryptoPanel(db, backtestMap, now);
  return loadStockPanel(STOCK_ADAPTERS[market], db, backtestMap, now);
}

export async function strategyDashboardResponse(request: Request, env: Env) {
  const userId = await getUserId(request, env);
  if (!userId) return Response.json({ error: '請先登入' }, { status: 401 });
  const url = new URL(request.url);
  const market = url.searchParams.get('market');
  if (!isDashboardMarket(market)) return Response.json({ error: 'market 必須是 TW、US 或 CRYPTO' }, { status: 400 });
  const key = `${userId}:${market}`;
  const now = Date.now();
  const cached = panelCache.get(key);
  /** refresh=1 略過面板快取，但同一收盤段的補算結果仍沿用 service 內快取，不會重打全部行情。 */
  if (url.searchParams.get('refresh') !== '1' && cached && cached.expiresAt > now) {
    return Response.json({ panel: cached.data, cached: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  let task = inflight.get(key);
  if (!task) {
    task = buildDashboardPanel(env, userId, market, now).finally(() => inflight.delete(key));
    inflight.set(key, task);
  }
  try {
    const panel = await task;
    panelCache.set(key, { expiresAt: now + DASHBOARD_RULES.cacheTtlMs, data: panel });
    return Response.json({ panel, cached: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[Strategy Dashboard] 面板彙整失敗:', error instanceof Error ? error.message : error);
    return Response.json({ error: '面板資料彙整失敗，請稍後再試' }, { status: 500 });
  }
}
