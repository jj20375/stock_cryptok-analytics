import { cryptoSignalSlackChannel, type CryptoSignalNotificationEnv } from '../cryptoSignalNotifications';
/** @file 波段掃描及使用者授權的 Slack 通知；額外分析與原快照共用行情。 */
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import { waveLease, waveNotifications, waveRadar } from '../../db/waveSchema';
import { WAVE_SYMBOLS } from '../cryptoUniverse';
import { fetchBinanceRange } from '../marketData/binanceHistory';
import { WAVE_INTERVAL_MS } from '../strategy/strategies/cryptoWave';
import { nextWaveSnapshot, validateWaveCandles, waveMessage, type WaveSnapshot } from './state';
import { selectWaveNotice } from './notifications';
import { WAVE_ANALYSIS_VERSION } from './analysis';
import { slackPostFromStored } from '../slack/cryptoSignalCard';

/** 排程總開關與 Slack 設定僅由 Worker 環境提供；不讀取或操作交易金鑰。 */
export interface WaveEnv extends CryptoSignalNotificationEnv {
  DB: Parameters<typeof drizzle>[0];
  WAVE_RADAR_ENABLED?: string;
  SLACK_API_TOKEN?: string;
  /** 虛擬幣訊號專用頻道；一般報表頻道不作 fallback，避免再次混流。 */
  CRYPTO_ENTRY_SLACK_CHANNEL_ID?: string;
  SLACK_CHANNEL_ID?: string;
}
const LEASE_MS = 2 * 60 * 1000;
// Cloudflare 排程需在短時間內完成；六檔並行且即時行情每來源三秒逾時，
// 單一交易所卡住時仍能發布其他幣種並正常釋放租約。
const SCAN_BUDGET_MS = 20_000;

/**
 * 【Cloudflare Workers subrequest 預算】單次 Worker 執行的子請求有上限
 * (免費方案 50，超過會出現 "Too many subrequests")；行情 fetch、Slack 發送與
 * D1 binding 呼叫都會計入。實測 45 幣一次掃完會在第 20 檔左右耗盡額度。
 *
 * 因此本輪掃描的幣數上限訂為 12：
 *   最差情況 = 12 幣 × 3 個備援來源(36) + 租約/寫入等 D1 操作 ≈ 仍需留餘裕，
 *   故同時把每檔的 D1 操作降到最少(見下方最佳化)，並把 Slack 單輪發送量降為 10。
 * 45 檔約 4 輪(60 分鐘)可輪完一遍；4h K 線每 4 小時才換一根，覆蓋頻率綽綽有餘。
 */
const MAX_SYMBOLS_PER_SCAN = 12;
const SCAN_CONCURRENCY = 6;
const MAX_NOTIFICATIONS_PER_RUN = 3;
export const waveCryptoSlackChannel = (env: WaveEnv) => cryptoSignalSlackChannel(env);

/**
 * 逐幣掃描，外部行情逾時後逐幣隔離，避免單幣故障拖垮全表。
 * 掃描順序依「上次檢查時間由舊到新」輪替，確保額度或時間用盡時未處理的幣下輪優先。
 */
async function scanSymbols(db: ReturnType<typeof drizzle>, owner: string, notifications: boolean) {
  const startedAt = Date.now();
  // 一次撈完所有幣的快照(含 snapshot_json)，迴圈內不再逐檔查詢，節省 subrequest 額度
  const existingRows = await db.select().from(waveRadar);
  const rowBySymbol = new Map(existingRows.map(r => [r.symbol, r]));
  const ordered = [...WAVE_SYMBOLS].sort(
    (a, b) => (rowBySymbol.get(a.symbol)?.checkedAt ?? 0) - (rowBySymbol.get(b.symbol)?.checkedAt ?? 0)
  );

  const scanNow = Date.now();
  const lastClosedOpen = Math.floor(scanNow / WAVE_INTERVAL_MS) * WAVE_INTERVAL_MS - WAVE_INTERVAL_MS;
  const targets = ordered.filter(({ symbol }) => {
    const row = rowBySymbol.get(symbol);
    const previous: WaveSnapshot | null = row ? JSON.parse(row.snapshotJson) : null;
    return !(previous && !previous.error && previous.signal.barTime === lastClosedOpen &&
      previous.analysis?.version === WAVE_ANALYSIS_VERSION);
  }).slice(0, MAX_SYMBOLS_PER_SCAN);

  const scanSymbol = async ({ symbol }: { symbol: string }) => {
    const now = Date.now();
    const row = rowBySymbol.get(symbol);
    const previous: WaveSnapshot | null = row ? JSON.parse(row.snapshotJson) : null;
    try {
      // 即時排程將每個來源限制三秒；主來源異常時仍會依序嘗試備援，但不容許單幣占滿整次 Worker。
      const result = await fetchBinanceRange(symbol, '4h', lastClosedOpen - 359 * WAVE_INTERVAL_MS, now, 1, {
        minLatestOpenTime: lastClosedOpen,
        requireContiguous: true,
        requestTimeoutMs: 3000,
      });
      validateWaveCandles(result.candles, now);
      const next = nextWaveSnapshot(result.candles, previous, result.source);
      /** 品質分析可在階段未變時首次成立；冷卻狀態和待發事件一併保存。 */
      const notice = notifications ? selectWaveNotice(next, previous) : null;
      const updated = { symbol, snapshotJson: JSON.stringify(next), checkedAt: now };
      const save = db.insert(waveRadar).values(updated).onConflictDoUpdate({ target: waveRadar.symbol, set: updated });
      // 只有階段改變才產生通知；初次掃描亦可通知當前候選，但 WAIT 不洗版。
      if (notice) {
        await db.batch([save, db.insert(waveNotifications).values({
          id: `${symbol}:${next.signal.barTime}:${notice.key}`,
          message: waveMessage(symbol, next), createdAt: now,
        }).onConflictDoNothing()]);
      } else await save;
    } catch (error) {
      const failed: WaveSnapshot = previous ?? {
        signal: { phase: 'WAIT', price: 0, barTime: 0, breakout: null, volumeRatio: null, stopLossPct: null, dailyTrend: false, reason: '尚無有效行情' },
        tracking: null, error: null,
      };
      // 保留上次有效訊號與追蹤狀態；故障不等同趨勢失效，UI 會遮蔽舊狀態並標示錯誤。
      failed.error = error instanceof Error ? error.message : '行情讀取失敗';
      const updated = { symbol, snapshotJson: JSON.stringify(failed), checkedAt: now };
      await db.insert(waveRadar).values(updated).onConflictDoUpdate({ target: waveRadar.symbol, set: updated });
    }
  };

  for (let start = 0; start < targets.length; start += SCAN_CONCURRENCY) {
    const now = Date.now();
    if (now - startedAt >= SCAN_BUDGET_MS) return;
    const [lease] = await db.select().from(waveLease).where(eq(waveLease.id, 'scan'));
    if (lease?.owner !== owner || lease.expiresAt <= now) return;
    await db.update(waveLease).set({ expiresAt: now + LEASE_MS })
      .where(and(eq(waveLease.id, 'scan'), eq(waveLease.owner, owner)));
    await Promise.all(targets.slice(start, start + SCAN_CONCURRENCY).map(scanSymbol));
  }
}

/** 發送成功後才標記；Slack 已接收但回應遺失時可能重送，無法保證跨系統恰好一次。 */
async function deliverNotifications(db: ReturnType<typeof drizzle>, env: WaveEnv) {
  const channel = waveCryptoSlackChannel(env);
  if (!env.SLACK_API_TOKEN || !channel) return;
  const [newest] = await db.select({ createdAt: waveNotifications.createdAt }).from(waveNotifications)
    .where(isNull(waveNotifications.sentAt)).orderBy(desc(waveNotifications.createdAt)).limit(1);
  if (!newest) return;
  // 4 小時訊號只在本根週期內重試；跨過下一根收盤後直接捨棄，不發歷史進場價。
  if (Date.now() - newest.createdAt >= WAVE_INTERVAL_MS) {
    await db.delete(waveNotifications).where(isNull(waveNotifications.sentAt));
    return;
  }
  const latestBatchStart = Math.floor(newest.createdAt / WAVE_INTERVAL_MS) * WAVE_INTERVAL_MS;
  await db.delete(waveNotifications).where(and(
    isNull(waveNotifications.sentAt), lt(waveNotifications.createdAt, latestBatchStart),
  ));
  // 單輪最多三則且由最新偵測時間開始；限制 Slack 最差逾時，避免行情完成後仍被平台中止。
  const pending = await db.select().from(waveNotifications).where(and(
    isNull(waveNotifications.sentAt), gte(waveNotifications.createdAt, latestBatchStart),
  )).orderBy(desc(waveNotifications.createdAt)).limit(MAX_NOTIFICATIONS_PER_RUN);
  for (const event of pending) {
    try {
      const post = slackPostFromStored(event.message);
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST', signal: AbortSignal.timeout(3000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SLACK_API_TOKEN}` },
        // 歷史列已先捨棄，Slack 只會收到目前 4 小時週期仍有效的觀察。
        body: JSON.stringify({ channel, ...post, mrkdwn: true }),
      });
      const data = await response.json() as { ok?: boolean };
      // 遇到限流或失敗即結束本輪，保留待發事件，避免連續重試轟炸 Slack。
      if (!response.ok || !data.ok) break;
      await db.update(waveNotifications).set({ sentAt: Date.now() }).where(eq(waveNotifications.id, event.id));
    } catch { break; }
  }
  // 已送紀錄保留三十天；未送列最多只重試到目前 4 小時週期結束。
  await db.delete(waveNotifications).where(lt(waveNotifications.sentAt, Date.now() - 30 * 86400000));
}

export async function runWaveRadar(env: WaveEnv, options: { notifications?: boolean } = {}) {
  if (env.WAVE_RADAR_ENABLED !== 'true') return;
  const db = drizzle(env.DB);
  const owner = crypto.randomUUID();
  try {
    const now = Date.now();
    const acquired = await db.insert(waveLease).values({ id: 'scan', owner, expiresAt: now + LEASE_MS })
      .onConflictDoUpdate({ target: waveLease.id, set: { owner, expiresAt: now + LEASE_MS }, setWhere: lt(waveLease.expiresAt, now) })
      .returning();
    if (!acquired.length) return;
    try {
      /** 新頻道尚未設定時只保存行情，不先累積一批可能日後洗版的舊通知。 */
      const notificationsReady = options.notifications !== false && Boolean(env.SLACK_API_TOKEN && waveCryptoSlackChannel(env));
      await scanSymbols(db, owner, notificationsReady);
      const [lease] = await db.select().from(waveLease).where(eq(waveLease.id, 'scan'));
      /** 掃描結束仍持有有效租約即可送最新事件；短租約用來在異常中止後快速自癒。 */
      if (notificationsReady && lease?.owner === owner && lease.expiresAt > Date.now()) await deliverNotifications(db, env);
    } finally {
      await db.delete(waveLease).where(and(eq(waveLease.id, 'scan'), eq(waveLease.owner, owner)));
    }
  } catch {
    // 不暴露金鑰或原始外部回應；缺 migration 等設定錯誤會在監控頁明確呈現。
    console.error('[Wave Radar] 掃描未完成，請檢查資料庫 migration 與排程設定');
  }
}
