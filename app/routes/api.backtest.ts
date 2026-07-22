/**
 * 【詳細繁體中文註解】：回測 API
 *
 * POST(action 區分):
 *   - create  :建立回測任務(寫入 backtests,status=PENDING),回傳 { id }
 *   - prepare :補抓歷史資料;回傳 { complete, message }。complete=false 時前端輪詢續呼叫
 *   - run     :執行回測計算並落地結果;回傳 { status: 'DONE' }
 * GET(query 區分):
 *   - ?strategies=1        :策略註冊表(供 UI 下拉與參數表單)
 *   - ?list=1              :當前使用者最近 20 筆回測
 *   - ?id=N                :單筆回測結果(含績效、權益曲線、交易明細)
 *   - ?id=N&klines=1       :該回測區間的 K 線(供圖表標記進出場點,上限 10000 根)
 *
 * 權限:全部端點皆需登入(session userId);回測資料只允許本人存取。
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq } from 'drizzle-orm';
import { backtests, backtestTrades } from '../db/schema';
import { getUserId } from '../utils/auth';
import { getStrategy, listStrategies } from '../services/strategy/registry';
import { prepareBacktestData, runBacktest, type BacktestRunParams } from '../services/backtest/runner';
import { getKlineRange } from '../services/marketData/klineStore';
import { fetchBitgetStockTickers } from '../services/marketData/bitgetStockSymbols';

// 允許的市場與週期白名單(防止寫入奇怪值)
const ALLOWED_MARKETS = ['CRYPTO', 'US', 'TW'];
const ALLOWED_INTERVALS = ['15m', '1h', '4h', '1d'];
// 回測 K 線圖回傳上限:KlineCharts 可流暢處理的量級
const MAX_CHART_KLINES = 10000;

const jsonError = (message: string, status: number = 400) =>
  Response.json({ error: message }, { status });

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context as any).cloudflare.env;
  const userId = await getUserId(request, env);
  if (!userId) return jsonError('Unauthorized', 401);

  const db = drizzle(env.DB);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError('無效的 JSON body');
  }

  try {
    switch (body.action) {
      case 'create': {
        const { strategyId, symbol, market, interval, startTime, endTime, params } = body;

        const strategy = getStrategy(String(strategyId ?? ''));
        if (!strategy) return jsonError(`未註冊的策略: ${strategyId}`);
        if (!ALLOWED_MARKETS.includes(market)) return jsonError(`不支援的市場: ${market}`);
        if (!ALLOWED_INTERVALS.includes(interval)) return jsonError(`不支援的週期: ${interval}`);
        if (!strategy.markets.includes(market)) return jsonError(`策略「${strategy.name}」不支援 ${market} 市場`);
        if (!strategy.supportedIntervals.includes(interval)) {
          return jsonError(`策略「${strategy.name}」不支援 ${interval} 週期`);
        }
        if (!symbol || typeof symbol !== 'string') return jsonError('缺少標的代號');

        const start = Number(startTime);
        const end = Number(endTime);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
          return jsonError('回測起訖時間不正確');
        }

        // 合併策略參數:未提供的欄位用預設值,只接受數值(避免 JSON 注入奇怪型別)
        const strategyParams: Record<string, number> = { ...strategy.defaultParams };
        if (params?.strategyParams && typeof params.strategyParams === 'object') {
          for (const key of Object.keys(strategy.defaultParams)) {
            const value = Number(params.strategyParams[key]);
            if (Number.isFinite(value)) strategyParams[key] = value;
          }
        }

        const toNumber = (value: unknown, fallback: number) => {
          const n = Number(value);
          return Number.isFinite(n) && n >= 0 ? n : fallback;
        };

        // 完整回測參數(存入 params_json,確保結果可重現)
        const runParams: BacktestRunParams = {
          strategyParams,
          // 手續費預設:加密貨幣 Binance 現貨 taker 0.1%、美股免佣預設 0、
          // 台股約 0.1425%(未計入賣出證交稅 0.3%,回測會低估台股交易成本,報告頁需揭露此簡化假設)
          feeRate: toNumber(params?.feeRate, market === 'CRYPTO' ? 0.001 : market === 'TW' ? 0.001425 : 0),
          slippageBps: toNumber(params?.slippageBps, 5),
          fillMode: params?.fillMode === 'close' ? 'close' : 'nextOpen',
          initialCapital: toNumber(params?.initialCapital, 1000),
          maxRiskPerTradePct: toNumber(params?.maxRiskPerTradePct, 1),
          maxPositionSizePct: toNumber(params?.maxPositionSizePct, 50),
          defaultStopLossPct: toNumber(params?.defaultStopLossPct, 5),
          // 數量精度:美股允許小數 4 位(模擬碎股)、加密貨幣預設 5 位(BTC 等級)、
          // 台股以整股為單位(不模擬零股/整張限制)
          precision: toNumber(params?.precision, market === 'CRYPTO' ? 5 : market === 'TW' ? 0 : 4),
        };

        const [created] = await db
          .insert(backtests)
          .values({
            userId,
            strategyId: strategy.id,
            symbol: symbol.toUpperCase(),
            market,
            interval,
            startTime: start,
            endTime: end,
            paramsJson: JSON.stringify(runParams),
            status: 'PENDING',
          })
          .returning({ id: backtests.id });

        return Response.json({ id: created.id });
      }

      case 'prepare': {
        const backtestId = Number(body.id);
        const owned = await assertOwnership(db, backtestId, userId);
        if (!owned) return jsonError('找不到回測或無權限', 404);
        const result = await prepareBacktestData(db, backtestId);
        return Response.json(result);
      }

      case 'run': {
        const backtestId = Number(body.id);
        const owned = await assertOwnership(db, backtestId, userId);
        if (!owned) return jsonError('找不到回測或無權限', 404);
        await runBacktest(db, backtestId);
        return Response.json({ status: 'DONE' });
      }

      default:
        return jsonError(`未知的 action: ${body.action}`);
    }
  } catch (error) {
    console.error('🔥 [Backtest API] 執行失敗:', error);
    return jsonError((error as Error).message, 500);
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any).cloudflare.env;
  const userId = await getUserId(request, env);
  if (!userId) return jsonError('Unauthorized', 401);

  const db = drizzle(env.DB);
  const url = new URL(request.url);

  try {
    // 策略註冊表(UI 下拉 + 動態參數表單;不含 evaluate 函式)
    if (url.searchParams.get('strategies')) {
      return Response.json({
        strategies: listStrategies().map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          markets: s.markets,
          supportedIntervals: s.supportedIntervals,
          supportsShort: s.supportsShort,
          defaultParams: s.defaultParams,
          paramMeta: s.paramMeta,
        })),
      });
    }

    // Bitget 股票代幣清單(僅用於擴充美股標的選單,不含價量資料;查詢失敗回空陣列不阻斷頁面)
    if (url.searchParams.get('usStockTickers')) {
      const tickers = await fetchBitgetStockTickers();
      return Response.json({ tickers });
    }

    // 使用者最近的回測列表
    if (url.searchParams.get('list')) {
      const rows = await db
        .select({
          id: backtests.id,
          strategyId: backtests.strategyId,
          symbol: backtests.symbol,
          market: backtests.market,
          interval: backtests.interval,
          startTime: backtests.startTime,
          endTime: backtests.endTime,
          status: backtests.status,
          resultJson: backtests.resultJson,
          createdAt: backtests.createdAt,
        })
        .from(backtests)
        .where(eq(backtests.userId, userId))
        .orderBy(desc(backtests.id))
        .limit(20);
      return Response.json({ backtests: rows });
    }

    // 單筆回測詳情
    const id = Number(url.searchParams.get('id'));
    if (!Number.isFinite(id)) return jsonError('缺少 id');

    const [row] = await db
      .select()
      .from(backtests)
      .where(and(eq(backtests.id, id), eq(backtests.userId, userId)));
    if (!row) return jsonError('找不到回測或無權限', 404);

    // K 線資料(供圖表繪製與進出場標記)
    if (url.searchParams.get('klines')) {
      const candles = await getKlineRange(db, row.symbol, row.interval, row.startTime, Math.min(row.endTime, Date.now()));
      // 超過上限時只回傳最近的 MAX_CHART_KLINES 根(圖表體驗優先,完整資料仍在 DB)
      const sliced = candles.length > MAX_CHART_KLINES ? candles.slice(-MAX_CHART_KLINES) : candles;
      return Response.json({ klines: sliced, truncated: candles.length > sliced.length });
    }

    const trades = await db
      .select()
      .from(backtestTrades)
      .where(eq(backtestTrades.backtestId, id))
      .orderBy(backtestTrades.entryTime);

    return Response.json({
      backtest: {
        ...row,
        paramsJson: undefined,
        params: JSON.parse(row.paramsJson),
        result: row.resultJson ? JSON.parse(row.resultJson) : null,
        equityCurve: row.equityCurveJson ? JSON.parse(row.equityCurveJson) : null,
        resultJson: undefined,
        equityCurveJson: undefined,
      },
      trades,
    });
  } catch (error) {
    console.error('🔥 [Backtest API] 查詢失敗:', error);
    return jsonError((error as Error).message, 500);
  }
}

/** 確認回測屬於當前使用者(防止越權操作他人任務) */
const assertOwnership = async (
  db: ReturnType<typeof drizzle>,
  backtestId: number,
  userId: number
): Promise<boolean> => {
  if (!Number.isFinite(backtestId)) return false;
  const [row] = await db
    .select({ id: backtests.id })
    .from(backtests)
    .where(and(eq(backtests.id, backtestId), eq(backtests.userId, userId)));
  return !!row;
};
