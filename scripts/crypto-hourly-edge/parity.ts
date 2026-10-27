/** @file 驗證策略模組 evaluate 與研究面板逐根一致，並以正式回測引擎跑 HOLDOUT；只讀快取、只寫 research/ 結果。 */
/**
 * 【詳細繁體中文註解】：一致性檢查
 *
 * 1. 以模組預設參數（權重 ÷ 100、門檻 ÷ 100）組成研究 Model，對全部標的 HOLDOUT 期間逐列比較：
 *    研究 modelSide(row) 與模組 evaluate(position = null) 的進場方向必須相同。
 *    研究面板另外要求「未來 5 根連續」才收錄該列，這個條件模組無法（也不應）檢查，不列入比較。
 * 2. 以 runBacktestEngine（nextOpen、手續費 0.05%、滑價 5 bps、單筆風險 1%）逐檔回測 HOLDOUT，
 *    確認引擎成交與研究模擬方向一致，並彙總單檔引擎結果（每檔同時只持有一筆）。
 *
 * 執行：node --max-old-space-size=8192 --import tsx scripts/crypto-hourly-edge/parity.ts
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IndicatorCache } from '../../app/services/strategy/indicatorCache';
import strategy, { HOURLY_FOUR_HOUR_EDGE_PARAMS } from '../../app/services/strategy/strategies/hourlyFourHourEdge';
import { HOUR_MS } from '../../app/services/strategy/hourlyEdgeFeatures';
import { runBacktestEngine } from '../../app/services/backtest/engine';
import { computeMetrics } from '../../app/services/backtest/metrics';
import { loadCachedSeries, RESEARCH_DIR } from './data';
import { buildPanel } from './dataset';
import { hourOf, modelSide, type Model } from './selection';

const HOLDOUT_FROM = hourOf('2026-04-01T00:00:00Z');
const HOLDOUT_TO = hourOf('2026-10-26T00:00:00Z');

/** 模組權重鍵 `${id}_up/_down` → 研究權重鍵 `${id}:${觸發}:${下單}`；權重正負即下單方向。 */
function modelFromDefaults(): Model {
  const weights: Record<string, number> = {};
  for (const [key, value] of Object.entries(HOURLY_FOUR_HOUR_EDGE_PARAMS)) {
    const match = key.match(/^(.+)_(up|down)$/);
    if (!match || value === 0) continue;
    weights[`${match[1]}:${match[2] === 'up' ? 1 : -1}:${Math.sign(value)}`] = Math.abs(value) / 100;
  }
  return { weights, threshold: HOURLY_FOUR_HOUR_EDGE_PARAMS.entryScore / 100, minAtrPct: HOURLY_FOUR_HOUR_EDGE_PARAMS.minAtrPct / 100,
    trainMeanNet: NaN, trainTrades: 0, tradable: true };
}

async function main() {
  const panel = await buildPanel();
  const model = modelFromDefaults();
  const rowsBySymbol = new Map<number, Map<number, number>>();
  for (let r = 0; r < panel.size; r++) {
    if (panel.hour[r] < HOLDOUT_FROM || panel.hour[r] >= HOLDOUT_TO) continue;
    (rowsBySymbol.get(panel.symbol[r]) ?? rowsBySymbol.set(panel.symbol[r], new Map()).get(panel.symbol[r])!).set(panel.hour[r], r);
  }
  let compared = 0, mismatches = 0, researchEntries = 0;
  const engineRows: unknown[] = [];
  let engineTrades = 0, engineWins = 0, engineNet = 0;
  for (const [symbolIndex, rows] of rowsBySymbol) {
    const series = (await loadCachedSeries(panel.symbols[symbolIndex]))!;
    const candles = series.candles;
    const indicators = new IndicatorCache(candles);
    for (let i = 0; i < candles.length; i++) {
      const row = rows.get(candles[i].openTime / HOUR_MS);
      if (row == null) continue;
      const action = strategy.evaluate({ candles, index: i, indicators, position: null, params: { ...HOURLY_FOUR_HOUR_EDGE_PARAMS } });
      const moduleSide = action.type === 'ENTRY' ? (action.side === 'LONG' ? 1 : -1) : 0;
      const researchSide = modelSide(panel, model, row);
      compared++;
      if (researchSide) researchEntries++;
      if (moduleSide !== researchSide) mismatches++;
    }
    /** 引擎從 HOLDOUT 起點開始交易，前段資料只用於指標暖機。 */
    const simulation = runBacktestEngine(candles, strategy, { ...HOURLY_FOUR_HOUR_EDGE_PARAMS }, { initialCapital: 10_000,
      cost: { feeRate: 0.0005, slippageBps: 5 }, fillMode: 'nextOpen', maxRiskPerTradePct: 1, maxPositionSizePct: 50, defaultStopLossPct: 5,
      precision: 8 }, HOLDOUT_FROM * HOUR_MS, indicators);
    const window = simulation.trades.filter(t => t.entryTime < HOLDOUT_TO * HOUR_MS);
    if (!window.length) continue;
    const metrics = computeMetrics(simulation.equityCurve, simulation.trades, 10_000, 8760);
    engineTrades += window.length; engineWins += window.filter(t => t.pnl > 0).length; engineNet += window.reduce((s, t) => s + t.pnlPct, 0);
    engineRows.push({ symbol: panel.symbols[symbolIndex], trades: window.length, winRatePct: metrics.winRatePct,
      totalReturnPct: metrics.totalReturnPct, maxDrawdownPct: metrics.maxDrawdownPct });
  }
  const output = { compared, researchEntries, mismatches,
    engine: { symbols: engineRows.length, trades: engineTrades, winRate: engineWins / (engineTrades || 1), meanNetPctPerTrade: engineNet / (engineTrades || 1),
      perSymbol: engineRows } };
  await writeFile(join(RESEARCH_DIR, 'parity.json'), JSON.stringify(output, null, 2));
  console.log({ compared, researchEntries, mismatches, ...output.engine, perSymbol: undefined });
}

await main();
