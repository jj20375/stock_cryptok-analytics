/** @file 獨立 15 分排程：有限批次抓取、租約防重疊、原子保存入選與可重試的 Slack 通知；絕不下單。 */
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { potentialBigFish, potentialObservations, potentialRadar, potentialRadarNotifications, potentialRun } from '../../db/potentialSchema';
import { analyzePotential, updateObservation } from './analysis';
import type { BigFishSignal } from './bigFish';
import { fetchGateDerivativeSignal } from './derivatives';
import { fetchRadarCandles, fetchRadarDepth, fetchUniverse, selectCandidates } from './market';
import { formatPotentialCard, selectPotentialNotice } from './notifications';
import { slackPostFromStored } from '../slack/cryptoSignalCard';
import { DAY_MS, FOUR_HOUR_MS, QUARTER_MS, RADAR_RULES, isRadarCandidate, type RadarObservation,
  type RadarRun, type RadarSnapshot } from './types';

/** Slack 權杖及頻道僅由 Worker secret 提供；掃描程式不讀取本機設定檔或交易憑證。 */
export interface PotentialEnv {
  DB: Parameters<typeof drizzle>[0];
  POTENTIAL_RADAR_ENABLED?: string;
  SLACK_API_TOKEN?: string;
  /** 虛擬幣進場訊號專用頻道，不與一般日報或美股頻道共用。 */
  CRYPTO_ENTRY_SLACK_CHANNEL_ID?: string;
  SLACK_CHANNEL_ID?: string;
}
type RadarDb = ReturnType<typeof drizzle>;

/** 12 檔新候選加 1 檔歷史補算；騰出的請求額度供前三名候選各抓兩組 Gate 永續統計。 */
const SCAN_LIMIT = 13;
/** 五檔並行並在二十秒內收尾，避免 Worker 被平台中止後留下長租約與舊榜單。 */
const BUDGET_MS = 20_000;
const LEASE_MS = 2 * 60 * 1000;
const SCAN_CONCURRENCY = 5;
/** Slack 也計入 Worker 子請求額度，單輪至多補送三則，其餘保留到下一輪。 */
const MAX_NOTIFICATIONS_PER_RUN = 3;
/** 每檔需兩個 Gate 公開請求；只精算前三個候選，連同 D1 與 Slack 保持在單輪資源預算內。 */
const MAX_DERIVATIVE_CANDIDATES = 3;
export const potentialCryptoSlackChannel = (env: PotentialEnv) => env.CRYPTO_ENTRY_SLACK_CHANNEL_ID?.trim() || null;

function parseSnapshot(value: string): RadarSnapshot | null {
  try { return JSON.parse(value) as RadarSnapshot; }
  catch { return null; }
}

async function collectScan(db: RadarDb, startedAt: number, notificationsEnabled: boolean) {
  const cutoff = Math.floor(startedAt / QUARTER_MS) * QUARTER_MS;
  /** 吃大魚判斷最新一根已收盤 4 小時 K；結果由獨立排程寫入，同一根在下一次 4 小時收盤前不變。 */
  const expectedFourHourBar = Math.floor(startedAt / FOUR_HOUR_MS) * FOUR_HOUR_MS - FOUR_HOUR_MS;
  const [observationRows, previousRows, bigFishRows] = await Promise.all([
    db.select().from(potentialObservations).where(gte(potentialObservations.enteredAt, cutoff - 8 * DAY_MS)),
    /** 未配置 Slack 時不讀取通知相關資料，讓舊 migration 的本機掃描仍可安全運作。 */
    notificationsEnabled ? db.select().from(potentialRadar) : Promise.resolve([]),
    /** 只多一次讀取查詢；0022 尚未套用時回傳空結果，雷達照常運作、吃大魚顯示未計算。 */
    db.select().from(potentialBigFish).where(eq(potentialBigFish.barTime, expectedFourHourBar)).catch(() => []),
  ]);
  const observations = observationRows.map(row => JSON.parse(row.observationJson) as RadarObservation);
  const previousBySymbol = new Map(previousRows.map(row => [row.symbol, parseSnapshot(row.snapshotJson)]));
  /** 主來源整輪不可用時才整輪切換；BTC 基準、標的及深度一律鎖定同所。 */
  let source: 'BYBIT_SPOT' | 'GATE_SPOT' = 'BYBIT_SPOT';
  let universe;
  let btc;
  try {
    [universe, btc] = await Promise.all([fetchUniverse(source), fetchRadarCandles('BTCUSDT', cutoff, source)]);
  } catch {
    source = 'GATE_SPOT';
    [universe, btc] = await Promise.all([fetchUniverse(source), fetchRadarCandles('BTCUSDT', cutoff, source)]);
  }
  const selected = selectCandidates(universe, cutoff).map(coin => coin.symbol);
  /** 額外一個名額輪替補追蹤；退榜／流動性消失也保留研究紀錄，完成速度取決於待追蹤數。 */
  const pending = [...observationRows].sort((a, b) => a.checkedAt - b.checkedAt);
  for (const row of pending) {
    if (selected.length >= SCAN_LIMIT) break;
    const observation = observations.find(o => o.id === row.id)!;
    if (!observation.complete && (observation.signal.source ?? 'BYBIT_SPOT') === source && !selected.includes(row.symbol)) selected.push(row.symbol);
  }
  const snapshots: RadarSnapshot[] = [];
  const updates = new Map<string, RadarObservation>();
  const notifications: { id: string; message: string; createdAt: number }[] = [];
  const summary: RadarRun = { version: RADAR_RULES.version, source, startedAt, completedAt: 0, eligible: universe.length, selected: selected.length, scanned: 0, failed: 0, error: null };
  /**
   * 只採用「同來源、同一根 4 小時 K」且計算成功的結果；尚未算到或計算失敗為 undefined（顯示未計算），
   * 絕不沿用上一根 4 小時的 entry，以免舊訊號冒充新進場。
   */
  const fourHourBigFish = new Map<string, BigFishSignal>();
  for (const row of bigFishRows) {
    if (row.source !== source || !row.signalJson) continue;
    try { fourHourBigFish.set(row.symbol, { ...JSON.parse(row.signalJson) as BigFishSignal, timeframe: '4h' }); }
    catch { /** 單筆損壞只讓該標的顯示未計算。 */ }
  }
  const scanSymbol = async (symbol: string) => {
    try {
      const candles = symbol === 'BTCUSDT' ? btc : await fetchRadarCandles(symbol, cutoff, source);
      /** 切換來源後不補算別所歷史報酬；保留原研究紀錄，待原來源恢復。 */
      for (const observation of observations.filter(o => o.symbol === symbol && !o.complete && (o.signal.source ?? 'BYBIT_SPOT') === source)) {
        updates.set(observation.id, updateObservation(observation, candles));
      }
      /** 追蹤中的退榜標的可以補算績效，但不能繞過動態市場資格重新入榜。 */
      if (!universe.some(coin => coin.symbol === symbol)) {
        snapshots.push({ symbol, checkedAt: Date.now(), signal: null, error: '目前不在流動性合格的可交易現貨池；保留歷史追蹤' });
        summary.scanned++;
        return;
      }
      const depth = await fetchRadarDepth(symbol, source);
      const signal = analyzePotential(candles, btc, depth, fourHourBigFish.get(symbol));
      signal.source = source;
      /** null 明確表示新版已掃描，但本輪尚未使用有限的永續精算名額；舊快照則維持 undefined。 */
      signal.derivatives = null;
      const checkedAt = Date.now();
      snapshots.push({ symbol, checkedAt, signal, error: null } satisfies RadarSnapshot);
      summary.scanned++;
    } catch (error) {
      /** 僅記錄受控錯誤，不儲存外部回應或憑證；單幣故障不影響其餘候選。 */
      const reason = error instanceof Error ? error.message : '行情無法取得';
      snapshots.push({ symbol, checkedAt: Date.now(), signal: null, error: reason });
      /** 失敗也更新「嘗試時間」供輪替，避免四個下架幣永久占住所有歷史補算名額；研究數值保持原樣。 */
      for (const observation of observations.filter(o => o.symbol === symbol && !o.complete)) {
        if (!updates.has(observation.id)) updates.set(observation.id, observation);
      }
      summary.failed++;
    }
  };
  for (let start = 0; start < selected.length; start += SCAN_CONCURRENCY) {
    if (Date.now() - startedAt >= BUDGET_MS) {
      summary.error = '本輪時間預算用盡，未掃描標的保留舊時間並等待下輪';
      break;
    }
    await Promise.all(selected.slice(start, start + SCAN_CONCURRENCY).map(scanSymbol));
  }
  /** 優先順序先看中週期確認，再看吃大魚單根事件及量價分數；不把請求浪費在等待或過熱標的。 */
  const derivativeCandidates = snapshots.filter(snapshot => snapshot.signal && isRadarCandidate(snapshot.signal))
    .sort((left, right) => Number(right.signal!.trendConfirmation?.confirmed) - Number(left.signal!.trendConfirmation?.confirmed) ||
      Number(right.signal!.bigFish?.entry) - Number(left.signal!.bigFish?.entry) || right.signal!.score - left.signal!.score)
    .slice(0, MAX_DERIVATIVE_CANDIDATES);
  await Promise.all(derivativeCandidates.map(async snapshot => {
    snapshot.signal!.derivatives = await fetchGateDerivativeSignal(snapshot.symbol, snapshot.signal!.change1h, Date.now());
  }));
  /** 通知與研究樣本在衍生品補算後建立，確保 D1、畫面及 Slack 保存同一份分類。 */
  for (const snapshot of snapshots) {
    const signal = snapshot.signal;
    if (!signal) continue;
    const notice = notificationsEnabled ? selectPotentialNotice(snapshot, previousBySymbol.get(snapshot.symbol) ?? null) : null;
    if (notice) {
      /** 事件 ID 綁定已收盤 K 線及規則版本；重試或同根重算不可對同一訊號重複入列。 */
      notifications.push({ id: `${snapshot.symbol}:${signal.barTime}:${RADAR_RULES.version}:${notice.key}`,
        message: formatPotentialCard(snapshot), createdAt: snapshot.checkedAt });
    }
    /** 同幣至少間隔 24 小時建立一筆研究樣本；每輪訊號變化仍保存在最新快照。 */
    if (isRadarCandidate(signal) && !observations.some(o => o.symbol === snapshot.symbol && cutoff - o.enteredAt < DAY_MS)) {
      const id = `${snapshot.symbol}:${cutoff}:${RADAR_RULES.version}`;
      updates.set(id, { id, symbol: snapshot.symbol, enteredAt: cutoff, detectedAt: snapshot.checkedAt,
        entryPrice: signal.price, signal, checkedThrough: cutoff, returns: { h24: null, h72: null, d7: null },
        maxRise: 0, maxFall: 0, complete: false, error: null });
    }
  }
  return { snapshots, observations: [...updates.values()], notifications, summary };
}

/** 取得發布權後在單一 D1 batch 寫入；失敗會整批回滾，不能出現有榜單卻漏掉入選紀錄。 */
async function publishScan(db: RadarDb, owner: string, scan: Awaited<ReturnType<typeof collectScan>>) {
  const now = Date.now();
  const owned = await db.update(potentialRun).set({ expiresAt: now + LEASE_MS })
    .where(and(eq(potentialRun.id, 'scan'), eq(potentialRun.owner, owner), gte(potentialRun.expiresAt, now + 60_000)))
    .returning();
  if (!owned.length) return;
  const summaryWrite = db.update(potentialRun).set({ summaryJson: JSON.stringify({ ...scan.summary, completedAt: now }) })
    .where(and(eq(potentialRun.id, 'scan'), eq(potentialRun.owner, owner)));
  /** 每個 SQL 最多 100 個綁定參數：快照 13×3=39；研究紀錄每批 18×5=90；通知 13×3=39。 */
  const snapshotRows = scan.snapshots.map(snapshot => ({ symbol: snapshot.symbol, checkedAt: snapshot.checkedAt, snapshotJson: JSON.stringify(snapshot) }));
  const snapshotWrites = snapshotRows.length ? [db.insert(potentialRadar).values(snapshotRows).onConflictDoUpdate({
    target: potentialRadar.symbol, set: { checkedAt: sql`excluded.checked_at`, snapshotJson: sql`excluded.snapshot_json` },
  })] : [];
  const observationWrites = [];
  for (let i = 0; i < scan.observations.length; i += 18) {
    const rows = scan.observations.slice(i, i + 18).map(observation => ({ id: observation.id, symbol: observation.symbol,
      enteredAt: observation.enteredAt, checkedAt: now, observationJson: JSON.stringify(observation) }));
    observationWrites.push(db.insert(potentialObservations).values(rows).onConflictDoUpdate({
      target: potentialObservations.id, set: { checkedAt: sql`excluded.checked_at`, observationJson: sql`excluded.observation_json` },
    }));
  }
  /** 快照與待發訊息同批寫入；先更新候選再當機不能造成永久漏報。 */
  const notificationWrites = scan.notifications.length ? [db.insert(potentialRadarNotifications).values(scan.notifications)
    .onConflictDoNothing()] : [];
  await db.batch([summaryWrite, ...snapshotWrites, ...observationWrites, ...notificationWrites]);
}

/** 發送成功才更新 sent_at；Slack 收到但回應中斷時仍可能補送，跨系統無法保證恰好一次。 */
async function deliverPotentialNotifications(db: RadarDb, env: PotentialEnv) {
  const channel = potentialCryptoSlackChannel(env);
  if (!env.SLACK_API_TOKEN || !channel) return;
  try {
    const [newest] = await db.select({ createdAt: potentialRadarNotifications.createdAt })
      .from(potentialRadarNotifications).where(isNull(potentialRadarNotifications.sentAt))
      .orderBy(desc(potentialRadarNotifications.createdAt)).limit(1);
    if (!newest) return;
    /** 15 分訊號跨過下一根收盤即過期；沒有新訊號時也不能繼續補送舊進場價。 */
    if (Date.now() - newest.createdAt >= QUARTER_MS) {
      await db.delete(potentialRadarNotifications).where(isNull(potentialRadarNotifications.sentAt));
      return;
    }
    const latestBatchStart = Math.floor(newest.createdAt / QUARTER_MS) * QUARTER_MS;
    await db.delete(potentialRadarNotifications).where(and(
      isNull(potentialRadarNotifications.sentAt), lt(potentialRadarNotifications.createdAt, latestBatchStart),
    ));
    const pending = await db.select().from(potentialRadarNotifications).where(and(
      isNull(potentialRadarNotifications.sentAt), gte(potentialRadarNotifications.createdAt, latestBatchStart),
    )).orderBy(desc(potentialRadarNotifications.createdAt)).limit(MAX_NOTIFICATIONS_PER_RUN);
    for (const event of pending) {
      try {
        const post = slackPostFromStored(event.message);
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST', signal: AbortSignal.timeout(4_000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SLACK_API_TOKEN}` },
          /** 只會送最新且仍有效的批次；歷史列已在查詢前捨棄。 */
          body: JSON.stringify({ channel, ...post, mrkdwn: true }),
        });
        const data = await response.json() as { ok?: boolean };
        /** 限流或失敗保留事件並停止本輪，避免快速重試洗版 Slack。 */
        if (!response.ok || !data.ok) break;
        await db.update(potentialRadarNotifications).set({ sentAt: Date.now() })
          .where(eq(potentialRadarNotifications.id, event.id));
      } catch { break; }
    }
    /** 已送紀錄保留三十天；未送列只在本根 15 分 K 的有效期內重試。 */
    await db.delete(potentialRadarNotifications).where(lt(potentialRadarNotifications.sentAt, Date.now() - 30 * DAY_MS));
  } catch {
    /** 通知資料表未完成 migration 或短暫故障不能讓行情掃描失敗，也不輸出憑證或外部回應。 */
    console.error('[Potential Radar] Slack 通知暫時無法處理，將於下輪重試');
  }
}

export async function runPotentialRadar(env: PotentialEnv) {
  if (env.POTENTIAL_RADAR_ENABLED !== 'true') return;
  const db = drizzle(env.DB);
  const owner = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const acquired = await db.insert(potentialRun).values({ id: 'scan', owner, expiresAt: startedAt + LEASE_MS })
      .onConflictDoUpdate({ target: potentialRun.id, set: { owner, expiresAt: startedAt + LEASE_MS },
        setWhere: lt(potentialRun.expiresAt, startedAt) }).returning();
    if (!acquired.length) return;
    try {
      const previous = acquired[0].summaryJson ? JSON.parse(acquired[0].summaryJson) as RadarRun : null;
      /** 只有同版本、同一根成功掃描才略過；新版不能因舊版已完成而漏算新增訊號。 */
      const completedSameBar = previous?.version === RADAR_RULES.version && !previous.error && previous.failed === 0 &&
        Math.floor(previous.startedAt / QUARTER_MS) === Math.floor(startedAt / QUARTER_MS);
      if (!completedSameBar) {
        await publishScan(db, owner, await collectScan(db, startedAt, Boolean(env.SLACK_API_TOKEN && potentialCryptoSlackChannel(env))));
      }
    } catch {
      const summary: RadarRun = { version: RADAR_RULES.version, startedAt, completedAt: Date.now(), eligible: 0, selected: 0, scanned: 0, failed: 0,
        error: '本輪未完成：行情來源或資料庫暫時無法使用；舊榜單不代表最新機會' };
      await db.update(potentialRun).set({ summaryJson: JSON.stringify(summary) })
        .where(and(eq(potentialRun.id, 'scan'), eq(potentialRun.owner, owner)));
    } finally {
      /** 即使同根掃描已完成也要補送既有佇列，讓暫時失敗的 Slack 事件能在下一輪恢復。 */
      await deliverPotentialNotifications(db, env);
      await db.update(potentialRun).set({ expiresAt: 0 }).where(and(eq(potentialRun.id, 'scan'), eq(potentialRun.owner, owner)));
    }
  } catch {
    console.error('[Potential Radar] 排程未完成，請檢查資料庫更新與連線');
  }
}
