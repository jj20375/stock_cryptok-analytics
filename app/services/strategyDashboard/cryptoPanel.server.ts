/**
 * @file 虛擬幣面板：優先讀 D1 潛力幣雷達最新一批；超過 30 分鐘未更新、版本不符或沒有資料時，
 * 以同一套雷達函式（Bybit 現貨初篩、15 分量價、4 小時吃大魚、掛單深度）即時補算。
 * 副作用：只呼叫 Bybit／Gate 公開行情與讀取 D1；不寫入雷達表、不建立通知、不推播 Slack、不下單。
 */
import { desc } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/d1';
import { potentialObservations, potentialRadar } from '../../db/potentialSchema';
import { analyzePotential } from '../potentialRadar/analysis';
import { analyzeBigFish } from '../potentialRadar/bigFish';
import { fetchRadarCandles, fetchRadarDepth, fetchRadarFourHourCandles, fetchUniverse,
  selectCandidates } from '../potentialRadar/market';
import { FOUR_HOUR_MS, QUARTER_MS, RADAR_RULES, type MarketTicker, type RadarObservation,
  type RadarSnapshot } from '../potentialRadar/types';
import { cryptoSnapshotToPick, cryptoWatchItem, explainEmpty, isCryptoPickable, rankPicks, rankWatchlist } from './picks';
import { DASHBOARD_RULES, type DashboardPanelData } from './types';
import { cryptoTrackRecords, type BacktestSummary } from './validation';

type Db = ReturnType<typeof drizzle>;
type Source = 'BYBIT_SPOT' | 'GATE_SPOT';

/** 與雷達排程相同：5 檔並行、20 秒內收尾（Bybit 每次請求逾時 3 秒）。 */
const RECALC_CONCURRENCY = 5;
const RECALC_BUDGET_MS = 20_000;
/** 同一根 15 分 K 的補算結果不變；在同一 isolate 內快取到下一根收盤為止。 */
const recalcCache = new Map<number, RadarSnapshot[]>();

const RULE_SUMMARY = '15 分量價（放量突破／回踩續強／提前關注）＋4 小時吃大魚 2.0＋趨勢共振（4h MA20 回踩轉強且日線 MA7 向上）；Bybit USDT 現貨（失敗才整輪改 Gate），24h 成交額 ≥ 500 萬 USDT、價差 ≤ 0.3%、1% 深度每側 ≥ 1 萬 USDT，距突破位 > 1.5 ATR 或 24h 漲 > 30% 視為過熱排除。';

const parse = <T>(value: string): T | null => { try { return JSON.parse(value) as T; } catch { return null; } };
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const formatTaipei = (time: number) => new Date(time).toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Bybit 整輪不可用才改 Gate；BTC 基準、標的 K 線與深度一律鎖定同一來源，避免跨所量能混用。 */
async function loadUniverse(cutoff: number) {
  let source: Source = 'BYBIT_SPOT';
  try {
    const [universe, btc] = await Promise.all([fetchUniverse(source), fetchRadarCandles('BTCUSDT', cutoff, source)]);
    return { source, universe, btc };
  } catch {
    source = 'GATE_SPOT';
    const [universe, btc] = await Promise.all([fetchUniverse(source), fetchRadarCandles('BTCUSDT', cutoff, source)]);
    return { source, universe, btc };
  }
}

async function analyzeCoin(coin: MarketTicker, cutoff: number, source: Source, btc: Awaited<ReturnType<typeof fetchRadarCandles>>) {
  try {
    const fourHourCutoff = Math.floor(cutoff / FOUR_HOUR_MS) * FOUR_HOUR_MS;
    const [candles, depth, fourHour] = await Promise.all([
      coin.symbol === 'BTCUSDT' ? Promise.resolve(btc) : fetchRadarCandles(coin.symbol, cutoff, source),
      fetchRadarDepth(coin.symbol, source),
      /** 4 小時歷史不足（新幣）時吃大魚顯示未計算，不推定為未觸發。 */
      fetchRadarFourHourCandles(coin.symbol, fourHourCutoff, source).catch(() => null),
    ]);
    const fish = fourHour ? analyzeBigFish(fourHour) : null;
    const signal = analyzePotential(candles, btc, depth, fish ? { ...fish, timeframe: '4h' } : undefined);
    signal.source = source;
    /** null 代表本次補算沒有讀取永續籌碼（雷達也只精算前三名），不是籌碼健康。 */
    signal.derivatives = null;
    return { symbol: coin.symbol, checkedAt: Date.now(), signal, error: null } satisfies RadarSnapshot;
  } catch (error) {
    return { symbol: coin.symbol, checkedAt: Date.now(), signal: null, error: errorText(error, '行情無法取得') } satisfies RadarSnapshot;
  }
}

async function recalculate(cutoff: number) {
  const cached = recalcCache.get(cutoff);
  if (cached) return cached;
  const startedAt = Date.now();
  const { source, universe, btc } = await loadUniverse(cutoff);
  const selected = selectCandidates(universe, cutoff);
  const snapshots: RadarSnapshot[] = [];
  for (let start = 0; start < selected.length; start += RECALC_CONCURRENCY) {
    if (Date.now() - startedAt >= RECALC_BUDGET_MS) break;
    snapshots.push(...await Promise.all(selected.slice(start, start + RECALC_CONCURRENCY)
      .map(coin => analyzeCoin(coin, cutoff, source, btc))));
  }
  recalcCache.clear();
  recalcCache.set(cutoff, snapshots);
  return snapshots;
}

export async function loadCryptoPanel(db: Db | null, backtests: Map<string, BacktestSummary>, now: number): Promise<DashboardPanelData> {
  const errors: string[] = [];
  const notes: string[] = [];
  /** cutoff 是目前這根 15 分 K 的開盤時間；最新已收盤 K 的 barTime = cutoff − 15 分鐘。 */
  const cutoff = Math.floor(now / QUARTER_MS) * QUARTER_MS;
  const latestBarTime = cutoff - QUARTER_MS;
  let dbSnapshots: RadarSnapshot[] = [];
  let observations: RadarObservation[] = [];
  if (db) {
    try {
      const [rows, observationRows] = await Promise.all([
        db.select().from(potentialRadar),
        db.select().from(potentialObservations).orderBy(desc(potentialObservations.enteredAt)).limit(300),
      ]);
      /** 只採用目前雷達版本，避免舊版 15 分吃大魚快照冒充 4 小時訊號。 */
      dbSnapshots = rows.map(row => parse<RadarSnapshot>(row.snapshotJson))
        .filter((item): item is RadarSnapshot => !!item?.signal && item.signal.version === RADAR_RULES.version);
      observations = observationRows.map(row => parse<RadarObservation>(row.observationJson))
        .filter((item): item is RadarObservation => !!item);
    } catch { errors.push('D1 潛力幣雷達資料表讀取失敗，請確認 migration 已套用'); }
  }
  const dbLatestBarTime = dbSnapshots.length ? Math.max(...dbSnapshots.map(item => item.signal!.barTime)) : null;
  /** 雷達每 15 分鐘（02／17／32／47 分）掃描；落後超過 30 分鐘即視為排程停擺，改即時補算。 */
  const dbUsable = dbLatestBarTime != null && now - (dbLatestBarTime + QUARTER_MS) <= DASHBOARD_RULES.cryptoStaleMs;

  let source: DashboardPanelData['source'] = 'RADAR_DB';
  let snapshots: RadarSnapshot[] = [];
  let stale = false;
  let staleReason: string | null = null;
  if (dbUsable) {
    snapshots = dbSnapshots.filter(item => item.signal!.barTime === dbLatestBarTime);
    if (dbLatestBarTime! < latestBarTime) {
      stale = true;
      staleReason = `D1 雷達最新一批為 ${formatTaipei(dbLatestBarTime! + QUARTER_MS)} 收盤，等待下一輪排程更新。`;
    }
  } else {
    source = 'LIVE_RECALC';
    notes.push(dbLatestBarTime == null ? 'D1 潛力幣雷達沒有目前版本的掃描結果（排程可能未啟用或版本已升級），改用同一套雷達函式即時補算。'
      : `D1 潛力幣雷達最後一批停在 ${formatTaipei(dbLatestBarTime + QUARTER_MS)} 收盤，已超過 30 分鐘，改用同一套雷達函式即時補算。`);
    try { snapshots = await recalculate(cutoff); }
    catch (error) { errors.push(`Bybit／Gate 公開行情無法取得：${errorText(error, '未知錯誤')}`); }
  }
  notes.push('永續籌碼（OI、資金費率）未在此頁重新讀取；請到潛力幣雷達頁查看前三名候選的籌碼判讀。');

  errors.push(...snapshots.filter(item => item.error || !item.signal).map(item => `${item.symbol}：${item.error ?? '沒有訊號資料'}`));
  const analyzed = snapshots.filter(item => item.signal && !item.error);
  const trackFor = cryptoTrackRecords(observations);
  const context = { market: 'CRYPTO' as const, latestBarTime, backtests };
  const picks = rankPicks(analyzed.filter(isCryptoPickable).map(item => cryptoSnapshotToPick(item, context, trackFor)));
  const watchlist = rankWatchlist(analyzed.filter(item => !isCryptoPickable(item)).map(cryptoWatchItem));
  const emptyReason = picks.length ? null : !snapshots.length
    ? (errors.length ? '虛擬幣行情無法取得，無法產生清單。' : '潛力幣雷達目前沒有可分析的資料。')
    : explainEmpty(analyzed.length, analyzed.map(item => item.signal!.phase));
  /** 標出實際使用的現貨交易所；Bybit 整輪失敗時雷達會改用 Gate，價格與量能可能與 Bybit 略有差異。 */
  const exchange = analyzed[0]?.signal?.source === 'GATE_SPOT' ? 'Gate 現貨' : 'Bybit 現貨';
  return { market: 'CRYPTO', source,
    sourceLabel: source === 'RADAR_DB' ? `D1 潛力幣雷達（每 15 分鐘排程寫入・${exchange}）` : `潛力幣雷達即時補算（${exchange}・不寫入 D1、不推播）`,
    generatedAt: Date.now(),
    latestBarClosedAt: analyzed.length ? Math.max(...analyzed.map(item => item.signal!.barTime)) + QUARTER_MS : null,
    stale, staleReason, scannedCount: analyzed.length, picks, watchlist, emptyReason, errors, notes, ruleSummary: RULE_SUMMARY };
}
