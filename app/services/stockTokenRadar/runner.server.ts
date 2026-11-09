/** @file rToken 排程與手動掃描：D1 租約防重疊、同版本同根去重，通知前重新驗證商品與報價。 */
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { stockTokenNotices, stockTokenRadarRun } from '../../db/stockTokenRadarSchema';
import { sendSlackPost } from '../slackService';
import { stockTokenNetRewardRisk, stockTokenPlanIssue } from './analysis';
import { loadStockTokenInstruments, loadStockTokenQuotes } from './market';
import { stockTokenNoticeId, stockTokenSlackCard } from './notifications';
import { collectStockTokenReport } from './scanner';
import { STOCK_TOKEN_RULES as RULES, type StockTokenCandidate, type StockTokenEnv, type StockTokenReport } from './types';

/** 租約四分鐘大於掃描上限150秒；進入發布與通知前續租，避免過期執行器覆寫新結果。 */
const LEASE_MS = 4 * 60_000;
type RadarDb = ReturnType<typeof drizzle>;

async function deliverNotices(db: RadarDb, env: StockTokenEnv, report: StockTokenReport) {
  const channel = env.US_STOCK_SLACK_CHANNEL_ID?.trim();
  if (env.STOCK_TOKEN_RADAR_ENABLED !== 'true' || !env.SLACK_API_TOKEN || !channel || report.error) return;
  const pending = await db.select().from(stockTokenNotices).where(and(isNull(stockTokenNotices.sentAt), gt(stockTokenNotices.expiresAt, Date.now())));
  if (!pending.length) return;
  const [instruments, quotes] = await Promise.all([loadStockTokenInstruments(), loadStockTokenQuotes()]);
  const tradable = new Set(instruments.map(item => item.symbol));
  const bySymbol = new Map(quotes.map(quote => [quote.symbol, quote]));
  const current = new Map(report.candidates.filter(c => c.status === 'ENTRY').map(c => [stockTokenNoticeId(c), c]));
  let sent = 0;
  for (const event of pending) {
    if (sent >= 3) break;
    /** 只使用本輪再次確認的計畫；新一輪未入選、已下架、追價或觸及失效的舊通知一律刪除。 */
    const candidate = current.get(event.id.slice(RULES.version.length + 1));
    const quote = bySymbol.get(event.symbol);
    const issue = !candidate?.plan || !quote || !tradable.has(event.symbol) ? '商品已下架、缺報價或本輪未入選'
      : stockTokenPlanIssue(candidate.plan, quote, Date.now());
    if (issue) {
      if (candidate) Object.assign(candidate, { status: 'WAIT', plan: null, quote: quote ?? null, reasons: [`通知前再驗證未通過：${issue}`] });
      await db.delete(stockTokenNotices).where(eq(stockTokenNotices.id, event.id));
      continue;
    }
    const refreshed: StockTokenCandidate = { ...candidate, quote, plan: { ...candidate.plan,
      riskPct: (quote.ask - candidate.plan.stopPrice) / quote.ask * 100,
      netRewardRisk: stockTokenNetRewardRisk(candidate.plan, quote.ask) } };
    /** Slack 成功才標記送達；Slack 已收但 D1 寫入失敗時可能重送一次，保留錯誤供下一輪重試。 */
    if (!await sendSlackPost(env.SLACK_API_TOKEN, channel, stockTokenSlackCard(refreshed))) throw new Error('Slack 發送失敗');
    Object.assign(candidate, refreshed);
    await db.update(stockTokenNotices).set({ sentAt: Date.now() }).where(eq(stockTokenNotices.id, event.id));
    sent++;
  }
}

export async function runStockTokenRadar(env: StockTokenEnv, options: { manual?: boolean } = {}) {
  if (!options.manual && env.STOCK_TOKEN_RADAR_ENABLED !== 'true') return { status: 'disabled' as const };
  const db = drizzle(env.DB), owner = crypto.randomUUID(), startedAt = Date.now();
  const acquired = await db.insert(stockTokenRadarRun).values({ id: 'scan', owner, expiresAt: startedAt + LEASE_MS })
    .onConflictDoUpdate({ target: stockTokenRadarRun.id, set: { owner, expiresAt: startedAt + LEASE_MS },
      setWhere: lt(stockTokenRadarRun.expiresAt, startedAt) }).returning();
  if (!acquired.length) return { status: 'busy' as const };
  try {
    const previous = acquired[0].reportJson ? JSON.parse(acquired[0].reportJson) as StockTokenReport : null;
    /** 共享四分鐘冷卻限制手動連點；失敗也保留冷卻，避免行情403時持續消耗外部配額。 */
    if (previous?.version === RULES.version && startedAt - previous.startedAt < LEASE_MS) return { status: 'cooldown' as const };
    let report: StockTokenReport;
    try { report = await collectStockTokenReport(startedAt); }
    catch (error) {
      report = { version: RULES.version, startedAt, completedAt: Date.now(), total: 0, eligible: 0, exclusions: {}, selected: 0, failed: 1, candidates: [],
        error: error instanceof Error ? error.message : 'Bitget 行情暫時無法使用' };
    }
    const renewed = await db.update(stockTokenRadarRun).set({ expiresAt: Date.now() + LEASE_MS })
      .where(and(eq(stockTokenRadarRun.id, 'scan'), eq(stockTokenRadarRun.owner, owner), gt(stockTokenRadarRun.expiresAt, Date.now()))).returning();
    if (!renewed.length) return { status: 'busy' as const };
    const notices = env.STOCK_TOKEN_RADAR_ENABLED === 'true' && env.SLACK_API_TOKEN && env.US_STOCK_SLACK_CHANNEL_ID?.trim()
      ? report.candidates.filter(c => c.status === 'ENTRY').map(candidate => ({ id: `${RULES.version}:${stockTokenNoticeId(candidate)}`,
        symbol: candidate.symbol, expiresAt: candidate.plan!.expiresAt, candidateJson: JSON.stringify(candidate) })) : [];
    /** 報告與通知事件一起發布；舊報告遇行情錯誤會被明確錯誤取代，不保留假即時候選。 */
    await db.batch([
      db.update(stockTokenRadarRun).set({ reportJson: JSON.stringify(report) }).where(and(eq(stockTokenRadarRun.id, 'scan'), eq(stockTokenRadarRun.owner, owner))),
      ...(notices.length ? [db.insert(stockTokenNotices).values(notices).onConflictDoNothing()] : []),
      db.delete(stockTokenNotices).where(lt(stockTokenNotices.expiresAt, Date.now() - 30 * 86_400_000)),
    ]);
    let notificationError: string | null = null;
    try { await deliverNotices(db, env, report); }
    catch { notificationError = 'Slack 通知或再驗價未完成，有效期內會重試'; }
    await db.update(stockTokenRadarRun).set({ reportJson: JSON.stringify({ ...report, notificationError }) })
      .where(and(eq(stockTokenRadarRun.id, 'scan'), eq(stockTokenRadarRun.owner, owner)));
    return { status: report.error ? 'error' as const : 'completed' as const, notificationError };
  } finally {
    await db.update(stockTokenRadarRun).set({ expiresAt: 0 }).where(and(eq(stockTokenRadarRun.id, 'scan'), eq(stockTokenRadarRun.owner, owner)));
  }
}
