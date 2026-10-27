/** @file 回測資料準備及 D1 結果落地；策略暖機依最終參數計算，副作用只由協調層處理。 */
/**
 * 【詳細繁體中文註解】：回測協調層(runner)
 *
 * 職責:銜接「D1 資料 ↔ 回測引擎 ↔ 結果落地」,並把工作切成兩個階段:
 *   prepare — 補齊 kline_cache 歷史資料(外部 API 抓取,受 Workers subrequest 上限約束,
 *             單次呼叫最多抓 MAX_PAGES_PER_INVOCATION 頁,未完成回傳進度由前端輪詢續跑)
 *   run     — 純計算:讀快取 → 逐根重放 → 績效指標 → 寫回 backtests / backtest_trades
 *             (15m × 2 年 ≈ 7 萬根,指標與主迴圈皆 O(n),遠低於 Workers CPU 上限)
 *
 * DB 寫入副作用註記:run 成功會覆寫 result_json / equity_curve_json 並批次寫入交易明細;
 * 失敗會把 status 標為 ERROR 並記錄錯誤訊息,不會留下半套結果(明細於成功路徑最後才寫入)。
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { backtests, backtestTrades } from '../../db/schema';
import { getStrategy } from '../strategy/registry';
import { fetchBinanceRange, intervalToMs, type CryptoKlineSource } from '../marketData/binanceHistory';
import { fetchStockDailyHistory, toYahooSymbol } from '../marketData/stockDailyHistory';
import { clearCryptoKlineSeries, findGaps, getKlineRange, upsertKlines, type MarketType } from '../marketData/klineStore';
import { runBacktestEngine, type EngineConfig, type FillMode } from './engine';
import { computeMetrics, downsampleEquityCurve } from './metrics';
import { validateWaveCandles } from '../waveRadar/state';
import { prepareFuturesResearch, readFuturesResearch, type FuturesResearchSettings } from '../cryptoFutures/research.server';
import { buildFuturesEvaluation } from '../cryptoFutures/evaluation';

type D1Db = ReturnType<typeof drizzle>;

// 單次 prepare 呼叫最多抓的頁數(每頁 1000 根)。
// 每趟至多 4000 根，為備援請求與 D1 分批寫入留餘裕，剩餘資料由前端續跑。
const MAX_PAGES_PER_INVOCATION = 4;

// 一年毫秒數(加密貨幣 24h 全年無休的年化基準)
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
// 美股/台股日線的年化因子:一年約 252 個交易日
const US_TRADING_DAYS_PER_YEAR = 252;

// 交易明細批次寫入:13 個參數/列,每語句 7 列 = 91 參數 < D1 上限 100
const TRADE_ROWS_PER_STATEMENT = 7;

/** params_json 的完整結構(建立回測時序列化存入,確保結果可重現) */
export interface BacktestRunParams {
  /** 策略參數(與 defaultParams 合併後的最終值) */
  strategyParams: Record<string, number>;
  /** 手續費率(0.001 = 0.1%) */
  feeRate: number;
  /** 可調 SELL 稅率；舊 params_json 沒有此欄時不改寫原成本假設。 */
  sellTaxRate?: number;
  /** 滑價基點 */
  slippageBps: number;
  fillMode: FillMode;
  /** 初始資金 */
  initialCapital: number;
  /** 單筆風險 % */
  maxRiskPerTradePct: number;
  /** 最大倉位 % */
  maxPositionSizePct: number;
  /** 預設停損 %(策略未宣告時使用) */
  defaultStopLossPct: number;
  /** 下單數量小數位數 */
  precision: number;
  /**
   * 首次補資料時鎖定的加密貨幣行情來源。
   * 分頁續抓時必須沿用同一來源,否則主來源短暫故障會讓後續頁面改抓別家交易所,
   * 造成同一份回測資料混入不同交易所的價格與成交量。
   */
  klineSource?: CryptoKlineSource;
  futures?: FuturesResearchSettings;
}

/** 暖機資料的往前抓取範圍:暖機根數 × 週期 × 2 倍裕度(美股遇週末假日仍足夠) */
const warmupPadMs = (warmupBars: number, intervalMs: number): number => warmupBars * intervalMs * 2;

export interface PrepareResult {
  complete: boolean;
  /** 進度描述(前端顯示用) */
  message: string;
}

/**
 * prepare 階段:偵測缺口並補抓歷史資料。
 * 加密貨幣:findGaps + Binance 分頁抓取;美股日線:整段重抓 + INSERT OR IGNORE(冪等)。
 * 回傳 complete=false 時,前端應輪詢再次呼叫直到 complete。
 */
export const prepareBacktestData = async (db: D1Db, backtestId: number): Promise<PrepareResult> => {
  const [row] = await db.select().from(backtests).where(eq(backtests.id, backtestId));
  if (!row) throw new Error(`找不到回測 #${backtestId}`);

  const strategy = getStrategy(row.strategyId);
  if (!strategy) throw new Error(`未註冊的策略: ${row.strategyId}`);

  const futuresParams = JSON.parse(row.paramsJson) as BacktestRunParams;
  if (futuresParams.futures) {
    try { return await prepareFuturesResearch(db, row, futuresParams); }
    catch (error) { if (row.status !== 'RUNNING') await db.update(backtests).set({ status: 'ERROR', error: (error as Error).message }).where(eq(backtests.id, backtestId)); throw error; }
  }

  const wasPreparing = row.status === 'PREPARING';
  await db.update(backtests).set({ status: 'PREPARING' }).where(eq(backtests.id, backtestId));

  try {
    const market = row.market as MarketType;
    const intervalMs = intervalToMs(row.interval);
    const savedParams = (JSON.parse(row.paramsJson) as BacktestRunParams).strategyParams;
    const warmupBars = strategy.warmupBarsForParams?.(savedParams) ?? strategy.warmupBars;
    const fetchStart = row.startTime - warmupPadMs(warmupBars, intervalMs);
    // 終點不可超過現在(未來的 K 線不存在)
    /** 加密市場僅補到最新已收盤格，避免每次輪詢都重新要求仍未收盤的尾端。 */
    const fetchEnd = market === 'CRYPTO'
      ? Math.min(row.endTime, Math.floor(Date.now() / intervalMs) * intervalMs - 1)
      : Math.min(row.endTime, Date.now());

    if (market === 'US' || market === 'TW') {
      // 美股/台股:一次抓 5 年日線(單一 HTTP 請求),INSERT OR IGNORE 冪等寫入
      // 台股需補上 .TW 後綴查詢 Yahoo,但快取仍以不含後綴的原始代號儲存
      const { candles } = await fetchStockDailyHistory(toYahooSymbol(row.symbol, market), '5y');
      const inRange = candles.filter((c) => c.openTime >= fetchStart && c.openTime <= fetchEnd);
      if (inRange.length === 0) {
        throw new Error(`Yahoo 無 ${row.symbol} 在指定區間的日線資料(標的太新或代號錯誤)`);
      }
      await upsertKlines(db, market, row.symbol, row.interval, inRange);
      return { complete: true, message: `${market === 'TW' ? '台股' : '美股'} ${row.symbol} 日線已就緒(${inRange.length} 根)` };
    }

    // 避免 Binance 舊快取與新來源混用：新回測首次 prepare 時清空該組資料。
    // 分頁續跑會維持 PREPARING，因此不會重複清空尚未補完的 K 線。
    if (!wasPreparing) await clearCryptoKlineSeries(db, row.symbol, row.interval);
    const gaps = await findGaps(db, row.symbol, row.interval, fetchStart, fetchEnd, intervalMs);
    if (gaps.length === 0) {
      return { complete: true, message: '快取資料已完整,無需補抓' };
    }

    // 首次補資料由備援機制決定來源;續抓時鎖定同一來源,避免跨交易所資料混入同一份快取
    const storedParams = JSON.parse(row.paramsJson) as BacktestRunParams;
    let lockedSource: CryptoKlineSource | undefined = storedParams.klineSource;

    let pagesUsed = 0;
    let fetchedCount = 0;
    for (const gap of gaps) {
      if (pagesUsed >= MAX_PAGES_PER_INVOCATION) {
        return {
          complete: false,
          message: `已補抓 ${fetchedCount} 根,仍有缺口,請繼續輪詢`,
        };
      }
      const remainingPages = MAX_PAGES_PER_INVOCATION - pagesUsed;
      const result = await fetchBinanceRange(row.symbol, row.interval, gap.from, gap.to, remainingPages, {
        forcedSource: lockedSource,
      });
      // 首次成功抓取後把來源寫回 params_json,後續輪詢沿用同一來源
      if (!lockedSource) {
        lockedSource = result.source;
        await db
          .update(backtests)
          .set({ paramsJson: JSON.stringify({ ...storedParams, klineSource: result.source }) })
          .where(eq(backtests.id, backtestId));
      }
      // 估算本次用掉的頁數(至少 1 頁)
      pagesUsed += Math.max(1, Math.ceil(result.candles.length / 1000));
      if (result.candles.length > 0) {
        await upsertKlines(db, 'CRYPTO', row.symbol, row.interval, result.candles);
        fetchedCount += result.candles.length;
      }
      if (!result.complete) {
        return {
          complete: false,
          message: `已補抓 ${fetchedCount} 根,缺口尚未補完,請繼續輪詢`,
        };
      }
    }

    return { complete: true, message: `補抓完成(本次新增 ${fetchedCount} 根)` };
  } catch (error) {
    // 補資料失敗:標記 ERROR,寧可失敗也不用替代來源餵髒資料
    await db
      .update(backtests)
      .set({ status: 'ERROR', error: (error as Error).message })
      .where(eq(backtests.id, backtestId));
    throw error;
  }
};

/**
 * run 階段:讀取快取資料 → 逐根重放 → 計算績效 → 寫回結果。
 * 前置條件:prepare 已回報 complete(資料就緒)。
 */
export const runBacktest = async (db: D1Db, backtestId: number): Promise<void> => {
  const [row] = await db.select().from(backtests).where(eq(backtests.id, backtestId));
  if (!row) throw new Error(`找不到回測 #${backtestId}`);

  const strategy = getStrategy(row.strategyId);
  if (!strategy) throw new Error(`未註冊的策略: ${row.strategyId}`);

  if ((JSON.parse(row.paramsJson) as BacktestRunParams).futures) {
    /** 同一合約研究只能由一個計算者覆寫交易明細，避免並行重跑產生重複成交。 */
    // ponytail: 計算 Worker 中斷後以新任務重跑；需要同任務續算時再加入租約。
    if (row.status === 'RUNNING') throw new Error('此合約研究正在計算');
    const claimed = await db.update(backtests).set({ status: 'RUNNING' }).where(and(eq(backtests.id, backtestId),
      eq(backtests.status, row.status), eq(backtests.paramsJson, row.paramsJson))).returning({ id: backtests.id }).get();
    if (!claimed) throw new Error('此合約研究已由另一個請求接手');
  } else await db.update(backtests).set({ status: 'RUNNING' }).where(eq(backtests.id, backtestId));

  try {
    const params = JSON.parse(row.paramsJson) as BacktestRunParams;
    const intervalMs = intervalToMs(row.interval);
    const warmupBars = strategy.warmupBarsForParams?.(params.strategyParams) ?? strategy.warmupBars;
    const fetchStart = row.startTime - warmupPadMs(warmupBars, intervalMs);
    const fetchEnd = Math.min(row.endTime, Date.now());

    const futuresData = params.futures ? await readFuturesResearch(db, row.symbol, row.startTime, row.endTime, params.futures) : null;
    const candles = futuresData?.candles ?? await getKlineRange(db, row.symbol, row.interval, fetchStart, fetchEnd);
    if (candles.length < warmupBars + 10) {
      throw new Error(
        `資料不足:僅 ${candles.length} 根 K 線,策略暖機需 ${warmupBars} 根。請縮短暖機或確認標的上市時間。`
      );
    }

    const engineConfig: EngineConfig = {
      initialCapital: params.initialCapital,
      cost: { feeRate: params.feeRate, slippageBps: params.slippageBps, sellTaxRate: params.sellTaxRate ?? 0 },
      fillMode: params.fillMode,
      maxRiskPerTradePct: params.maxRiskPerTradePct,
      maxPositionSizePct: params.maxPositionSizePct,
      defaultStopLossPct: params.defaultStopLossPct,
      precision: params.futures?.data?.metadata.precision ?? params.precision,
      futures: futuresData?.config,
      captureEvents: !!futuresData,
    };

    // 波段日線由 4h 合成，歷史缺口會破壞日線與量能判斷；過期檢查僅適用即時雷達。
    if (strategy.id === 'crypto_wave') validateWaveCandles(candles, Date.now(), false);
    const simulation = runBacktestEngine(
      candles,
      strategy,
      params.strategyParams,
      engineConfig,
      row.startTime
    );
    const { trades, equityCurve } = simulation;

    // 年化因子:美股/台股日線用 252 交易日;加密貨幣 24h 全年無休用「一年毫秒 / 週期毫秒」
    const barsPerYear =
      (row.market === 'US' || row.market === 'TW') && row.interval === '1d'
        ? US_TRADING_DAYS_PER_YEAR
        : Math.round(YEAR_MS / intervalMs);

    const metrics = computeMetrics(equityCurve, trades, params.initialCapital, barsPerYear);
    // Profit Factor 可能為 Infinity(零虧損),JSON 不支援 → 以 9999 代表「無虧損」
    if (!Number.isFinite(metrics.profitFactor)) metrics.profitFactor = 9999;
    const futuresEvaluation = futuresData ? buildFuturesEvaluation(candles, strategy, params.strategyParams, engineConfig,
      row.startTime, simulation, params.futures!.direction, futuresData.markComplete, params.futures!.instrument) : undefined;

    // 批次寫入交易明細(13 參數/列 × 7 列 = 91 < D1 bind 上限 100)
    const statements: any[] = [];
    /** 重跑同任務覆寫結果前先清除舊研究明細，避免重複計入成交；不涉及真實委託。 */
    if (futuresData) await db.delete(backtestTrades).where(eq(backtestTrades.backtestId, backtestId));
    for (let i = 0; i < trades.length; i += TRADE_ROWS_PER_STATEMENT) {
      const chunk = trades.slice(i, i + TRADE_ROWS_PER_STATEMENT);
      statements.push(
        db.insert(backtestTrades).values(
          chunk.map((t) => ({
            backtestId,
            side: t.side,
            entryTime: t.entryTime,
            exitTime: t.exitTime,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            quantity: t.quantity,
            fee: Math.round(t.fee * 10000) / 10000,
            pnl: Math.round(t.pnl * 10000) / 10000,
            pnlPct: Math.round(t.pnlPct * 100) / 100,
            holdingBars: t.holdingBars,
            entryReason: t.entryReason,
            exitReason: t.exitReason,
          }))
        )
      );
    }
    if (statements.length > 0) {
      await (db as any).batch(statements);
    }

    await db
      .update(backtests)
      .set({
        status: 'DONE',
        resultJson: JSON.stringify({
          ...metrics,
          ...(futuresEvaluation ? { futures: futuresEvaluation } : {}),
          // 一般回測附上空手期間未進場原因，讓 0 筆或極少成交時頁面能說明是哪個條件擋掉
          ...(simulation.noEntryReasons ? { noEntryReasons: simulation.noEntryReasons } : {}),
        }),
        equityCurveJson: JSON.stringify(downsampleEquityCurve(equityCurve, 1000)),
        error: null,
      })
      .where(eq(backtests.id, backtestId));
  } catch (error) {
    await db
      .update(backtests)
      .set({ status: 'ERROR', error: (error as Error).message })
      .where(eq(backtests.id, backtestId));
    throw error;
  }
};
