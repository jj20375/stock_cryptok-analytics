/** @file 收盤後獨立掃描 Gate 永續 Mark Price，保存去重事件並以既有 Slack 設定補送；絕不下單。 */
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { binancePerpAlerts, binancePerpRun } from '../../db/binancePerpSchema';
import { analyzeBigFish } from '../potentialRadar/bigFish';
import { fetchMarkPriceCandles, fetchPerpUniverse, selectPerpCandidates } from './market';
import { formatPerpSignalCard } from './notifications';
import { slackPostFromStored } from '../slack/cryptoSignalCard';
import { classifyPerpSignal } from './quality';
import { BINANCE_PERP_RULES, PERP_DAY_MS, PERP_QUARTER_MS, type PerpAlert, type PerpRunSummary } from './types';

/** Slack 權杖與頻道只由 Worker secret 注入；公開 Gate 行情不需要 API key。 */
export interface BinancePerpEnv {
  DB: Parameters<typeof drizzle>[0];
  BINANCE_PERP_RADAR_ENABLED?: string;
  SLACK_API_TOKEN?: string;
  /** 虛擬幣即時進場價專用頻道；刻意不讀取一般報表頻道。 */
  CRYPTO_ENTRY_SLACK_CHANNEL_ID?: string;
  SLACK_CHANNEL_ID?: string;
}
type PerpDb = ReturnType<typeof drizzle>;

/** Cloudflare 排程必須在短時間內收尾；六檔並行可讓單一慢合約不再拖垮其餘 31 檔。 */
const BUDGET_MS = 20_000;
const LEASE_MS = 2 * 60 * 1000;
const SCAN_CONCURRENCY = 6;
/** 每五分鐘最多送一則；平均每十五分鐘三則，保留原吞吐量但避免同分鐘洗版。 */
const NOTIFICATIONS_PER_TICK = 1;
/** 純通知工作最多持有租約四十五秒；與 15 分掃描共用鎖，避免同一筆被並行送出兩次。 */
const NOTIFICATION_LEASE_MS = 45 * 1000;
export const cryptoEntrySlackChannel = (env: BinancePerpEnv) => env.CRYPTO_ENTRY_SLACK_CHANNEL_ID?.trim() || null;

async function collectScan(startedAt: number, notificationsEnabled: boolean) {
  const cutoff = Math.floor(startedAt / PERP_QUARTER_MS) * PERP_QUARTER_MS;
  const universe = await fetchPerpUniverse();
  const selected = selectPerpCandidates(universe, cutoff);
  const alerts: PerpAlert[] = [];
  const summary: PerpRunSummary = {
    version: BINANCE_PERP_RULES.version, startedAt, completedAt: 0, eligible: universe.length,
    selected: selected.length, scanned: 0, failed: 0, signals: 0, bestSignals: 0, error: null,
  };
  for (let start = 0; start < selected.length; start += SCAN_CONCURRENCY) {
    if (Date.now() - startedAt >= BUDGET_MS) {
      summary.error = '本輪時間預算用盡，未掃描標的等待下一輪';
      break;
    }
    const batch = selected.slice(start, start + SCAN_CONCURRENCY);
    const results = await Promise.all(batch.map(async ticker => {
      const found: PerpAlert[] = [];
      let signals = 0;
      let bestSignals = 0;
      try {
        const candles = await fetchMarkPriceCandles(ticker.symbol, cutoff);
        /** 依時間先後回算最近一小時；輪替或短暫停機後可補報，事件 ID 會阻止重複通知。 */
        for (let offset = BINANCE_PERP_RULES.recoveryBars - 1; offset >= 0; offset--) {
          const series = offset ? candles.slice(0, -offset) : candles;
          const signal = analyzeBigFish(series);
          if (!signal?.entry) continue;
          const quality = classifyPerpSignal(series, signal);
          signals++;
          if (quality.grade === 'BEST') bestSignals++;
          if (!notificationsEnabled) continue;
          const detectedAt = Date.now();
          found.push({
            id: `GATE:${ticker.symbol}:${signal.barTime}:${BINANCE_PERP_RULES.version}`,
            symbol: ticker.symbol,
            barTime: signal.barTime,
            detectedAt,
            message: formatPerpSignalCard({ ticker, signal, quality, markPrice: series.at(-1)!.close }),
          });
        }
        return { found, signals, bestSignals, failed: 0 };
      } catch {
        /** 單一合約下架、歷史不足或資料異常只增加失敗數，不阻斷同批其他標的。 */
        return { found, signals, bestSignals, failed: 1 };
      }
    }));
    for (const result of results) {
      alerts.push(...result.found);
      summary.signals += result.signals;
      summary.bestSignals += result.bestSignals;
      summary.failed += result.failed;
      if (!result.failed) summary.scanned++;
    }
  }
  return { alerts, summary };
}

/** 租約仍屬於本輪時才原子發布摘要與通知，逾時的舊工作不能覆蓋較新的掃描結果。 */
async function publishScan(db: PerpDb, owner: string, scan: Awaited<ReturnType<typeof collectScan>>) {
  const now = Date.now();
  const owned = await db.update(binancePerpRun).set({ expiresAt: now + LEASE_MS })
    .where(and(eq(binancePerpRun.id, 'scan'), eq(binancePerpRun.owner, owner), gte(binancePerpRun.expiresAt, now + 60_000)))
    .returning();
  if (!owned.length) return;
  const summaryWrite = db.update(binancePerpRun)
    .set({ summaryJson: JSON.stringify({ ...scan.summary, completedAt: now }) })
    .where(and(eq(binancePerpRun.id, 'scan'), eq(binancePerpRun.owner, owner)));
  /** 每列六個參數，分成每批十六列，確保 D1 單一 SQL 不超過 100 個綁定參數。 */
  const alertWrites = [];
  for (let index = 0; index < scan.alerts.length; index += 16) {
    alertWrites.push(db.insert(binancePerpAlerts).values(scan.alerts.slice(index, index + 16)).onConflictDoNothing());
  }
  await db.batch([summaryWrite, ...alertWrites]);
}

/** 只送最新且仍有效的收盤批次；舊批次直接捨棄，避免即時頻道出現歷史進場價。 */
async function deliverPerpAlerts(db: PerpDb, env: BinancePerpEnv, limit = NOTIFICATIONS_PER_TICK) {
  const channel = cryptoEntrySlackChannel(env);
  if (!env.SLACK_API_TOKEN || !channel) return;
  try {
    const [newest] = await db.select({ barTime: binancePerpAlerts.barTime }).from(binancePerpAlerts)
      .where(isNull(binancePerpAlerts.sentAt)).orderBy(desc(binancePerpAlerts.barTime)).limit(1);
    if (!newest) return;
    /** 一根新 15 分 K 已收盤後，上一根的進場價即失去即時性；未送列不再補發。 */
    const expired = Date.now() >= newest.barTime + 2 * PERP_QUARTER_MS;
    if (expired) {
      await db.delete(binancePerpAlerts).where(isNull(binancePerpAlerts.sentAt));
      return;
    }
    await db.delete(binancePerpAlerts).where(and(
      isNull(binancePerpAlerts.sentAt), lt(binancePerpAlerts.barTime, newest.barTime),
    ));
    const pending = await db.select().from(binancePerpAlerts).where(and(
      isNull(binancePerpAlerts.sentAt), eq(binancePerpAlerts.barTime, newest.barTime),
    ))
      /** 新版卡片前方有序列化前綴；最佳型先送，同級由最新偵測時間開始。 */
      .orderBy(sql<number>`CASE WHEN ${binancePerpAlerts.message} LIKE ${'%⭐%'} THEN 0 WHEN ${binancePerpAlerts.message} LIKE ${'%🟢%'} THEN 1 ELSE 2 END`,
        desc(binancePerpAlerts.detectedAt)).limit(limit);
    for (const alert of pending) {
      try {
        const post = slackPostFromStored(alert.message);
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST', signal: AbortSignal.timeout(4_000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SLACK_API_TOKEN}` },
          body: JSON.stringify({ channel, ...post, mrkdwn: true }),
        });
        const result = await response.json() as { ok?: boolean };
        /** Slack 限流或錯誤時保留待發列並停止本輪，避免快速重試造成洗版。 */
        if (!response.ok || !result.ok) break;
        await db.update(binancePerpAlerts).set({ sentAt: Date.now() }).where(eq(binancePerpAlerts.id, alert.id));
      } catch { break; }
    }
    /** 已送達事件保留三十天供稽核；過期未送事件已於上方直接捨棄。 */
    await db.delete(binancePerpAlerts).where(lt(binancePerpAlerts.sentAt, Date.now() - 30 * PERP_DAY_MS));
  } catch {
    console.error('[Perp Mark Radar] Slack 通知暫時無法處理，將於下輪重試');
  }
}

/**
 * 每五分鐘只處理一則既有 Slack 佇列，不抓行情也不建立新訊號。
 * 與完整掃描共用 D1 租約；若掃描正在執行，本輪安全略過並由下一次五分鐘排程接續。
 */
export async function runBinancePerpNotificationQueue(env: BinancePerpEnv) {
  if (env.BINANCE_PERP_RADAR_ENABLED !== 'true') return;
  const db = drizzle(env.DB);
  const owner = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const acquired = await db.insert(binancePerpRun)
      .values({ id: 'scan', owner, expiresAt: startedAt + NOTIFICATION_LEASE_MS })
      .onConflictDoUpdate({
        target: binancePerpRun.id,
        set: { owner, expiresAt: startedAt + NOTIFICATION_LEASE_MS },
        setWhere: lt(binancePerpRun.expiresAt, startedAt),
      }).returning();
    if (!acquired.length) return;
    try {
      await deliverPerpAlerts(db, env, NOTIFICATIONS_PER_TICK);
    } finally {
      await db.update(binancePerpRun).set({ expiresAt: 0 })
        .where(and(eq(binancePerpRun.id, 'scan'), eq(binancePerpRun.owner, owner)));
    }
  } catch {
    console.error('[Perp Mark Radar] 五分鐘通知佇列暫時無法處理，將於下一輪重試');
  }
}

export async function runBinancePerpRadar(env: BinancePerpEnv) {
  if (env.BINANCE_PERP_RADAR_ENABLED !== 'true') return;
  const db = drizzle(env.DB);
  const owner = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const acquired = await db.insert(binancePerpRun).values({ id: 'scan', owner, expiresAt: startedAt + LEASE_MS })
      .onConflictDoUpdate({ target: binancePerpRun.id, set: { owner, expiresAt: startedAt + LEASE_MS },
        setWhere: lt(binancePerpRun.expiresAt, startedAt) }).returning();
    if (!acquired.length) return;
    try {
      const previous = acquired[0].summaryJson ? JSON.parse(acquired[0].summaryJson) as PerpRunSummary : null;
      const completedSameBar = previous?.version === BINANCE_PERP_RULES.version && !previous.error && previous.failed === 0 &&
        Math.floor(previous.startedAt / PERP_QUARTER_MS) === Math.floor(startedAt / PERP_QUARTER_MS);
      if (!completedSameBar) {
        const notificationsEnabled = Boolean(env.SLACK_API_TOKEN && cryptoEntrySlackChannel(env));
        await publishScan(db, owner, await collectScan(startedAt, notificationsEnabled));
      }
    } catch {
      const summary: PerpRunSummary = {
        version: BINANCE_PERP_RULES.version, startedAt, completedAt: Date.now(), eligible: 0, selected: 0,
        scanned: 0, failed: 0, signals: 0, bestSignals: 0, error: '本輪未完成：Gate 公開行情或資料庫暫時無法使用',
      };
      await db.update(binancePerpRun).set({ summaryJson: JSON.stringify(summary) })
        .where(and(eq(binancePerpRun.id, 'scan'), eq(binancePerpRun.owner, owner)));
    } finally {
      /** 同根重跑也會先補送既有待發事件，讓 Slack 暫時失敗不造成永久漏報。 */
      await deliverPerpAlerts(db, env);
      await db.update(binancePerpRun).set({ expiresAt: 0 })
        .where(and(eq(binancePerpRun.id, 'scan'), eq(binancePerpRun.owner, owner)));
    }
  } catch {
    console.error('[Perp Mark Radar] 排程未完成，請檢查 0015 migration 與 Gate 連線');
  }
}
