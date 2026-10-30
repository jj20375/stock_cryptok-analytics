import { cryptoSignalSlackChannel, type CryptoSignalNotificationEnv } from '../cryptoSignalNotifications';
/**
 * @file 4 小時收盤後分片掃描永續 Mark Price；通知與可選 Bitget 合約交易共用同一根已收盤訊號。
 * 【交易副作用】最新根的進場／出場訊號會交給 processCryptoFuturesSignal，依使用者設定在 Demo 或 LIVE 下單；
 * 週期由 15 分改為 4 小時後，自動交易的進出場節奏同步改變（進場較少、出場以 4 小時 Supertrend 翻紅為準）。
 */
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { binancePerpAlerts, binancePerpRun } from '../../db/binancePerpSchema';
import { analyzeBigFish } from '../potentialRadar/bigFish';
import { fetchGatePerpUniverse, fetchMarkPriceCandles, fetchPerpUniverse, PerpHistoryTooShortError, selectPerpShard } from './market';
import { formatPerpSignalCard } from './notifications';
import { slackPostFromStored } from '../slack/cryptoSignalCard';
import { classifyPerpSignal } from './quality';
import { BINANCE_PERP_RULES, PERP_DAY_MS, PERP_BAR_MS, type PerpAlert, type PerpRunSummary } from './types';
import { processCryptoFuturesSignal } from '../cryptoAutoTrading/engine';
import type { CryptoAutoTradeSignal } from '../cryptoAutoTrading/types';

/** Slack 權杖與頻道只由 Worker secret 注入；公開 Binance／Gate 行情都不需要 API key。 */
export interface BinancePerpEnv extends CryptoSignalNotificationEnv {
  DB: Parameters<typeof drizzle>[0];
  BINANCE_PERP_RADAR_ENABLED?: string;
  SLACK_API_TOKEN?: string;
  /** 虛擬幣即時進場價專用頻道；刻意不讀取一般報表頻道。 */
  CRYPTO_ENTRY_SLACK_CHANNEL_ID?: string;
  SLACK_CHANNEL_ID?: string;
  /** 只用來解密獨立 Bitget Demo 金鑰；缺少時仍正常掃描與通知。 */
  MASTER_ENCRYPTION_KEY?: string;
}
type PerpDb = ReturnType<typeof drizzle>;

/** Cloudflare 排程必須在短時間內收尾；六檔並行可讓單一慢合約不再拖垮其餘 31 檔。 */
const BUDGET_MS = 20_000;
const LEASE_MS = 2 * 60 * 1000;
const SCAN_CONCURRENCY = 6;
/** 每五分鐘最多送一則；平均每十五分鐘三則，保留原吞吐量但避免同分鐘洗版。 */
const NOTIFICATIONS_PER_TICK = 1;
/** 純通知工作最多持有租約四十五秒；與分片掃描共用鎖，避免同一筆被並行送出兩次。 */
const NOTIFICATION_LEASE_MS = 45 * 1000;
export const cryptoEntrySlackChannel = (env: BinancePerpEnv) => cryptoSignalSlackChannel(env);

async function collectScan(startedAt: number, notificationsEnabled: boolean, shardIndex: number) {
  const cutoff = Math.floor(startedAt / PERP_BAR_MS) * PERP_BAR_MS;
  let market = await fetchPerpUniverse();
  let selected = selectPerpShard(market.tickers, cutoff, shardIndex);
  const prefetched = new Map<string, Awaited<ReturnType<typeof fetchMarkPriceCandles>>>();
  const knownTooShort = new Set<string>();
  /** Binance 清單可用但 K 線被 Cloudflare 地區限制時，整個分片切回 Gate，不能混用不同來源算指標。 */
  if (market.source === 'BINANCE' && selected.length) {
    try {
      prefetched.set(selected[0].symbol, await fetchMarkPriceCandles(selected[0].symbol, cutoff, market.source));
    } catch (error) {
      /**
       * 歷史不足代表 Binance 其實有回應，只是探測到的剛好是新合約；不可誤判成地區封鎖而整批切到 Gate。
       * 4 小時線需約 34 天歷史，新上市合約遠比 15 分線時常見，這個區分是必要的。
       */
      if (error instanceof PerpHistoryTooShortError) {
        knownTooShort.add(selected[0].symbol);
      } else {
        market = await fetchGatePerpUniverse();
        selected = selectPerpShard(market.tickers, cutoff, shardIndex);
        prefetched.clear();
      }
    }
  }
  const alerts: PerpAlert[] = [];
  const tradeSignals: CryptoAutoTradeSignal[] = [];
  const summary: PerpRunSummary = {
    version: BINANCE_PERP_RULES.version, source: market.source, shardIndex,
    shardCount: BINANCE_PERP_RULES.shardCount, startedAt, completedAt: 0, eligible: market.tickers.length,
    selected: selected.length, scanned: 0, failed: 0, skipped: 0, signals: 0, bestSignals: 0, error: null,
  };
  for (let start = 0; start < selected.length; start += SCAN_CONCURRENCY) {
    if (Date.now() - startedAt >= BUDGET_MS) {
      summary.error = '本輪時間預算用盡，未掃描標的等待下一輪';
      break;
    }
    const batch = selected.slice(start, start + SCAN_CONCURRENCY);
    const results = await Promise.all(batch.map(async ticker => {
      const found: PerpAlert[] = [];
      const autoFound: CryptoAutoTradeSignal[] = [];
      let signals = 0;
      let bestSignals = 0;
      if (knownTooShort.has(ticker.symbol)) return { found, autoFound, signals, bestSignals, failed: 0, skipped: 1 };
      try {
        const candles = prefetched.get(ticker.symbol) ?? await fetchMarkPriceCandles(ticker.symbol, cutoff, market.source);
        /** recoveryBars 為 1 時只判斷最新收盤根；保留迴圈結構以便日後調整補算根數。 */
        for (let offset = BINANCE_PERP_RULES.recoveryBars - 1; offset >= 0; offset--) {
          const series = offset ? candles.slice(0, -offset) : candles;
          const signal = analyzeBigFish(series);
          if (!signal) continue;
          const quality = classifyPerpSignal(series, signal);
          const markPrice = series.at(-1)!.close;
          /** 自動交易只看最新收盤根且須通過高勝率品質把關（排除空頭深水區反彈、過度延伸與長上影線）；一般訊號仍保留 Slack 觀察通知。 */
          if (offset === 0 && signal.flippedRed) {
            autoFound.push({
              id: `internal:${ticker.symbol}:${signal.barTime}:exit:${BINANCE_PERP_RULES.version}`,
              source: 'INTERNAL', symbol: ticker.symbol, action: 'SELL', signalAt: signal.barTime + PERP_BAR_MS,
              referencePrice: markPrice, label: '吃大魚 Supertrend 翻紅出場',
            });
          } else if (offset === 0 && signal.entry && quality.autoTradeEligible) {
            autoFound.push({
              id: `internal:${ticker.symbol}:${signal.barTime}:entry:${BINANCE_PERP_RULES.version}`,
              source: 'INTERNAL', symbol: ticker.symbol, action: 'BUY', signalAt: signal.barTime + PERP_BAR_MS,
              referencePrice: markPrice, label: `吃大魚 ${quality.grade === 'BEST' ? '最佳型' : 'Supertrend 翻綠型'}`,
            });
          }
          if (!signal.entry) continue;
          signals++;
          if (quality.grade === 'BEST') bestSignals++;
          if (!notificationsEnabled) continue;
          const detectedAt = Date.now();
          found.push({
            id: `${market.source}:${ticker.symbol}:${signal.barTime}:${BINANCE_PERP_RULES.version}`,
            symbol: ticker.symbol,
            barTime: signal.barTime,
            detectedAt,
            message: formatPerpSignalCard({ source: market.source, ticker, signal, quality, markPrice }),
          });
        }
        return { found, autoFound, signals, bestSignals, failed: 0, skipped: 0 };
      } catch (error) {
        /** 新合約歷史不足是永久狀態，記為略過；下架、逾時或資料異常才算失敗，讓分片於下一個 15 分槽位重試。 */
        if (error instanceof PerpHistoryTooShortError) return { found, autoFound, signals, bestSignals, failed: 0, skipped: 1 };
        return { found, autoFound, signals, bestSignals, failed: 1, skipped: 0 };
      }
    }));
    for (const result of results) {
      alerts.push(...result.found);
      tradeSignals.push(...result.autoFound);
      summary.signals += result.signals;
      summary.bestSignals += result.bestSignals;
      summary.failed += result.failed;
      summary.skipped = (summary.skipped ?? 0) + result.skipped;
      if (!result.failed && !result.skipped) summary.scanned++;
    }
  }
  return { alerts, tradeSignals, summary };
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
    /** 下一根 4 小時 K 收盤後，上一根的進場價即失去即時性；未送列不再補發。 */
    const expired = Date.now() >= newest.barTime + 2 * PERP_BAR_MS;
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

export async function runBinancePerpRadar(env: BinancePerpEnv, shardIndex = 0) {
  if (env.BINANCE_PERP_RADAR_ENABLED !== 'true') return;
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= BINANCE_PERP_RULES.shardCount) return;
  const db = drizzle(env.DB);
  const owner = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const acquired = await db.insert(binancePerpRun).values({ id: 'scan', owner, expiresAt: startedAt + LEASE_MS })
      .onConflictDoUpdate({ target: binancePerpRun.id, set: { owner, expiresAt: startedAt + LEASE_MS },
        setWhere: lt(binancePerpRun.expiresAt, startedAt) }).returning();
    if (!acquired.length) return;
    /** 只保留同版本、同一根 4 小時 K 線的完成紀錄；跨根或改版後自然歸零，四個分片重新各掃一次。 */
    const barKey = Math.floor(startedAt / PERP_BAR_MS);
    let carriedShards: Record<string, number> = {};
    try {
      const previous = acquired[0].summaryJson ? JSON.parse(acquired[0].summaryJson) as PerpRunSummary : null;
      if (previous?.version === BINANCE_PERP_RULES.version) {
        carriedShards = Object.fromEntries(Object.entries(previous.completedShards ?? {}).filter(([, key]) => key === barKey));
      }
      /** cron 每 15 分鐘仍會呼叫各分片；同一根 4 小時 K 已成功的分片直接略過，失敗的分片則趁這次重試。 */
      const completedSameBar = carriedShards[String(shardIndex)] === barKey;
      if (!completedSameBar) {
        const notificationsEnabled = Boolean(env.SLACK_API_TOKEN && cryptoEntrySlackChannel(env));
        const scan = await collectScan(startedAt, notificationsEnabled, shardIndex);
        if (!scan.summary.error && scan.summary.failed === 0) carriedShards = { ...carriedShards, [String(shardIndex)]: barKey };
        scan.summary.completedShards = carriedShards;
        await publishScan(db, owner, scan);
        /** 合約引擎內含模式、雙重 LIVE 開關與事件去重；無人啟用時只是一筆輕量查詢。 */
        for (const signal of scan.tradeSignals) await processCryptoFuturesSignal(env as any, signal);
      }
    } catch {
      const summary: PerpRunSummary = {
        version: BINANCE_PERP_RULES.version, source: null, shardIndex, shardCount: BINANCE_PERP_RULES.shardCount,
        startedAt, completedAt: Date.now(), eligible: 0, selected: 0, scanned: 0, failed: 0,
        signals: 0, bestSignals: 0, error: '本輪未完成：Binance／Gate 公開行情或資料庫暫時無法使用',
        /** 保留其他分片的完成紀錄，避免一次暫時故障讓整根 4 小時 K 線全部重掃。 */
        completedShards: carriedShards,
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
    console.error('[Perp Mark Radar] 排程未完成，請檢查 0015 migration 與公開行情連線');
  }
}
