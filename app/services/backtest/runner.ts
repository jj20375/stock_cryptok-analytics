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
import { eq } from 'drizzle-orm';
import { backtests, backtestTrades } from '../../db/schema';
import { getStrategy } from '../strategy/registry';
import { fetchBinanceRange, intervalToMs } from '../marketData/binanceHistory';
import { fetchStockDailyHistory, toYahooSymbol } from '../marketData/stockDailyHistory';
import { findGaps, getKlineRange, upsertKlines, type MarketType } from '../marketData/klineStore';
import { runBacktestEngine, type EngineConfig, type FillMode } from './engine';
import { computeMetrics, downsampleEquityCurve } from './metrics';

type D1Db = ReturnType<typeof drizzle>;

// 單次 prepare 呼叫最多抓的頁數(每頁 1000 根)。
// 控制 Workers subrequest 用量:40 頁 + D1 batch 寫入仍在安全範圍內。
const MAX_PAGES_PER_INVOCATION = 40;

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

  await db.update(backtests).set({ status: 'PREPARING' }).where(eq(backtests.id, backtestId));

  try {
    const market = row.market as MarketType;
    const intervalMs = intervalToMs(row.interval);
    const fetchStart = row.startTime - warmupPadMs(strategy.warmupBars, intervalMs);
    // 終點不可超過現在(未來的 K 線不存在)
    const fetchEnd = Math.min(row.endTime, Date.now());

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

    // 加密貨幣:缺口偵測 + 分頁補抓
    const gaps = await findGaps(db, row.symbol, row.interval, fetchStart, fetchEnd, intervalMs);
    if (gaps.length === 0) {
      return { complete: true, message: '快取資料已完整,無需補抓' };
    }

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
      const result = await fetchBinanceRange(row.symbol, row.interval, gap.from, gap.to, remainingPages);
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

  await db.update(backtests).set({ status: 'RUNNING' }).where(eq(backtests.id, backtestId));

  try {
    const params = JSON.parse(row.paramsJson) as BacktestRunParams;
    const intervalMs = intervalToMs(row.interval);
    const fetchStart = row.startTime - warmupPadMs(strategy.warmupBars, intervalMs);
    const fetchEnd = Math.min(row.endTime, Date.now());

    const candles = await getKlineRange(db, row.symbol, row.interval, fetchStart, fetchEnd);
    if (candles.length < strategy.warmupBars + 10) {
      throw new Error(
        `資料不足:僅 ${candles.length} 根 K 線,策略暖機需 ${strategy.warmupBars} 根。請縮短暖機或確認標的上市時間。`
      );
    }

    const engineConfig: EngineConfig = {
      initialCapital: params.initialCapital,
      cost: { feeRate: params.feeRate, slippageBps: params.slippageBps },
      fillMode: params.fillMode,
      maxRiskPerTradePct: params.maxRiskPerTradePct,
      maxPositionSizePct: params.maxPositionSizePct,
      defaultStopLossPct: params.defaultStopLossPct,
      precision: params.precision,
    };

    const { trades, equityCurve } = runBacktestEngine(
      candles,
      strategy,
      params.strategyParams,
      engineConfig,
      row.startTime
    );

    // 年化因子:美股/台股日線用 252 交易日;加密貨幣 24h 全年無休用「一年毫秒 / 週期毫秒」
    const barsPerYear =
      (row.market === 'US' || row.market === 'TW') && row.interval === '1d'
        ? US_TRADING_DAYS_PER_YEAR
        : Math.round(YEAR_MS / intervalMs);

    const metrics = computeMetrics(equityCurve, trades, params.initialCapital, barsPerYear);
    // Profit Factor 可能為 Infinity(零虧損),JSON 不支援 → 以 9999 代表「無虧損」
    if (!Number.isFinite(metrics.profitFactor)) metrics.profitFactor = 9999;

    // 批次寫入交易明細(13 參數/列 × 7 列 = 91 < D1 bind 上限 100)
    const statements: any[] = [];
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
        resultJson: JSON.stringify(metrics),
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
