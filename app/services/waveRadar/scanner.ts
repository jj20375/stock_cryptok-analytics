import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq, isNull, lt } from 'drizzle-orm';
import { waveLease, waveNotifications, waveRadar } from '../../db/waveSchema';
import { WAVE_SYMBOLS } from '../cryptoUniverse';
import { fetchBinanceRange } from '../marketData/binanceHistory';
import { WAVE_INTERVAL_MS } from '../strategy/strategies/cryptoWave';
import { nextWaveSnapshot, validateWaveCandles, waveMessage, type WaveSnapshot } from './state';

/** 排程總開關與 Slack 設定僅由 Worker 環境提供；不讀取或操作交易金鑰。 */
export interface WaveEnv {
  DB: Parameters<typeof drizzle>[0];
  WAVE_RADAR_ENABLED?: string;
  SLACK_API_TOKEN?: string;
  SLACK_CHANNEL_ID?: string;
}
const LEASE_MS = 12 * 60 * 1000;

/** 每次持有租約最多處理 16 幣，外部行情逾時後逐幣隔離，避免單幣故障拖垮全表。 */
async function scanSymbols(db: ReturnType<typeof drizzle>, owner: string) {
  for (const { symbol } of WAVE_SYMBOLS) {
    const now = Date.now();
    const [lease] = await db.select().from(waveLease).where(eq(waveLease.id, 'scan'));
    if (lease?.owner !== owner || lease.expiresAt <= now) return;
    // 逐幣續租，避免連續外部逾時使最後幾個幣寫入時已失去排程所有權。
    await db.update(waveLease).set({ expiresAt: now + LEASE_MS })
      .where(and(eq(waveLease.id, 'scan'), eq(waveLease.owner, owner)));
    const [row] = await db.select().from(waveRadar).where(eq(waveRadar.symbol, symbol));
    const previous: WaveSnapshot | null = row ? JSON.parse(row.snapshotJson) : null;
    const lastClosedOpen = Math.floor(now / WAVE_INTERVAL_MS) * WAVE_INTERVAL_MS - WAVE_INTERVAL_MS;
    // 已成功處理的同一根 K 線不重抓、不重算；錯誤會在下輪重試。
    if (previous && !previous.error && previous.signal.barTime === lastClosedOpen) continue;
    try {
      const result = await fetchBinanceRange(symbol, '4h', lastClosedOpen - 359 * WAVE_INTERVAL_MS, now, 1);
      validateWaveCandles(result.candles, now);
      const next = nextWaveSnapshot(result.candles, previous);
      const updated = { symbol, snapshotJson: JSON.stringify(next), checkedAt: now };
      const save = db.insert(waveRadar).values(updated).onConflictDoUpdate({ target: waveRadar.symbol, set: updated });
      // 只有階段改變才產生通知；初次掃描亦可通知當前候選，但 WAIT 不洗版。
      const notify = next.signal.phase !== 'WAIT' && next.signal.phase !== previous?.signal.phase;
      if (notify) {
        // 交易式批次使狀態和待發事件同時落地，避免先改狀態後當機造成永久漏報。
        await db.batch([save, db.insert(waveNotifications).values({
          id: `${symbol}:${next.signal.barTime}:${next.signal.phase}`,
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
  }
}

/** 發送成功後才標記；Slack 已接收但回應遺失時可能重送，無法保證跨系統恰好一次。 */
async function deliverNotifications(db: ReturnType<typeof drizzle>, env: WaveEnv) {
  if (!env.SLACK_API_TOKEN || !env.SLACK_CHANNEL_ID) return;
  const pending = await db.select().from(waveNotifications).where(isNull(waveNotifications.sentAt))
    .orderBy(asc(waveNotifications.createdAt)).limit(20);
  for (const event of pending) {
    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SLACK_API_TOKEN}` },
        // 停機補送若已跨過一根 4h，必須突出標示歷史事件，避免把舊突破當成當前買點。
        body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID,
          text: `${Date.now() - event.createdAt >= WAVE_INTERVAL_MS ? '*延遲補送：以下為歷史事件，不代表目前訊號*\n' : ''}${event.message}`,
          mrkdwn: true }),
      });
      const data = await response.json() as { ok?: boolean };
      // 遇到限流或失敗即結束本輪，保留待發事件，避免連續重試轟炸 Slack。
      if (!response.ok || !data.ok) break;
      await db.update(waveNotifications).set({ sentAt: Date.now() }).where(eq(waveNotifications.id, event.id));
    } catch { break; }
  }
  // 僅清除已成功送達且超過 30 天的訊息，失敗紀錄保留供下一輪補送。
  await db.delete(waveNotifications).where(lt(waveNotifications.sentAt, Date.now() - 30 * 86400000));
}

export async function runWaveRadar(env: WaveEnv) {
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
      await scanSymbols(db, owner);
      const [lease] = await db.select().from(waveLease).where(eq(waveLease.id, 'scan'));
      if (lease?.owner === owner && lease.expiresAt > Date.now() + 210000) await deliverNotifications(db, env);
    } finally {
      await db.delete(waveLease).where(and(eq(waveLease.id, 'scan'), eq(waveLease.owner, owner)));
    }
  } catch {
    // 不暴露金鑰或原始外部回應；缺 migration 等設定錯誤會在監控頁明確呈現。
    console.error('[Wave Radar] 掃描未完成，請檢查資料庫 migration 與排程設定');
  }
}
