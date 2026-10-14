/** @file 可重跑的固定籃子合約研究；開發選模、驗證淘汰、鎖定後才打開保留期，不修改帳戶。 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { runBacktestEngine, type BacktestTradeRecord, type EngineConfig } from '../app/services/backtest/engine';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import { getStrategy } from '../app/services/strategy/registry';
import { HOUR_MS } from '../app/services/strategy/futuresRegime';
import { validateResearchData, RESEARCH_SYMBOLS, type ResearchData } from './futures-research-data';
import { researchCandidates, futuresRsiPullbackResearch, type ResearchCandidate } from './futures-research-candidates';

/** Wilson 95% 區間是描述性二項近似；跨幣同時交易會相關，不能當作獨立或未來勝率保證。 */
export function summarize(trades: BacktestTradeRecord[]) {
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const profit = wins.reduce((sum, t) => sum + t.pnl, 0), loss = -losses.reduce((sum, t) => sum + t.pnl, 0);
  const n = trades.length, proportion = n ? wins.length / n : 0, z = 1.96;
  const center = n ? (proportion + z * z / (2 * n)) / (1 + z * z / n) : 0;
  const radius = n ? z * Math.sqrt(proportion * (1 - proportion) / n + z * z / (4 * n * n)) / (1 + z * z / n) : 0;
  return { trades: n, wins: wins.length, winRate: n ? proportion * 100 : null,
    winRate95: n ? [100 * (center - radius), 100 * (center + radius)] : null,
    netPnl: profit - loss, profitFactor: loss ? profit / loss : profit ? null : 0,
    avgWin: wins.length ? profit / wins.length : 0, avgLoss: losses.length ? loss / losses.length : 0,
    fees: trades.reduce((sum, t) => sum + t.fee, 0), funding: trades.reduce((sum, t) => sum + (t.fundingPnl ?? 0), 0) };
}

function simulate(data: ResearchData, candidate: ResearchCandidate, from: number, to: number, stress = false) {
  const candles = data.candles.filter(c => c.openTime < to), m = data.metadata;
  /** 本金每商品 1000 USDT；合併統計為五個獨立子帳戶，不冒充單帳戶組合報酬。 */
  const config: EngineConfig = { initialCapital: 1000, maxRiskPerTradePct: 0.25, maxPositionSizePct: 5,
    defaultStopLossPct: 5, precision: m.precision, fillMode: 'nextOpen',
    cost: { feeRate: stress ? 0.0012 : 0.0006, slippageBps: stress ? 10 : 5 },
    futures: { leverage: 3, direction: 'BOTH', funding: data.funding, marks: data.marks,
      tiers: m.tiers, tiersObservedAt: m.observedAt, fundingComplete: true, minQuantity: m.minQuantity,
      minNotional: m.minNotional, quantityStep: m.quantityStep, minLeverage: m.minLeverage } };
  const result = runBacktestEngine(candles, candidate.strategy, candidate.params, config, from, new IndicatorCache(candles));
  let peak = config.initialCapital, maxDrawdown = 0;
  for (const point of result.equityCurve) { peak = Math.max(peak, point.equity); maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak * 100); }
  return { result, stats: { ...summarize(result.trades), returnPct: result.trades.reduce((sum, t) => sum + t.pnl, 0) / 10, maxDrawdown } };
}
export function evaluate(data: ResearchData[], candidate: ResearchCandidate, from: number, to: number, stress = false) {
  const results = data.map(d => ({ symbol: d.symbol, ...simulate(d, candidate, from, to, stress) }));
  return { key: candidate.key, params: candidate.params, from, to, pooled: summarize(results.flatMap(r => r.result.trades)),
    perSymbol: results.map(r => ({ symbol: r.symbol, ...r.stats })),
    diagnostics: results.map(r => ({ symbol: r.symbol, ...r.result.entryDiagnostics })),
    tradeRecords: results.flatMap(r => r.result.trades.map(t => ({ symbol: r.symbol, ...t }))) };
}

async function run(directory: string) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.symbols, RESEARCH_SYMBOLS);
  const data: ResearchData[] = await Promise.all(manifest.symbols.map((symbol: string) => readFile(join(directory, `${symbol}.json`), 'utf8').then(JSON.parse)));
  data.forEach((d, i) => { validateResearchData(d); assert.equal(d.symbol, manifest.symbols[i]); assert.equal(d.start, manifest.start); assert.equal(d.end, manifest.end); });
  const start = manifest.start, end = manifest.end, bars = (end - start) / HOUR_MS;
  const developmentEnd = start + Math.floor(bars * 0.6) * HOUR_MS, validationEnd = start + Math.floor(bars * 0.8) * HOUR_MS;
  const candidates = researchCandidates();
  /** manifest 保存完整搜尋集合、排名準則與成本；不隱藏試過多少參數組合。 */
  await writeFile(join(directory, 'search-plan.json'), JSON.stringify({ ...manifest, developmentEnd, validationEnd,
    candidates: candidates.map(c => ({ key: c.key, params: c.params })), shortlistSize: 5,
    selection: '開發成交至少30且PF>1、依勝率再PF排名；前五進驗證。驗證至少30且PF>1，依勝率再PF選一；無合格者仍診斷第一名，不宣稱達標。',
    acceptance: '保留期勝率至少70%、至少100筆、PF>1、雙倍成本仍淨獲利；每幣至少10筆。' }, null, 2));
  const development = candidates.map(c => {
    const result = evaluate(data, c, start, developmentEnd);
    const { tradeRecords, diagnostics, ...summary } = result;
    return summary;
  });
  const rank = (a: typeof development[number], b: typeof development[number]) => (b.pooled.winRate ?? 0) - (a.pooled.winRate ?? 0)
    || (b.pooled.profitFactor ?? 0) - (a.pooled.profitFactor ?? 0);
  development.sort(rank);
  const eligible = development.filter(r => r.pooled.trades >= 30 && (r.pooled.profitFactor ?? 0) > 1);
  const shortlist = (eligible.length ? eligible : development).slice(0, 5);
  const validation = shortlist.map(r => evaluate(data, candidates.find(c => c.key === r.key)!, developmentEnd, validationEnd));
  validation.sort(rank);
  const validated = validation.filter(r => r.pooled.trades >= 30 && (r.pooled.profitFactor ?? 0) > 1);
  const selected = (validated.length ? validated : validation)[0];
  const candidate = candidates.find(c => c.key === selected.key)!;
  /** 先落盤鎖定候選，之後只評估這一個保留期；不得看其餘候選的保留期再換人。 */
  await writeFile(join(directory, 'locked-selection.json'), JSON.stringify({ key: selected.key, params: selected.params,
    development: development.find(r => r.key === selected.key), validation: selected.pooled, lockedAt: new Date().toISOString() }, null, 2));
  const holdout = evaluate(data, candidate, validationEnd, end), stress = evaluate(data, candidate, validationEnd, end, true);
  const acceptance = { winRate: (holdout.pooled.winRate ?? 0) >= 70, sample: holdout.pooled.trades >= manifest.minimumHoldoutTrades,
    profit: holdout.pooled.netPnl > 0 && (holdout.pooled.profitFactor ?? 0) > 1,
    stressProfit: stress.pooled.netPnl > 0, multiSymbol: holdout.perSymbol.every(r => r.trades >= 10) };
  const baseline = ['futures_trend_retest', 'futures_range_reclaim', 'big_fish'].map(id => {
    const module = getStrategy(id)!;
    return evaluate(data, { key: id, strategy: module, params: module.defaultParams }, validationEnd, end);
  });
  const report = { manifest, searchCount: candidates.length, development, validation, selected: candidate.key,
    accepted: Object.values(acceptance).every(Boolean), acceptance, holdout, stress, baseline,
    limitations: ['多次選模偏誤仍存在；保留期僅評估鎖定的一個候選', '五個商品交易相關，Wilson 區間僅描述性近似',
      '目前級距快照與小時標記價壓力估算；沒有歷史級距、抵扣額、精確 tick 或 ADL', '沒有送出實盤或 Demo 訂單', '固定籃子具有存活者偏誤，不能推廣到所有幣'] };
  await writeFile(join(directory, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ searchCount: candidates.length, selected: candidate.key, acceptance, accepted: report.accepted,
    development: development.find(r => r.key === selected.key)?.pooled, validation: selected.pooled,
    holdout: holdout.pooled, perSymbol: holdout.perSymbol, stress: stress.pooled,
    baseline: baseline.map(r => ({ key: r.key, pooled: r.pooled })) }, null, 2));
}

async function transfer(directory: string) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.symbols, ['BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT']);
  const candidate = researchCandidates().find(c => c.key === manifest.lockedKey);
  if (!candidate || JSON.stringify(candidate.params) !== JSON.stringify(manifest.params)) throw new Error('跨幣候選不符合已鎖定參數');
  const data: ResearchData[] = await Promise.all(manifest.symbols.map((symbol: string) => readFile(join(directory, `${symbol}.json`), 'utf8').then(JSON.parse)));
  data.forEach((d, i) => { validateResearchData(d); assert.equal(d.symbol, manifest.symbols[i]); assert.equal(d.start, manifest.start); assert.equal(d.end, manifest.end); });
  const holdoutStart = manifest.start + Math.floor((manifest.end - manifest.start) / HOUR_MS * 0.8) * HOUR_MS;
  const full = evaluate(data, candidate, manifest.start, manifest.end), stress = evaluate(data, candidate, manifest.start, manifest.end, true);
  const holdout = evaluate(data, candidate, holdoutStart, manifest.end), holdoutStress = evaluate(data, candidate, holdoutStart, manifest.end, true);
  const report = { manifest, full, stress, holdout, holdoutStress,
    /** 同時間跨幣報酬高度相關；不得把這項檢查稱作全新時間樣本或抹掉原籃子失敗。 */
    limitations: ['固定原籃子選出的一組參數，沒有在新幣重調', '跨幣種驗證不等於跨時間穩健，市場共通因素仍相關', '原籃子保留期失敗必須一起揭露'] };
  await writeFile(join(directory, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ full: full.pooled, perSymbol: full.perSymbol, stress: stress.pooled,
    holdout: holdout.pooled, holdoutStress: holdoutStress.pooled }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--self-check') {
    const trades = Array.from({ length: 100 }, (_, i) => ({ pnl: i < 70 ? 1 : -1, fee: 0.1, fundingPnl: 0 } as BacktestTradeRecord));
    const s = summarize(trades);
    assert.equal(s.winRate, 70); assert.equal(s.netPnl, 40); assert.ok(s.winRate95![0] < 70);
    assert.equal(summarize([]).winRate, null); assert.equal(researchCandidates().length, 48);
    /** 指定實際行情時，以截斷後的歷史重算每個進場訊號；截斷不一致代表可能讀到未來。 */
    if (process.argv[3]) {
      const data: ResearchData = JSON.parse(await readFile(process.argv[3], 'utf8'));
      validateResearchData(data);
      const s = futuresRsiPullbackResearch, indicators = new IndicatorCache(data.candles);
      let checked = 0;
      for (let index = s.warmupBars; index < data.candles.length; index++) {
        const context = { candles: data.candles, index, indicators, position: null, params: s.defaultParams };
        const action = s.evaluate(context);
        if (action.type !== 'ENTRY') continue;
        const prefix = data.candles.slice(0, index + 1);
        assert.deepEqual(action, s.evaluate({ ...context, candles: prefix, indicators: new IndicatorCache(prefix) })); checked++;
      }
      assert.ok(checked > 0); console.log('真實行情訊號以前綴歷史重算一致', checked);
    }
    console.log('研究統計自我檢查通過');
  } else if (process.argv[2] === '--transfer') {
    if (!process.argv[3]) throw new Error('請指定包含已鎖定候選 manifest 的跨幣資料夾');
    await transfer(process.argv[3]);
  } else {
    if (!process.argv[2]) throw new Error('請指定包含 manifest 與商品 JSON 的資料夾');
    await run(process.argv[2]);
  }
}
