/** @file 1h→4h 方向研究主流程：單一特徵檢定、walk-forward、凍結模型樣本外、資金管理模擬；只寫 research/ 結果檔。 */
/**
 * 【詳細繁體中文註解】：驗證流程（事前定好，不依結果回頭改）
 *
 * 期間切分（UTC）：
 *   DEV     2025-01-01 ～ 2026-04-01：單一特徵檢定、凍結模型的訓練資料。
 *   HOLDOUT 2026-04-01 ～ 2026-10-26：最終樣本外，凍結模型只在這裡評估一次。
 *   WALK-FORWARD：2025-01-01 起滾動「訓練 180 天 → 測試 60 天」，每段都重跑同一套選模演算法，
 *                 測試段永遠在訓練段之後，串起來就是一條完全樣本外的績效。
 * 成本：每邊手續費 0.05%（Binance USDⓈ-M taker）+ 滑價 5 bps → 來回 0.20%；壓力測試加倍為 0.40%。
 *
 * 執行：node --max-old-space-size=8192 --import tsx scripts/crypto-hourly-edge/study.ts
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RESEARCH_DIR } from './data';
import { buildPanel, MIN_SOURCE_TURNOVER_USDT, type Panel } from './dataset';
import { baseDays, collectDays, hourOf, modelSide, scoreRow, selectModel, testFeatures, type Model, type Period, type TradeMode } from './selection';
import { dayBlockBootstrap, summarizeDays, wilsonInterval } from './stats';
import { kellyFraction, ruinMonteCarlo, simulatePortfolio, type OosTrade } from './portfolio';

/** 來回成本（比例）：(0.05% 手續費 + 0.05% 滑價) × 2 邊。 */
const COST = 0.002;
const STRESS_COST = 0.004;
const DEV: Period = { label: 'DEV', fromHour: hourOf('2025-01-01T00:00:00Z'), toHour: hourOf('2026-04-01T00:00:00Z') };
const HOLDOUT: Period = { label: 'HOLDOUT', fromHour: hourOf('2026-04-01T00:00:00Z'), toHour: hourOf('2026-10-26T00:00:00Z') };
const TRAIN_DAYS = 180;
const TEST_DAYS = 60;
const RISK_FRACTIONS = [0.0025, 0.005, 0.01, 0.02, 0.05, 0.1];

const round = (value: number, digits = 4) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);

/** 期間的基準：一直猜漲的命中率、平均 4h 報酬、一直做多的每筆淨報酬。 */
function periodBaseline(panel: Panel, period: Period) {
  let n = 0, up = 0, down = 0, sumFwd = 0, sumLong = 0;
  for (let r = 0; r < panel.size; r++) {
    if (panel.hour[r] < period.fromHour || panel.hour[r] >= period.toHour) continue;
    n++; sumFwd += panel.fwd[r]; sumLong += panel.tradeLong[r] - COST;
    if (panel.fwd[r] > 0) up++; else if (panel.fwd[r] < 0) down++;
  }
  return { rows: n, upRate: up / n, downRate: down / n, flatRate: (n - up - down) / n, meanFwd: sumFwd / n, alwaysLongMeanNet: sumLong / n };
}

/** 以模型評估一個期間：命中率、同向基準、超額、平均淨報酬與依日 bootstrap 區間，並回傳逐筆交易。 */
function evaluateModel(panel: Panel, model: Model, period: Period, cost: number, iterations = 1000, alignedOnly = false) {
  const base = baseDays(panel, period);
  const trades: OosTrade[] = [];
  const stats = collectDays(panel, period, base, cost, r => {
    /** alignedOnly：只看收盤剛好落在 UTC 4h 邊界的訊號，等同預測「下一根 4h K」，樣本彼此不重疊。 */
    if (alignedOnly && (panel.hour[r] + 1) % 4 !== 0) return 0;
    const side = modelSide(panel, model, r);
    if (side) trades.push({ hour: panel.hour[r], symbol: panel.symbol[r], side: side as 1 | -1,
      gross: side === 1 ? panel.tradeLong[r] : panel.tradeShort[r], stopPct: panel.stopPct[r], score: scoreRow(panel, model.weights, r) });
    return side;
  });
  const boot = stats.n ? dayBlockBootstrap(stats.days, iterations) : null;
  return { trades, summary: { period: period.label, trades: stats.n, longShare: round(stats.longShare), hitRate: round(stats.hits / stats.n),
    baseRate: round(stats.baseRate), edge: round(stats.hits / stats.n - stats.baseRate), wilson: stats.n ? wilsonInterval(stats.hits, stats.n).map(v => round(v)) : null,
    hitCi: boot?.hitCi.map(v => round(v)) ?? null, edgeCi: boot?.edgeCi.map(v => round(v)) ?? null, meanGross: round(stats.meanGross, 5),
    meanNet: round(stats.meanNet, 5), netCi: boot?.netCi.map(v => round(v, 5)) ?? null, pEdge: round(boot?.pEdge ?? NaN), pNet: round(boot?.pNet ?? NaN) }, days: stats.days };
}

/**
 * 分數分桶的「漲跌幅機率表」：以 DEV 期間分數的五分位切桶（切點只用 DEV 決定），
 * 每桶回報上漲機率、漲超過 1%／跌超過 1% 的機率、平均報酬與平均絕對報酬。
 */
function probabilityTable(panel: Panel, weights: Record<string, number>, periods: Period[]) {
  const devScores: number[] = [];
  for (let r = 0; r < panel.size; r++) if (panel.hour[r] >= DEV.fromHour && panel.hour[r] < DEV.toHour) devScores.push(scoreRow(panel, weights, r));
  devScores.sort((x, y) => x - y);
  const cuts = [0.2, 0.4, 0.6, 0.8].map(q => devScores[Math.floor(q * (devScores.length - 1))] ?? 0);
  const labels = ['Q1 最看跌', 'Q2', 'Q3', 'Q4', 'Q5 最看漲'];
  return Object.fromEntries(periods.map(period => {
    const acc = labels.map(() => ({ n: 0, up: 0, bigUp: 0, bigDown: 0, sum: 0, sumAbs: 0 }));
    for (let r = 0; r < panel.size; r++) {
      if (panel.hour[r] < period.fromHour || panel.hour[r] >= period.toHour) continue;
      const s = scoreRow(panel, weights, r), f = panel.fwd[r];
      const a = acc[cuts.filter(c => s > c).length];
      a.n++; a.sum += f; a.sumAbs += Math.abs(f);
      if (f > 0) a.up++;
      if (f > 0.01) a.bigUp++;
      if (f < -0.01) a.bigDown++;
    }
    return [period.label, labels.map((bucket, i) => ({ bucket, scoreUpper: round(cuts[i] ?? Infinity), n: acc[i].n, pUp: round(acc[i].up / acc[i].n),
      pUpOver1pct: round(acc[i].bigUp / acc[i].n), pDownOver1pct: round(acc[i].bigDown / acc[i].n),
      meanFwd: round(acc[i].sum / acc[i].n, 5), meanAbsFwd: round(acc[i].sumAbs / acc[i].n, 5) }))];
  }));
}

const isoDay = (hour: number) => new Date(hour * 3.6e6).toISOString().slice(0, 10);

/** 串接多段樣本外日區塊後的總結（含依日 bootstrap 區間）。 */
function combine(days: ReturnType<typeof evaluateModel>['days']) {
  const total = summarizeDays(days);
  const boot = total.n ? dayBlockBootstrap(days, 1000) : null;
  return { trades: total.n, hitRate: round(total.hits / total.n), baseRate: round(total.baseRate), edge: round(total.edge),
    meanNet: round(total.sumNet / total.n, 5), hitCi: boot?.hitCi.map(v => round(v)) ?? null, edgeCi: boot?.edgeCi.map(v => round(v)) ?? null,
    netCi: boot?.netCi.map(v => round(v, 5)) ?? null, pEdge: round(boot?.pEdge ?? NaN), pNet: round(boot?.pNet ?? NaN) };
}

/**
 * walk-forward：訓練 → 測試，測試段永遠在訓練段之後。
 * rolling = 固定 180 天訓練窗；anchored = 從 2025-01-01 起不斷擴大的訓練窗（敏感度分析）。
 * 測試窗不足 60 天的尾段捨棄（3 天的尾段曾產生 144 筆、命中 76% 的雜訊結果）。
 * forced：規則判定「不交易」但仍有最佳候選時，照樣下單的樣本外結果，用來檢驗「不交易」的判斷是否正確。
 */
function walkForward(panel: Panel, modes: TradeMode[], anchored: boolean) {
  const folds: unknown[] = [];
  const trades: OosTrade[] = [], forcedTrades: OosTrade[] = [];
  const days: ReturnType<typeof evaluateModel>['days'] = [], forcedDays: typeof days = [];
  const featureStability = new Map<string, { selected: number; oosEdges: number[] }>();
  for (let trainEnd = DEV.fromHour + TRAIN_DAYS * 24; trainEnd + TEST_DAYS * 24 <= HOLDOUT.toHour; trainEnd += TEST_DAYS * 24) {
    const train: Period = { label: 'TRAIN', fromHour: anchored ? DEV.fromHour : trainEnd - TRAIN_DAYS * 24, toHour: trainEnd };
    const test: Period = { label: 'TEST', fromHour: trainEnd, toHour: trainEnd + TEST_DAYS * 24 };
    const { model, tests } = selectModel(panel, train, COST, 300, modes);
    const oosTests = testFeatures(panel, test, COST, 50, modes);
    for (const t of tests) {
      const key = `${t.feature}:${t.side}:${t.mode}`;
      const entry = featureStability.get(key) ?? { selected: 0, oosEdges: [] };
      if (t.significant) entry.selected++;
      const oos = oosTests.find(o => o.feature === t.feature && o.side === t.side && o.mode === t.mode);
      if (oos) entry.oosEdges.push(oos.edge);
      featureStability.set(key, entry);
    }
    const evaluated = evaluateModel(panel, model, test, COST, 300);
    trades.push(...evaluated.trades); days.push(...evaluated.days);
    const forced = Number.isFinite(model.threshold) ? evaluateModel(panel, { ...model, tradable: true }, test, COST, 300) : null;
    if (forced) { forcedTrades.push(...forced.trades); forcedDays.push(...forced.days); }
    folds.push({ train: [isoDay(train.fromHour), isoDay(train.toHour)], test: [isoDay(test.fromHour), isoDay(test.toHour)],
      tradable: model.tradable, selected: Object.keys(model.weights), threshold: round(model.threshold), minAtrPct: model.minAtrPct,
      trainMeanNet: round(model.trainMeanNet, 5), testBaseline: periodBaseline(panel, test), oos: evaluated.summary, forcedOos: forced?.summary ?? null });
  }
  return { folds, trades, forcedTrades, combined: combine(days), forcedCombined: combine(forcedDays),
    featureStability: [...featureStability.entries()].map(([key, v]) => ({ key, foldsSelected: v.selected, folds: v.oosEdges.length,
      oosEdgePositiveFolds: v.oosEdges.filter(e => e > 0).length, meanOosEdge: round(v.oosEdges.reduce((x, e) => x + e, 0) / (v.oosEdges.length || 1)) })) };
}

/** 資金管理：同一組樣本外交易，在不同風險比例、有無風控、有無複利下的資金曲線結果。 */
function sizingStudy(trades: OosTrade[]) {
  const rows = [];
  for (const riskFraction of [0.005, 0.01, 0.02, 0.05]) {
    for (const [compound, riskControls] of [[true, true], [true, false], [false, true]] as const) {
      const result = simulatePortfolio(trades, { riskFraction, cost: COST, maxConcurrent: 5, compound, riskControls });
      rows.push({ riskFraction, compound, riskControls, finalEquity: round(result.finalEquity), trades: result.trades,
        winRate: round(result.wins / (result.trades || 1)), maxDrawdown: round(result.maxDrawdown), haltedTimes: result.haltedTimes });
    }
  }
  return rows;
}

const serializeTests = (tests: ReturnType<typeof testFeatures>) => tests.map(t => ({ feature: t.feature, side: t.side === 1 ? 'LONG' : 'SHORT', mode: t.mode, group: t.group,
  n: t.n, hitRate: round(t.hitRate), baseRate: round(t.baseRate), edge: round(t.edge), wilson: t.wilson.map(v => round(v)),
  hitCi: t.boot.hitCi.map(v => round(v)), edgeCi: t.boot.edgeCi.map(v => round(v)), pEdge: round(t.boot.pEdge), significant: t.significant,
  meanGross: round(t.meanGross, 5), meanNet: round(t.meanNet, 5), netCi: t.boot.netCi.map(v => round(v, 5)) }));

async function main() {
  const started = Date.now();
  const panel = await buildPanel();
  console.log(`面板 ${panel.size} 列、${panel.symbols.length} 檔，耗時 ${Math.round((Date.now() - started) / 1000)}s`);
  const baselines = { DEV: periodBaseline(panel, DEV), HOLDOUT: periodBaseline(panel, HOLDOUT) };
  const devTests = testFeatures(panel, DEV, COST, 1000);
  const holdoutTests = testFeatures(panel, HOLDOUT, COST, 1000);
  console.log('單一特徵檢定完成');
  /** v1：事前定好的「只跟隨」；v2：看過 DEV 後加入「反向」的事後假設。兩版、兩種 walk-forward 都完整回報。 */
  const versions = {} as Record<string, unknown>;
  let sizingOos: OosTrade[] = [], sizingHoldout: OosTrade[] = [];
  for (const [version, modes] of [['v1_follow_only', ['FOLLOW']], ['v2_follow_or_fade', ['FOLLOW', 'FADE']]] as [string, TradeMode[]][]) {
    const rolling = walkForward(panel, modes, false);
    const anchored = walkForward(panel, modes, true);
    console.log(version, 'rolling', rolling.combined, 'forced', rolling.forcedCombined, 'anchored', anchored.combined, 'forced', anchored.forcedCombined);
    const frozen = selectModel(panel, DEV, COST, 1000, modes).model;
    const forcedModel = { ...frozen, tradable: Number.isFinite(frozen.threshold) };
    const holdout = evaluateModel(panel, frozen, HOLDOUT, COST);
    const forcedHoldout = evaluateModel(panel, forcedModel, HOLDOUT, COST);
    console.log(version, '凍結模型', frozen, 'holdout', holdout.summary, 'forced', forcedHoldout.summary);
    const strip = (wf: ReturnType<typeof walkForward>) => ({ folds: wf.folds, combined: wf.combined, forcedCombined: wf.forcedCombined, featureStability: wf.featureStability });
    versions[version] = {
      walkForwardRolling: strip(rolling), walkForwardAnchored: strip(anchored),
      frozenModel: { ...frozen, threshold: round(frozen.threshold) },
      frozenDev: evaluateModel(panel, forcedModel, DEV, COST).summary,
      frozenHoldout: holdout.summary,
      forcedHoldout: forcedHoldout.summary,
      forcedHoldoutStress: evaluateModel(panel, forcedModel, HOLDOUT, STRESS_COST).summary,
      forcedHoldoutAligned4h: evaluateModel(panel, forcedModel, { ...HOLDOUT, label: 'HOLDOUT_ALIGNED_4H' }, COST, 1000, true).summary,
      probabilityTable: probabilityTable(panel, frozen.weights, [DEV, HOLDOUT]),
    };
    /** 資金管理研究用 v2 的「強制交易」樣本外紀錄：這是「即使驗證沒過仍硬做」時真實會遇到的交易分布。 */
    if (modes.includes('FADE')) { sizingOos = rolling.forcedTrades; sizingHoldout = forcedHoldout.trades; }
  }
  const results = {
    generatedAt: new Date().toISOString(), cost: COST, stressCost: STRESS_COST, minSourceTurnoverUsdt: MIN_SOURCE_TURNOVER_USDT,
    symbols: panel.symbols.length, sources: panel.sources.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {} as Record<string, number>),
    rows: panel.size, periods: { DEV, HOLDOUT }, baselines,
    featureTests: { DEV: serializeTests(devTests), HOLDOUT: serializeTests(holdoutTests) },
    versions,
    sizing: { walkForwardForcedOos: sizingStudy(sizingOos), forcedHoldout: sizingStudy(sizingHoldout) },
    kelly: { walkForwardForcedOos: kellyFraction(sizingOos, COST), forcedHoldout: kellyFraction(sizingHoldout, COST) },
    ruin: { walkForwardForcedOos: ruinMonteCarlo(sizingOos, COST, RISK_FRACTIONS), forcedHoldout: ruinMonteCarlo(sizingHoldout, COST, RISK_FRACTIONS),
      /** 假設情境：同一組交易每筆 R 再加 +0.1R（真實結果約 -0.06R），只用來說明翻倉數學，不代表策略實績。 */
      hypotheticalPlus01R: ruinMonteCarlo(sizingOos, COST, RISK_FRACTIONS, 2000, 7, 0.1) },
  };
  await writeFile(join(RESEARCH_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`完成，總耗時 ${Math.round((Date.now() - started) / 1000)}s → ${join(RESEARCH_DIR, 'results.json')}`);
}

await main();
