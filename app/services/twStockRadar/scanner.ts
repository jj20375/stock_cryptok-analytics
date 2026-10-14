import { STOCK_NOTICE_WINDOW_MS } from '../stockSignalFreshness';
/** @file 台股 4 小時進場、日線確認雷達排程與獨立 Slack 佇列；絕不下單。 */
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { twStockObservations, twStockRadar, twStockRadarNotifications, twStockRadarRun } from '../../db/twStockRadarSchema';
import { slackPostFromStored } from '../slack/cryptoSignalCard';
import { US_STOCK_PHASE_LABELS } from '../usStockRadar/types';
import { analyzeTwStock, updateTwStockObservation } from './analysis';
import { twStockFourHourClosedAt } from './candles';
import { assertFreshTwStockBar, fetchTwStockCandles, fetchTwStockUniverse, selectTwStockCandidates } from './market';
import { formatTwStockCard, selectTwStockNotice } from './notifications';
import { isTwStockCandidate, TW_STOCK_DAY_MS, TW_STOCK_FOUR_HOUR_MS, TW_STOCK_RADAR_RULES,
  type TwStockObservation, type TwStockRadarRun, type TwStockSnapshot } from './types';

export interface TwStockRadarEnv {
  DB: Parameters<typeof drizzle>[0];
  TW_STOCK_RADAR_ENABLED?: string;
  SLACK_API_TOKEN?: string;
  /** 台股訊號只允許送往專用頻道，刻意不 fallback 到日報、美股或虛擬幣頻道。 */
  TW_STOCK_SLACK_CHANNEL_ID?: string;
}

export { US_STOCK_PHASE_LABELS };
type RadarDb = ReturnType<typeof drizzle>;

const SCAN_LIMIT_WITH_TRACKING = TW_STOCK_RADAR_RULES.selectionLimit + 1;
const BUDGET_MS = 4 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const MAX_NOTIFICATIONS_PER_RUN = 3;
const BENCHMARK = '0050.TW';
export const twStockSlackChannel = (env: TwStockRadarEnv) => env.TW_STOCK_SLACK_CHANNEL_ID?.trim() || null;

function parseSnapshot(value: string): TwStockSnapshot | null {
  try { return JSON.parse(value) as TwStockSnapshot; } catch { return null; }
}
function parseObservation(value: string): TwStockObservation | null {
  try { return JSON.parse(value) as TwStockObservation; } catch { return null; }
}

async function collectScan(db: RadarDb, startedAt: number, notificationsEnabled: boolean) {
  /** 非 13:00／13:30 新收盤時只需讀取 0050，不展開十檔完整掃描。 */
  const benchmarkIntraday = await fetchTwStockCandles(BENCHMARK, '4h', startedAt);
  let marketBarTime: number;
  try { marketBarTime = assertFreshTwStockBar(benchmarkIntraday.candles, startedAt); }
  catch {
    const summary: TwStockRadarRun = {
      version: TW_STOCK_RADAR_RULES.version, startedAt, completedAt: 0, eligible: 0, selected: 0,
      scanned: 0, candidates: 0, bigFishSignals: 0, failed: 0, skipped: true,
      error: '台股目前休市，或最新 4 小時收盤資料尚未就緒',
    };
    return { snapshots: [] as TwStockSnapshot[], observations: [] as TwStockObservation[],
      notifications: [] as Array<{ id: string; symbol: string; barTime: number; detectedAt: number; message: string }>, summary };
  }
  const [benchmarkDaily, universe, observationRows, previousRows] = await Promise.all([
    fetchTwStockCandles(BENCHMARK, '1d', startedAt), fetchTwStockUniverse(),
    db.select().from(twStockObservations).where(gte(twStockObservations.enteredAt, startedAt - 16 * TW_STOCK_DAY_MS)),
    db.select().from(twStockRadar),
  ]);
  const observations = observationRows.map(row => parseObservation(row.observationJson))
    .filter((item): item is TwStockObservation => !!item && item.signal.version === TW_STOCK_RADAR_RULES.version);
  const previousBySymbol = new Map(previousRows.map(row => [row.symbol, parseSnapshot(row.snapshotJson)]));
  const selected = selectTwStockCandidates(universe, Math.floor(marketBarTime / TW_STOCK_FOUR_HOUR_MS));
  /** 每輪多帶一檔未完成樣本，退榜股票仍可完成五日研究追蹤。 */
  for (const row of [...observationRows].sort((left, right) => left.checkedAt - right.checkedAt)) {
    if (selected.length >= SCAN_LIMIT_WITH_TRACKING) break;
    const observation = observations.find(item => item.id === row.id);
    if (observation && !observation.complete && !selected.some(item => item.symbol === observation.symbol)) {
      selected.push({ symbol: observation.symbol, name: observation.name, price: 0, changePct: 0, volume: 0, averageVolume3m: 0 });
    }
  }

  const snapshots: TwStockSnapshot[] = [];
  const updates = new Map<string, TwStockObservation>();
  const notifications: Array<{ id: string; symbol: string; barTime: number; detectedAt: number; message: string }> = [];
  const summary: TwStockRadarRun = {
    version: TW_STOCK_RADAR_RULES.version, barTime: marketBarTime, startedAt, completedAt: 0,
    eligible: universe.length, selected: selected.length, scanned: 0, candidates: 0,
    bigFishSignals: 0, failed: 0, skipped: false, error: null,
  };
  for (const ticker of selected) {
    if (Date.now() - startedAt >= BUDGET_MS) { summary.error = '本輪時間預算用盡，未掃描標的等待下一輪'; break; }
    try {
      const [intraday, daily] = await Promise.all([
        fetchTwStockCandles(ticker.symbol, '4h', startedAt), fetchTwStockCandles(ticker.symbol, '1d', startedAt),
      ]);
      assertFreshTwStockBar(intraday.candles, startedAt);
      for (const observation of observations.filter(item => item.symbol === ticker.symbol && !item.complete)) {
        updates.set(observation.id, updateTwStockObservation(observation, intraday.candles));
      }
      if (selected.indexOf(ticker) >= TW_STOCK_RADAR_RULES.selectionLimit) { summary.scanned++; continue; }
      const signal = analyzeTwStock(intraday.candles, daily.candles, benchmarkIntraday.candles, benchmarkDaily.candles);
      const snapshot: TwStockSnapshot = {
        symbol: intraday.symbol, name: intraday.name || ticker.name, checkedAt: Date.now(), signal, error: null,
      };
      snapshots.push(snapshot); summary.scanned++;
      if (isTwStockCandidate(signal)) summary.candidates++;
      if (signal.bigFish.entry) summary.bigFishSignals++;
      const notice = notificationsEnabled ? selectTwStockNotice(snapshot, previousBySymbol.get(snapshot.symbol) ?? null) : null;
      if (notice) notifications.push({
        id: `${snapshot.symbol}:${signal.barTime}:${TW_STOCK_RADAR_RULES.version}:${notice}`,
        symbol: snapshot.symbol, barTime: signal.barTime, detectedAt: snapshot.checkedAt,
        message: formatTwStockCard(snapshot),
      });
      if (isTwStockCandidate(signal) && !observations.some(item => item.symbol === snapshot.symbol && startedAt - item.detectedAt < TW_STOCK_DAY_MS)) {
        const id = `${snapshot.symbol}:${signal.barTime}:${TW_STOCK_RADAR_RULES.version}`;
        updates.set(id, { id, symbol: snapshot.symbol, name: snapshot.name, enteredAt: signal.barTime,
          detectedAt: snapshot.checkedAt, entryPrice: signal.price, signal, checkedThrough: signal.closedAt,
          returns: { h4: null, d1: null, d5: null }, maxRise: 0, maxFall: 0, complete: false, error: null });
      }
    } catch (error) {
      snapshots.push({ symbol: ticker.symbol, name: ticker.name, checkedAt: Date.now(), signal: null,
        error: error instanceof Error ? error.message : '台股行情無法取得' });
      summary.failed++;
    }
  }
  return { snapshots, observations: [...updates.values()], notifications, summary };
}

async function publishScan(db: RadarDb, owner: string, scan: Awaited<ReturnType<typeof collectScan>>) {
  const now = Date.now();
  const owned = await db.update(twStockRadarRun).set({ expiresAt: now + LEASE_MS })
    .where(and(eq(twStockRadarRun.id, 'scan'), eq(twStockRadarRun.owner, owner), gte(twStockRadarRun.expiresAt, now + 60_000))).returning();
  if (!owned.length) return;
  const summaryWrite = db.update(twStockRadarRun).set({ summaryJson: JSON.stringify({ ...scan.summary, completedAt: now }) })
    .where(and(eq(twStockRadarRun.id, 'scan'), eq(twStockRadarRun.owner, owner)));
  const snapshotWrites = scan.snapshots.length ? [db.insert(twStockRadar).values(scan.snapshots.map(snapshot => ({
    symbol: snapshot.symbol, snapshotJson: JSON.stringify(snapshot), checkedAt: snapshot.checkedAt,
  }))).onConflictDoUpdate({ target: twStockRadar.symbol,
    set: { snapshotJson: sql`excluded.snapshot_json`, checkedAt: sql`excluded.checked_at` } })] : [];
  const observationWrites = [];
  for (let index = 0; index < scan.observations.length; index += 18) {
    const rows = scan.observations.slice(index, index + 18).map(observation => ({ id: observation.id,
      symbol: observation.symbol, enteredAt: observation.enteredAt, checkedAt: now,
      observationJson: JSON.stringify(observation) }));
    observationWrites.push(db.insert(twStockObservations).values(rows).onConflictDoUpdate({ target: twStockObservations.id,
      set: { checkedAt: sql`excluded.checked_at`, observationJson: sql`excluded.observation_json` } }));
  }
  const notificationWrites = scan.notifications.length
    ? [db.insert(twStockRadarNotifications).values(scan.notifications).onConflictDoNothing()] : [];
  await db.batch([summaryWrite, ...snapshotWrites, ...observationWrites, ...notificationWrites]);
}

/** 最新 4h 批次優先；較舊未送列直接捨棄，避免台股即時頻道出現歷史進場價。 */
async function deliverTwStockNotifications(db: RadarDb, env: TwStockRadarEnv) {
  const channel = twStockSlackChannel(env);
  if (!env.SLACK_API_TOKEN || !channel) return;
  try {
    const [newest] = await db.select({ barTime: twStockRadarNotifications.barTime }).from(twStockRadarNotifications)
      .where(isNull(twStockRadarNotifications.sentAt)).orderBy(desc(twStockRadarNotifications.barTime)).limit(1);
    if (!newest) return;
    if (Date.now() >= twStockFourHourClosedAt(newest.barTime) + STOCK_NOTICE_WINDOW_MS) {
      await db.delete(twStockRadarNotifications).where(isNull(twStockRadarNotifications.sentAt)); return;
    }
    await db.delete(twStockRadarNotifications).where(and(isNull(twStockRadarNotifications.sentAt),
      lt(twStockRadarNotifications.barTime, newest.barTime)));
    const pending = await db.select().from(twStockRadarNotifications).where(and(
      isNull(twStockRadarNotifications.sentAt), eq(twStockRadarNotifications.barTime, newest.barTime),
    )).orderBy(sql<number>`CASE WHEN ${twStockRadarNotifications.message} LIKE ${'%⭐%'} THEN 0 ELSE 1 END`,
      desc(twStockRadarNotifications.detectedAt)).limit(MAX_NOTIFICATIONS_PER_RUN);
    for (const event of pending) {
      try {
        const post = slackPostFromStored(event.message);
        const response = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST',
          signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SLACK_API_TOKEN}` },
          body: JSON.stringify({ channel, ...post, mrkdwn: true }) });
        const result = await response.json() as { ok?: boolean };
        if (!response.ok || !result.ok) break;
        await db.update(twStockRadarNotifications).set({ sentAt: Date.now() }).where(eq(twStockRadarNotifications.id, event.id));
      } catch { break; }
    }
    await db.delete(twStockRadarNotifications).where(lt(twStockRadarNotifications.sentAt, Date.now() - 30 * TW_STOCK_DAY_MS));
  } catch { console.error('[TW Stock Radar] Slack 通知暫時無法處理，將於下一輪重試'); }
}

export async function runTwStockRadar(env: TwStockRadarEnv) {
  if (env.TW_STOCK_RADAR_ENABLED !== 'true') return;
  const db = drizzle(env.DB); const owner = crypto.randomUUID(); const startedAt = Date.now();
  try {
    const acquired = await db.insert(twStockRadarRun).values({ id: 'scan', owner, expiresAt: startedAt + LEASE_MS })
      .onConflictDoUpdate({ target: twStockRadarRun.id, set: { owner, expiresAt: startedAt + LEASE_MS },
        setWhere: lt(twStockRadarRun.expiresAt, startedAt) }).returning();
    if (!acquired.length) return;
    try {
      const previous = acquired[0].summaryJson ? JSON.parse(acquired[0].summaryJson) as TwStockRadarRun : null;
      const benchmark = await fetchTwStockCandles(BENCHMARK, '4h', startedAt);
      let currentBarTime: number | undefined;
      try { currentBarTime = assertFreshTwStockBar(benchmark.candles, startedAt); } catch { currentBarTime = undefined; }
      const completedSameBar = currentBarTime != null && previous?.version === TW_STOCK_RADAR_RULES.version &&
        previous.barTime === currentBarTime && !previous.error && previous.failed === 0;
      if (!completedSameBar) await publishScan(db, owner, await collectScan(db, startedAt,
        Boolean(env.SLACK_API_TOKEN && twStockSlackChannel(env))));
    } catch (error) {
      console.error('[TW Stock Radar] 本輪分析未完成:', error instanceof Error ? error.message : '未知錯誤');
      const summary: TwStockRadarRun = { version: TW_STOCK_RADAR_RULES.version, startedAt, completedAt: Date.now(),
        eligible: 0, selected: 0, scanned: 0, candidates: 0, bigFishSignals: 0, failed: 0, skipped: false,
        error: '本輪未完成：台股公開行情或資料庫暫時無法使用；舊榜單不代表最新機會' };
      await db.update(twStockRadarRun).set({ summaryJson: JSON.stringify(summary) })
        .where(and(eq(twStockRadarRun.id, 'scan'), eq(twStockRadarRun.owner, owner)));
    } finally {
      await deliverTwStockNotifications(db, env);
      await db.update(twStockRadarRun).set({ expiresAt: 0 })
        .where(and(eq(twStockRadarRun.id, 'scan'), eq(twStockRadarRun.owner, owner)));
    }
  } catch { console.error('[TW Stock Radar] 排程未完成，請檢查 0017 migration、Yahoo／證交所連線與環境設定'); }
}
