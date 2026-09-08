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
// 單輪掃描的時間預算：留在 cron 間隔(15 分)與租約(12 分)之內。
// 幣種數量擴充後，最差情況(主來源逾時 + 備援逾時)可能拖很久，因此以預算主動收尾，
// 未掃到的幣會在下一輪優先處理(依 checked_at 由舊到新輪替)，確保長期覆蓋所有幣種。
const SCAN_BUDGET_MS = 8 * 60 * 1000;

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
// 每 N 檔才續租一次，避免逐檔續租佔用 subrequest 額度
const LEASE_RENEW_EVERY = 4;

/**
 * 逐幣掃描，外部行情逾時後逐幣隔離，避免單幣故障拖垮全表。
 * 掃描順序依「上次檢查時間由舊到新」輪替，確保額度或時間用盡時未處理的幣下輪優先。
 */
async function scanSymbols(db: ReturnType<typeof drizzle>, owner: string) {
  const startedAt = Date.now();
  // 一次撈完所有幣的快照(含 snapshot_json)，迴圈內不再逐檔查詢，節省 subrequest 額度
  const existingRows = await db.select().from(waveRadar);
  const rowBySymbol = new Map(existingRows.map(r => [r.symbol, r]));
  const ordered = [...WAVE_SYMBOLS].sort(
    (a, b) => (rowBySymbol.get(a.symbol)?.checkedAt ?? 0) - (rowBySymbol.get(b.symbol)?.checkedAt ?? 0)
  );

  let processed = 0;
  for (const { symbol } of ordered) {
    const now = Date.now();
    // 時間或幣數預算用盡就收尾，把剩餘幣種留給下一輪(輪替排序確保它們下輪優先)
    if (now - startedAt >= SCAN_BUDGET_MS || processed >= MAX_SYMBOLS_PER_SCAN) return;
    // 續租改為每 LEASE_RENEW_EVERY 檔一次，兼顧所有權維持與 subrequest 額度
    if (processed % LEASE_RENEW_EVERY === 0) {
      const [lease] = await db.select().from(waveLease).where(eq(waveLease.id, 'scan'));
      if (lease?.owner !== owner || lease.expiresAt <= now) return;
      await db.update(waveLease).set({ expiresAt: now + LEASE_MS })
        .where(and(eq(waveLease.id, 'scan'), eq(waveLease.owner, owner)));
    }
    const row = rowBySymbol.get(symbol);
    const previous: WaveSnapshot | null = row ? JSON.parse(row.snapshotJson) : null;
    const lastClosedOpen = Math.floor(now / WAVE_INTERVAL_MS) * WAVE_INTERVAL_MS - WAVE_INTERVAL_MS;
    // 已成功處理的同一根 K 線不重抓、不重算；錯誤會在下輪重試。
    // 此分支不發出任何外部請求，因此不計入本輪的幣數預算。
    if (previous && !previous.error && previous.signal.barTime === lastClosedOpen) continue;
    processed++;
    try {
      // minLatestOpenTime:要求資料必須含最新一根已收盤 K 線,否則自動改用下一個資料來源,
      // 避免單一交易所該幣流動性低或延遲時整檔停擺(ZEC 曾因此持續失敗)。
      const result = await fetchBinanceRange(symbol, '4h', lastClosedOpen - 359 * WAVE_INTERVAL_MS, now, 1, {
        minLatestOpenTime: lastClosedOpen,
      });
      validateWaveCandles(result.candles, now);
      const next = nextWaveSnapshot(result.candles, previous, result.source);
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
  // 單輪發送量壓在 10 則：Slack 發送同樣計入 Worker 的 subrequest 額度，
  // 必須與行情抓取共用預算；未送完的通知會保留在佇列，下一輪繼續補送。
  const pending = await db.select().from(waveNotifications).where(isNull(waveNotifications.sentAt))
    .orderBy(asc(waveNotifications.createdAt)).limit(10);
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
