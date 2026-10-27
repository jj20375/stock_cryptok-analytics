/**
 * @file 台股／美股面板：優先讀 D1 雷達最新一批結果；D1 落後於最新已收盤 4 小時段或沒有資料時，
 * 以同一套雷達函式（初篩、K 線、analyzeTwStock／analyzeUsStock）即時補算。
 * 副作用：只呼叫 Yahoo／證交所公開行情與讀取 D1；不寫入雷達表、不建立通知、不推播 Slack、不下單。
 */
import { desc } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/d1';
import { twStockObservations, twStockRadar } from '../../db/twStockRadarSchema';
import { usStockObservations, usStockRadar } from '../../db/usStockRadarSchema';
import { analyzeTwStock } from '../twStockRadar/analysis';
import { fetchTwStockCandles, fetchTwStockUniverse, selectTwStockCandidates } from '../twStockRadar/market';
import { TW_STOCK_RADAR_RULES } from '../twStockRadar/types';
import { analyzeUsStock } from '../usStockRadar/analysis';
import { fetchUsStockCandles, fetchUsStockUniverse, selectUsStockCandidates } from '../usStockRadar/market';
import { US_STOCK_FOUR_HOUR_MS, US_STOCK_RADAR_RULES, type UsStockCandle, type UsStockObservation,
  type UsStockSignal, type UsStockSnapshot, type UsStockTicker } from '../usStockRadar/types';
import { explainEmpty, isStockPickable, rankPicks, rankWatchlist, stockSnapshotToPick, stockWatchItem } from './picks';
import { DASHBOARD_RULES, type DashboardPanelData } from './types';
import { stockTrackRecords, type BacktestSummary } from './validation';

type Db = ReturnType<typeof drizzle>;
type CandleResult = { candles: UsStockCandle[]; name: string; symbol?: string };

/** 台美股共用流程，差異只在行情來源、基準指數與雷達版本。 */
interface StockAdapter {
  market: 'TW' | 'US';
  /** 基準 ETF：台股 0050、美股 SPY；用來確認最新已收盤 4 小時段，也是雷達相對強弱的比較基準。 */
  benchmark: string;
  benchmarkLabel: string;
  version: string;
  sourceLabel: string;
  ruleSummary: string;
  fetchUniverse: () => Promise<UsStockTicker[]>;
  selectCandidates: (universe: UsStockTicker[], slot: number) => UsStockTicker[];
  fetchCandles: (symbol: string, interval: '4h' | '1d', cutoff: number) => Promise<CandleResult>;
  analyze: (intraday: UsStockCandle[], daily: UsStockCandle[], benchmarkIntraday: UsStockCandle[],
    benchmarkDaily: UsStockCandle[]) => UsStockSignal;
  readDb: (db: Db) => Promise<{ snapshots: string[]; observations: string[] }>;
}

export const STOCK_ADAPTERS: Record<'TW' | 'US', StockAdapter> = {
  TW: {
    market: 'TW', benchmark: '0050.TW', benchmarkLabel: '0050', version: TW_STOCK_RADAR_RULES.version,
    sourceLabel: '台股潛力雷達',
    ruleSummary: '4 小時經典吃大魚 2.0（MACD 金叉＋EMA200 或 Supertrend 翻綠）、放量突破／回踩續強，並需日線 EMA20／50 多頭；股價 ≥ 10 元、20 日均成交額 ≥ 5,000 萬元，過熱（距 EMA20 > 3 ATR 或當日 ≥ 9.5%）排除。',
    fetchUniverse: fetchTwStockUniverse, selectCandidates: selectTwStockCandidates,
    fetchCandles: fetchTwStockCandles, analyze: analyzeTwStock,
    readDb: async db => {
      const [snapshots, observations] = await Promise.all([
        db.select().from(twStockRadar),
        db.select().from(twStockObservations).orderBy(desc(twStockObservations.enteredAt)).limit(200),
      ]);
      return { snapshots: snapshots.map(row => row.snapshotJson), observations: observations.map(row => row.observationJson) };
    },
  },
  US: {
    market: 'US', benchmark: 'SPY', benchmarkLabel: 'SPY', version: US_STOCK_RADAR_RULES.version,
    sourceLabel: '美股潛力雷達',
    ruleSummary: '4 小時經典吃大魚 2.0（MACD 金叉＋EMA200 或 Supertrend 翻綠）、放量突破／回踩續強，並需日線 EMA20／50 多頭；股價 ≥ 2 美元、20 日均成交額 ≥ 2,000 萬美元，過熱（距 EMA20 > 3 ATR 或當日 ≥ 15%）排除。',
    fetchUniverse: fetchUsStockUniverse, selectCandidates: selectUsStockCandidates,
    fetchCandles: fetchUsStockCandles, analyze: analyzeUsStock,
    readDb: async db => {
      const [snapshots, observations] = await Promise.all([
        db.select().from(usStockRadar),
        db.select().from(usStockObservations).orderBy(desc(usStockObservations.enteredAt)).limit(200),
      ]);
      return { snapshots: snapshots.map(row => row.snapshotJson), observations: observations.map(row => row.observationJson) };
    },
  },
};

/** 即時補算並行數與時間預算：5 檔並行、25 秒內收尾，避免單一慢標的拖垮整個請求。 */
const RECALC_CONCURRENCY = 5;
const RECALC_BUDGET_MS = 25_000;
/** 同一根已收盤 4 小時段的補算結果不會改變；在同一 Worker isolate 內保留 30 分鐘，減少重複抓取 Yahoo。 */
const RECALC_CACHE_MS = 30 * 60 * 1000;
const recalcCache = new Map<string, { expiresAt: number; snapshots: UsStockSnapshot[] }>();

const parse = <T>(value: string): T | null => { try { return JSON.parse(value) as T; } catch { return null; } };
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** 用雷達同一套流程重算最新已收盤段；任何單檔失敗只記錄原因，不以舊資料或預設值補位。 */
async function recalculate(adapter: StockAdapter, benchmark: { intraday: UsStockCandle[]; daily: UsStockCandle[] }, now: number) {
  const barTime = benchmark.intraday.at(-1)!.openTime;
  const cacheKey = `${adapter.market}:${barTime}`;
  const cached = recalcCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.snapshots;
  const universe = await adapter.fetchUniverse();
  const selected = adapter.selectCandidates(universe, Math.floor(barTime / US_STOCK_FOUR_HOUR_MS));
  const snapshots: UsStockSnapshot[] = [];
  /** 時間預算以實際開始時間計算；now 只代表「行情截止時間」，可能由測試注入過去時間。 */
  const startedAt = Date.now();
  for (let start = 0; start < selected.length; start += RECALC_CONCURRENCY) {
    if (Date.now() - startedAt >= RECALC_BUDGET_MS) break;
    snapshots.push(...await Promise.all(selected.slice(start, start + RECALC_CONCURRENCY).map(async ticker => {
      try {
        const [intraday, daily] = await Promise.all([adapter.fetchCandles(ticker.symbol, '4h', now),
          adapter.fetchCandles(ticker.symbol, '1d', now)]);
        const signal = adapter.analyze(intraday.candles, daily.candles, benchmark.intraday, benchmark.daily);
        return { symbol: intraday.symbol ?? ticker.symbol, name: intraday.name || ticker.name,
          checkedAt: Date.now(), signal, error: null } satisfies UsStockSnapshot;
      } catch (error) {
        return { symbol: ticker.symbol, name: ticker.name, checkedAt: Date.now(), signal: null,
          error: errorText(error, '公開行情無法取得') } satisfies UsStockSnapshot;
      }
    })));
  }
  recalcCache.set(cacheKey, { expiresAt: now + RECALC_CACHE_MS, snapshots });
  return snapshots;
}

/** 讀取基準 ETF 的已收盤 4 小時與日線；失敗回傳 null，由呼叫端明確標示「無法確認最新段」。 */
async function fetchBenchmark(adapter: StockAdapter, now: number) {
  try {
    const [intraday, daily] = await Promise.all([adapter.fetchCandles(adapter.benchmark, '4h', now),
      adapter.fetchCandles(adapter.benchmark, '1d', now)]);
    return { intraday: intraday.candles, daily: daily.candles, error: null };
  } catch (error) {
    return { intraday: null, daily: null, error: `${adapter.benchmarkLabel} 基準行情無法取得：${errorText(error, '未知錯誤')}` };
  }
}

const formatTaipei = (time: number) => new Date(time).toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** 最新已收盤段超過 6 小時前，代表目前不在交易時段（台股午後收盤、美股夜間或週末）。 */
const CLOSED_MARKET_GAP_MS = 6 * 60 * 60 * 1000;

export async function loadStockPanel(adapter: StockAdapter, db: Db | null,
  backtests: Map<string, BacktestSummary>, now: number): Promise<DashboardPanelData> {
  const errors: string[] = [];
  const notes: string[] = [];
  let dbSnapshots: UsStockSnapshot[] = [];
  let observations: UsStockObservation[] = [];
  if (db) {
    try {
      const rows = await adapter.readDb(db);
      /** 只採用目前雷達版本；改版前的舊快照與追蹤樣本不能混入排序或驗證分母。 */
      dbSnapshots = rows.snapshots.map(row => parse<UsStockSnapshot>(row))
        .filter((item): item is UsStockSnapshot => !!item?.signal && item.signal.version === adapter.version);
      observations = rows.observations.map(row => parse<UsStockObservation>(row))
        .filter((item): item is UsStockObservation => !!item && item.signal.version === adapter.version);
    } catch { errors.push(`D1 ${adapter.sourceLabel}資料表讀取失敗，請確認 migration 已套用`); }
  }
  const benchmark = await fetchBenchmark(adapter, now);
  if (benchmark.error) errors.push(benchmark.error);
  const latestBar = benchmark.intraday?.at(-1) ?? null;
  const dbLatestBarTime = dbSnapshots.length ? Math.max(...dbSnapshots.map(item => item.signal!.barTime)) : null;

  let source: DashboardPanelData['source'] = 'RADAR_DB';
  let snapshots: UsStockSnapshot[] = [];
  let stale = false;
  let staleReason: string | null = null;
  if (dbLatestBarTime != null && (!latestBar || dbLatestBarTime >= latestBar.openTime)) {
    snapshots = dbSnapshots.filter(item => item.signal!.barTime === dbLatestBarTime);
    if (!latestBar) {
      stale = true;
      staleReason = `無法向 Yahoo 確認是否有更新的收盤段；顯示 D1 雷達最後一批（${formatTaipei(snapshots[0].signal!.closedAt)} 收盤）。`;
    }
  } else if (latestBar && benchmark.intraday && benchmark.daily) {
    source = 'LIVE_RECALC';
    notes.push(dbLatestBarTime == null ? `D1 ${adapter.sourceLabel}尚無目前版本的掃描結果（排程可能未啟用），改用同一套雷達函式即時補算。`
      : `D1 ${adapter.sourceLabel}最後一批停在 ${formatTaipei(dbSnapshots.find(item => item.signal!.barTime === dbLatestBarTime)!.signal!.closedAt)} 收盤，已落後最新收盤段，改用同一套雷達函式即時補算。`);
    try { snapshots = await recalculate(adapter, { intraday: benchmark.intraday, daily: benchmark.daily }, now); }
    catch (error) { errors.push(`即時補算失敗：${errorText(error, '未知錯誤')}`); }
  }
  if (latestBar?.closeTime && now - latestBar.closeTime > CLOSED_MARKET_GAP_MS) {
    notes.push(`目前非交易時段：訊號以最近一個已收盤 4 小時段（${formatTaipei(latestBar.closeTime)} 收盤）計算，開盤後價格可能跳空。`);
  }

  const failed = snapshots.filter(item => item.error || !item.signal);
  errors.push(...failed.map(item => `${item.symbol}：${item.error ?? '沒有訊號資料'}`));
  const analyzed = snapshots.filter(item => item.signal && !item.error);
  const trackFor = stockTrackRecords(observations, adapter.benchmarkLabel);
  const context = { market: adapter.market, latestBarTime: latestBar?.openTime ?? dbLatestBarTime, backtests };
  const picks = rankPicks(analyzed.filter(isStockPickable).map(item => stockSnapshotToPick(item, context, trackFor)));
  const watchlist = rankWatchlist(analyzed.filter(item => !isStockPickable(item)).map(item => stockWatchItem(adapter.market, item)));
  const notTrendUp = analyzed.filter(item => !item.signal!.dailyTrendUp &&
    !['EXTENDED', 'EXCLUDED'].includes(item.signal!.phase)).length;
  const emptyReason = picks.length ? null : !snapshots.length
    ? (errors.length ? `${adapter.sourceLabel}資料無法取得，無法產生清單。` : `${adapter.sourceLabel}目前沒有可分析的資料。`)
    : explainEmpty(analyzed.length, analyzed.map(item => item.signal!.phase), notTrendUp ? [`${notTrendUp} 檔日線 EMA20／50 尚未轉多`] : []);
  const latestClosedAt = analyzed.length ? Math.max(...analyzed.map(item => item.signal!.closedAt)) : latestBar?.closeTime ?? null;
  return { market: adapter.market, source,
    sourceLabel: source === 'RADAR_DB' ? `D1 ${adapter.sourceLabel}（排程寫入）` : `${adapter.sourceLabel}即時補算（不寫入 D1、不推播）`,
    generatedAt: Date.now(), latestBarClosedAt: latestClosedAt, stale, staleReason,
    scannedCount: analyzed.length, picks: picks.slice(0, DASHBOARD_RULES.maxPicks), watchlist, emptyReason, errors, notes,
    ruleSummary: adapter.ruleSummary };
}
