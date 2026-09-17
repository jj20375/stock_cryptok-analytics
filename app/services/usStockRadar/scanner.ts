/** @file 美股 4 小時進場、日線確認雷達排程：動態初篩、研究追蹤與獨立 Slack 佇列；絕不下單。 */
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { usStockObservations, usStockRadar, usStockRadarNotifications, usStockRadarRun } from '../../db/usStockRadarSchema';
import { analyzeUsStock, updateUsStockObservation } from './analysis';
import { assertFreshUsStockBar, fetchUsStockCandles, fetchUsStockUniverse, selectUsStockCandidates } from './market';
import { slackPostFromStored } from '../slack/cryptoSignalCard';
import { formatUsStockCard, selectUsStockNotice } from './notifications';
import { isUsStockCandidate, US_STOCK_DAY_MS, US_STOCK_FOUR_HOUR_MS, US_STOCK_RADAR_RULES,
  type UsStockObservation, type UsStockRadarRun, type UsStockSnapshot } from './types';
import { usStockFourHourClosedAt } from './candles';

/** 美股頻道 ID 必須獨立設定；刻意不 fallback 到虛擬幣頻道，避免跨頻道誤發。 */
export interface UsStockRadarEnv {
  DB: Parameters<typeof drizzle>[0];
  US_STOCK_RADAR_ENABLED?: string;
  SLACK_API_TOKEN?: string;
  US_STOCK_SLACK_CHANNEL_ID?: string;
}
type RadarDb = ReturnType<typeof drizzle>;

/** 每檔需 1h（合成 4h）與日線各一個 Yahoo 請求；最多十檔加一檔歷史補算。 */
const SCAN_LIMIT_WITH_TRACKING = US_STOCK_RADAR_RULES.selectionLimit + 1;
const BUDGET_MS = 4 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const MAX_NOTIFICATIONS_PER_RUN = 3;

/** 美股頻道必須明確設定；即使 env 另有舊 SLACK_CHANNEL_ID 也不會被此雷達讀取。 */
export const usStockSlackChannel = (env: UsStockRadarEnv) => env.US_STOCK_SLACK_CHANNEL_ID?.trim() || null;

function parseSnapshot(value: string): UsStockSnapshot | null {
  try { return JSON.parse(value) as UsStockSnapshot; }
  catch { return null; }
}

function parseObservation(value: string): UsStockObservation | null {
  try { return JSON.parse(value) as UsStockObservation; }
  catch { return null; }
}

async function collectScan(db: RadarDb, startedAt: number, notificationsEnabled: boolean) {
  /** 先確認 SPY 最新 4 小時線；非新收盤時只需一個 Yahoo 請求，不掃整個標的池。 */
  const spyIntradayResult = await fetchUsStockCandles('SPY', '4h', startedAt);
  let marketBarTime: number;
  try {
    marketBarTime = assertFreshUsStockBar(spyIntradayResult.candles, startedAt);
  } catch {
    const summary: UsStockRadarRun = {
      version: US_STOCK_RADAR_RULES.version, startedAt, completedAt: 0, eligible: 0, selected: 0,
      scanned: 0, candidates: 0, bigFishSignals: 0, failed: 0, skipped: true,
      error: '美股目前休市，或最新 4 小時收盤資料尚未就緒',
    };
    return { snapshots: [] as UsStockSnapshot[], observations: [] as UsStockObservation[],
      notifications: [] as Array<{ id: string; symbol: string; barTime: number; detectedAt: number; message: string }>, summary };
  }
  const [spyDailyResult, universe, observationRows, previousRows] = await Promise.all([
    fetchUsStockCandles('SPY', '1d', startedAt),
    fetchUsStockUniverse(),
    db.select().from(usStockObservations).where(gte(usStockObservations.enteredAt, startedAt - 16 * US_STOCK_DAY_MS)),
    db.select().from(usStockRadar),
  ]);
  /** 新週期改版後不混用舊 15 分績效樣本；舊資料仍留在 D1 供稽核。 */
  const observations = observationRows.map(row => parseObservation(row.observationJson))
    .filter((item): item is UsStockObservation => !!item && item.signal.version === US_STOCK_RADAR_RULES.version);
  const previousBySymbol = new Map(previousRows.map(row => [row.symbol, parseSnapshot(row.snapshotJson)]));
  const selected = selectUsStockCandidates(universe, Math.floor(marketBarTime / US_STOCK_FOUR_HOUR_MS));
  /** 每輪多帶一檔尚未完成的舊樣本，讓退榜股票仍能完成五個交易日追蹤。 */
  for (const row of [...observationRows].sort((left, right) => left.checkedAt - right.checkedAt)) {
    if (selected.length >= SCAN_LIMIT_WITH_TRACKING) break;
    const observation = observations.find(item => item.id === row.id);
    if (observation && !observation.complete && !selected.some(item => item.symbol === observation.symbol)) {
      selected.push({ symbol: observation.symbol, name: observation.name, price: 0, changePct: 0, volume: 0, averageVolume3m: 0 });
    }
  }
  const snapshots: UsStockSnapshot[] = [];
  const observationUpdates = new Map<string, UsStockObservation>();
  const notifications: Array<{ id: string; symbol: string; barTime: number; detectedAt: number; message: string }> = [];
  const summary: UsStockRadarRun = {
    version: US_STOCK_RADAR_RULES.version, barTime: marketBarTime, startedAt, completedAt: 0,
    /** eligible 是 Yahoo 熱門榜去重後數量；固定輪替池另由 selected 顯示，不虛增市場池。 */
    eligible: universe.length, selected: selected.length, scanned: 0, candidates: 0,
    bigFishSignals: 0, failed: 0, skipped: false, error: null,
  };
  for (const ticker of selected) {
    if (Date.now() - startedAt >= BUDGET_MS) {
      summary.error = '本輪時間預算用盡，未掃描標的保留舊資料並等待下一輪';
      break;
    }
    try {
      const [intradayResult, dailyResult] = await Promise.all([
        ticker.symbol === 'SPY' ? Promise.resolve(spyIntradayResult) : fetchUsStockCandles(ticker.symbol, '4h', startedAt),
        ticker.symbol === 'SPY' ? Promise.resolve(spyDailyResult) : fetchUsStockCandles(ticker.symbol, '1d', startedAt),
      ]);
      assertFreshUsStockBar(intradayResult.candles, startedAt);
      for (const observation of observations.filter(item => item.symbol === ticker.symbol && !item.complete)) {
        observationUpdates.set(observation.id, updateUsStockObservation(observation, intradayResult.candles));
      }
      /** 歷史補算標的不在本輪初篩時只更新績效，不能因舊樣本繞過市場初篩重新入榜。 */
      const currentTicker = selected.indexOf(ticker) < US_STOCK_RADAR_RULES.selectionLimit;
      if (!currentTicker) {
        summary.scanned++;
        continue;
      }
      const signal = analyzeUsStock(intradayResult.candles, dailyResult.candles,
        spyIntradayResult.candles, spyDailyResult.candles);
      const snapshot: UsStockSnapshot = {
        symbol: ticker.symbol, name: intradayResult.name || ticker.name, checkedAt: Date.now(), signal, error: null,
      };
      snapshots.push(snapshot);
      summary.scanned++;
      if (isUsStockCandidate(signal)) summary.candidates++;
      if (signal.bigFish.entry) summary.bigFishSignals++;
      const notice = notificationsEnabled ? selectUsStockNotice(snapshot, previousBySymbol.get(ticker.symbol) ?? null) : null;
      if (notice) {
        notifications.push({
          id: `${ticker.symbol}:${signal.barTime}:${US_STOCK_RADAR_RULES.version}:${notice}`,
          symbol: ticker.symbol, barTime: signal.barTime, detectedAt: snapshot.checkedAt,
          message: formatUsStockCard(snapshot),
        });
      }
      /** 同檔六個小時內只建立一筆樣本；快照仍逐根更新，不讓延續訊號灌大量重複績效樣本。 */
      if (isUsStockCandidate(signal) && !observations.some(item => item.symbol === ticker.symbol && startedAt - item.detectedAt < 6 * 60 * 60 * 1000)) {
        const id = `${ticker.symbol}:${signal.barTime}:${US_STOCK_RADAR_RULES.version}`;
        observationUpdates.set(id, {
          id, symbol: ticker.symbol, name: snapshot.name, enteredAt: signal.barTime,
          detectedAt: snapshot.checkedAt, entryPrice: signal.price, signal,
          checkedThrough: signal.closedAt,
          returns: { h4: null, d1: null, d5: null }, maxRise: 0, maxFall: 0,
          complete: false, error: null,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Yahoo 行情無法取得';
      snapshots.push({ symbol: ticker.symbol, name: ticker.name, checkedAt: Date.now(), signal: null, error: reason });
      summary.failed++;
    }
  }
  return { snapshots, observations: [...observationUpdates.values()], notifications, summary };
}

/** 持有租約時才原子發布快照、績效與通知事件，舊排程不能覆蓋較新結果。 */
async function publishScan(db: RadarDb, owner: string, scan: Awaited<ReturnType<typeof collectScan>>) {
  const now = Date.now();
  const owned = await db.update(usStockRadarRun).set({ expiresAt: now + LEASE_MS })
    .where(and(eq(usStockRadarRun.id, 'scan'), eq(usStockRadarRun.owner, owner), gte(usStockRadarRun.expiresAt, now + 60_000)))
    .returning();
  if (!owned.length) return;
  const summaryWrite = db.update(usStockRadarRun)
    .set({ summaryJson: JSON.stringify({ ...scan.summary, completedAt: now }) })
    .where(and(eq(usStockRadarRun.id, 'scan'), eq(usStockRadarRun.owner, owner)));
  const snapshotRows = scan.snapshots.map(snapshot => ({
    symbol: snapshot.symbol, snapshotJson: JSON.stringify(snapshot), checkedAt: snapshot.checkedAt,
  }));
  const snapshotWrites = snapshotRows.length ? [db.insert(usStockRadar).values(snapshotRows).onConflictDoUpdate({
    target: usStockRadar.symbol,
    set: { snapshotJson: sql`excluded.snapshot_json`, checkedAt: sql`excluded.checked_at` },
  })] : [];
  /** 每列五個參數，每批十八列低於 D1 單一 SQL 的 100 個綁定參數限制。 */
  const observationWrites = [];
  for (let index = 0; index < scan.observations.length; index += 18) {
    const rows = scan.observations.slice(index, index + 18).map(observation => ({
      id: observation.id, symbol: observation.symbol, enteredAt: observation.enteredAt,
      checkedAt: now, observationJson: JSON.stringify(observation),
    }));
    observationWrites.push(db.insert(usStockObservations).values(rows).onConflictDoUpdate({
      target: usStockObservations.id,
      set: { checkedAt: sql`excluded.checked_at`, observationJson: sql`excluded.observation_json` },
    }));
  }
  const notificationWrites = scan.notifications.length
    ? [db.insert(usStockRadarNotifications).values(scan.notifications).onConflictDoNothing()] : [];
  await db.batch([summaryWrite, ...snapshotWrites, ...observationWrites, ...notificationWrites]);
}

/** 僅送往 US_STOCK_SLACK_CHANNEL_ID；成功後才標記，失敗事件留在 D1 下一輪重試。 */
async function deliverUsStockNotifications(db: RadarDb, env: UsStockRadarEnv) {
  const channel = usStockSlackChannel(env);
  if (!env.SLACK_API_TOKEN || !channel) return;
  try {
    const [newest] = await db.select({ barTime: usStockRadarNotifications.barTime })
      .from(usStockRadarNotifications).where(isNull(usStockRadarNotifications.sentAt))
      .orderBy(desc(usStockRadarNotifications.barTime)).limit(1);
    if (!newest) return;
    /** 4 小時訊號最多保留一個 4h 週期；更新的批次仍會立即淘汰較舊待發列。 */
    if (Date.now() >= usStockFourHourClosedAt(newest.barTime) + US_STOCK_FOUR_HOUR_MS) {
      await db.delete(usStockRadarNotifications).where(isNull(usStockRadarNotifications.sentAt));
      return;
    }
    await db.delete(usStockRadarNotifications).where(and(
      isNull(usStockRadarNotifications.sentAt), lt(usStockRadarNotifications.barTime, newest.barTime),
    ));
    const pending = await db.select().from(usStockRadarNotifications).where(and(
      isNull(usStockRadarNotifications.sentAt), eq(usStockRadarNotifications.barTime, newest.barTime),
    )).orderBy(desc(usStockRadarNotifications.detectedAt)).limit(MAX_NOTIFICATIONS_PER_RUN);
    for (const event of pending) {
      try {
        const post = slackPostFromStored(event.message);
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SLACK_API_TOKEN}` },
          body: JSON.stringify({
            channel,
            ...post,
            mrkdwn: true,
          }),
        });
        const result = await response.json() as { ok?: boolean };
        if (!response.ok || !result.ok) break;
        await db.update(usStockRadarNotifications).set({ sentAt: Date.now() })
          .where(eq(usStockRadarNotifications.id, event.id));
      } catch { break; }
    }
    /** 已送事件保留三十天供稽核；過期未送事件直接捨棄。 */
    await db.delete(usStockRadarNotifications)
      .where(lt(usStockRadarNotifications.sentAt, Date.now() - 30 * US_STOCK_DAY_MS));
  } catch {
    console.error('[US Stock Radar] Slack 通知暫時無法處理，將於下一輪重試');
  }
}

export async function runUsStockRadar(env: UsStockRadarEnv) {
  if (env.US_STOCK_RADAR_ENABLED !== 'true') return;
  const db = drizzle(env.DB);
  const owner = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const acquired = await db.insert(usStockRadarRun).values({ id: 'scan', owner, expiresAt: startedAt + LEASE_MS })
      .onConflictDoUpdate({ target: usStockRadarRun.id, set: { owner, expiresAt: startedAt + LEASE_MS },
        setWhere: lt(usStockRadarRun.expiresAt, startedAt) }).returning();
    if (!acquired.length) return;
    try {
      const previous = acquired[0].summaryJson ? JSON.parse(acquired[0].summaryJson) as UsStockRadarRun : null;
      /** Yahoo 可能在下一輪才補齊上一根；只依真正 4h barTime 去重，不能只看 Cron 時間。 */
      const spy = await fetchUsStockCandles('SPY', '4h', startedAt);
      let currentBarTime: number | undefined;
      try { currentBarTime = assertFreshUsStockBar(spy.candles, startedAt); } catch { currentBarTime = undefined; }
      const completedSameBar = currentBarTime != null && previous?.version === US_STOCK_RADAR_RULES.version &&
        previous.barTime === currentBarTime && !previous.error && previous.failed === 0;
      if (!completedSameBar) {
        await publishScan(db, owner, await collectScan(db, startedAt,
          Boolean(env.SLACK_API_TOKEN && usStockSlackChannel(env))));
      }
    } catch (error) {
      console.error('[US Stock Radar] 本輪分析未完成:', error instanceof Error ? error.message : '未知錯誤');
      const summary: UsStockRadarRun = {
        version: US_STOCK_RADAR_RULES.version, startedAt, completedAt: Date.now(), eligible: 0,
        selected: 0, scanned: 0, candidates: 0, bigFishSignals: 0, failed: 0, skipped: false,
        error: '本輪未完成：Yahoo 公開行情或資料庫暫時無法使用；舊榜單不代表最新機會',
      };
      await db.update(usStockRadarRun).set({ summaryJson: JSON.stringify(summary) })
        .where(and(eq(usStockRadarRun.id, 'scan'), eq(usStockRadarRun.owner, owner)));
    } finally {
      await deliverUsStockNotifications(db, env);
      await db.update(usStockRadarRun).set({ expiresAt: 0 })
        .where(and(eq(usStockRadarRun.id, 'scan'), eq(usStockRadarRun.owner, owner)));
    }
  } catch {
    console.error('[US Stock Radar] 排程未完成，請檢查 0016 migration、Yahoo 連線與環境設定');
  }
}
