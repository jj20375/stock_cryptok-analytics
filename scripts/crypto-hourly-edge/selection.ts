/** @file 單一特徵檢定、組合權重選擇與樣本外評分；純計算，輸入研究面板，輸出統計數字。 */
/**
 * 【詳細繁體中文註解】：特徵檢定與組合選擇（walk-forward 每個訓練窗都跑同一套演算法）
 *
 * 單一特徵檢定（feature × 方向）：
 *   命中 = 該方向猜對 4 小時漲跌（多：fwd>0；空：fwd<0）。
 *   基準 = 同期間「所有」樣本在同方向的比例（多方基準 = 一直猜漲的命中率；不用訊號當日比例，見 stats.ts）。
 *   超額 edge = 命中率 − 基準；淨報酬 = 模擬交易報酬 − 來回成本。
 *
 * 組合選擇演算法 selectModel(train)：
 *   1. 32 個檢定全部做依日 bootstrap，p 值以 BH(q=0.05) 校正多重檢定。
 *   2. 只有「樣本數 ≥ 300、edge > 0 且校正後顯著」的檢定入選，權重 = 訓練期 edge。
 *   3. 分數 = Σ 入選檢定的權重 × 方向；在訓練期網格搜尋門檻與 ATR 濾網，
 *      以訓練期「每筆平均淨報酬」最大者為準；若最佳值仍 ≤ 0，模型結論為「不交易」。
 *   網格只有 4×4 = 16 組，刻意保持小，降低過度擬合。
 */
import { FEATURE_DEFINITIONS, type FeatureId } from '../../app/services/strategy/hourlyEdgeFeatures';
import type { Panel } from './dataset';
import { benjaminiHochberg, dayBlockBootstrap, summarizeDays, wilsonInterval, type BootstrapResult, type DayBucket } from './stats';

export interface Period { label: string; fromHour: number; toHour: number }
export const hourOf = (iso: string) => Date.parse(iso) / 3_600_000;

/** FOLLOW = 依特徵方向下單；FADE = 反向下單（v2 事後假設：DEV 顯示 1h 尺度以短期反轉為主）。 */
export type TradeMode = 'FOLLOW' | 'FADE';

export interface TestStats {
  feature: FeatureId; side: 1 | -1; mode: TradeMode; group: string; n: number; hitRate: number; baseRate: number; edge: number;
  wilson: [number, number]; meanGross: number; meanNet: number; boot: BootstrapResult; significant?: boolean;
}

/** 期間內每日基準（全部樣本的上漲／下跌數），單一特徵與組合模型共用。 */
interface BaseDays { offset: number; n: Int32Array; up: Int32Array; down: Int32Array }

export function baseDays(panel: Panel, period: Period): BaseDays {
  const offset = Math.floor(period.fromHour / 24);
  const length = Math.ceil(period.toHour / 24) - offset + 1;
  const n = new Int32Array(length), up = new Int32Array(length), down = new Int32Array(length);
  for (let r = 0; r < panel.size; r++) {
    const h = panel.hour[r];
    if (h < period.fromHour || h >= period.toHour) continue;
    const d = Math.floor(h / 24) - offset;
    n[d]++;
    if (panel.fwd[r] > 0) up[d]++; else if (panel.fwd[r] < 0) down[d]++;
  }
  return { offset, n, up, down };
}

/** 依列選擇器彙總成日區塊；select 回傳 0 代表不交易，±1 代表方向。 */
export function collectDays(panel: Panel, period: Period, base: BaseDays, cost: number, select: (r: number) => number) {
  const length = base.n.length;
  const n = new Int32Array(length), hits = new Int32Array(length), sumNet = new Float64Array(length), longN = new Int32Array(length);
  let total = 0, totalHits = 0, gross = 0, net = 0;
  for (let r = 0; r < panel.size; r++) {
    const h = panel.hour[r];
    if (h < period.fromHour || h >= period.toHour) continue;
    const side = select(r);
    if (!side) continue;
    const d = Math.floor(h / 24) - base.offset;
    const hit = side * panel.fwd[r] > 0 ? 1 : 0;
    const trade = side === 1 ? panel.tradeLong[r] : panel.tradeShort[r];
    n[d]++; hits[d] += hit; sumNet[d] += trade - cost; if (side === 1) longN[d]++;
    total++; totalHits += hit; gross += trade; net += trade - cost;
  }
  /** 沒出手的日子也要保留（n=0），因為期間基準要用「所有日子」的漲跌比例，bootstrap 重抽時才一致。 */
  const days: DayBucket[] = [];
  for (let d = 0; d < length; d++) {
    if (base.n[d]) days.push({ n: n[d], longN: longN[d], hits: hits[d], sumNet: sumNet[d], allN: base.n[d], allUp: base.up[d], allDown: base.down[d] });
  }
  const summary = summarizeDays(days);
  return { days, n: total, hits: totalHits, baseRate: total ? summary.baseRate : NaN, meanGross: total ? gross / total : NaN,
    meanNet: total ? net / total : NaN, longShare: total ? summary.longN / total : NaN };
}

/**
 * 單一特徵檢定：16 特徵 × 觸發方向（多／空）× 模式（FOLLOW／FADE）= 最多 64 個檢定；
 * BH 校正一次涵蓋全部檢定。side 是特徵觸發方向，實際下單方向 = FOLLOW ? side : -side。
 */
export function testFeatures(panel: Panel, period: Period, cost: number, iterations: number, modes: TradeMode[] = ['FOLLOW', 'FADE']): TestStats[] {
  const base = baseDays(panel, period);
  const results: TestStats[] = [];
  for (const definition of FEATURE_DEFINITIONS) {
    const column = panel.features[definition.id];
    for (const side of [1, -1] as const) for (const mode of modes) {
      const tradeSide = mode === 'FOLLOW' ? side : -side;
      const stats = collectDays(panel, period, base, cost, r => (column[r] === side ? tradeSide : 0));
      if (stats.n === 0) continue;
      results.push({ feature: definition.id, side, mode, group: definition.group, n: stats.n, hitRate: stats.hits / stats.n,
        baseRate: stats.baseRate, edge: stats.hits / stats.n - stats.baseRate, wilson: wilsonInterval(stats.hits, stats.n),
        meanGross: stats.meanGross, meanNet: stats.meanNet, boot: dayBlockBootstrap(stats.days, iterations) });
    }
  }
  /** 玄學特徵與技術特徵分成兩個檢定家族各自做 BH，玄學不會因技術特徵很顯著而被放寬門檻，反之亦然。 */
  for (const esoteric of [false, true]) {
    const family = results.filter(r => (r.group === 'ESOTERIC') === esoteric);
    const flags = benjaminiHochberg(family.map(r => r.boot.pEdge));
    family.forEach((r, i) => { r.significant = flags[i] && r.edge > 0 && r.n >= 300; });
  }
  return results;
}

export interface Model {
  /** 入選檢定的權重：key 為 `${feature}:${觸發方向}:${下單方向}`，值為訓練期 edge（比例）。 */
  weights: Record<string, number>;
  threshold: number;
  minAtrPct: number;
  trainMeanNet: number;
  trainTrades: number;
  /** 訓練期最佳平均淨報酬 ≤ 0 時為 false：模型結論是「不交易」。 */
  tradable: boolean;
}

/** 權重字串鍵預先解析成欄位參照，避免逐列切字串（面板有數百萬列）。 */
const parsedWeights = new WeakMap<Record<string, number>, { column: FeatureId; fire: number; trade: number; weight: number }[]>();

/** 列分數：Σ 入選檢定權重 × 方向。 */
export function scoreRow(panel: Panel, weights: Record<string, number>, r: number): number {
  let parsed = parsedWeights.get(weights);
  if (!parsed) {
    parsed = Object.entries(weights).map(([key, weight]) => {
      const [column, fire, trade] = key.split(':');
      return { column: column as FeatureId, fire: Number(fire), trade: Number(trade), weight };
    });
    parsedWeights.set(weights, parsed);
  }
  let score = 0;
  for (const { column, fire, trade, weight } of parsed) if (panel.features[column][r] === fire) score += trade * weight;
  return score;
}

/** 依模型產生列方向；不符合門檻、ATR 濾網或模型不可交易時回 0。 */
export function modelSide(panel: Panel, model: Model, r: number): number {
  if (!model.tradable || panel.atrPct[r] < model.minAtrPct) return 0;
  const score = scoreRow(panel, model.weights, r);
  return Math.abs(score) >= model.threshold && score !== 0 ? Math.sign(score) : 0;
}

/** ATR14 ÷ 價格下限：成本固定 0.2%，波動太小時即使方向猜對也賺不到成本。 */
const ATR_FILTER_GRID = [0, 0.005, 0.01, 0.02];
const THRESHOLD_QUANTILES = [0, 0.5, 0.75, 0.9];
const MIN_TRAIN_TRADES = 200;

/**
 * 選模演算法。modes = ['FOLLOW'] 為事前定好的 v1；['FOLLOW','FADE'] 為看過 DEV 結果後加入反向假設的 v2。
 * excludeGroups 可把特定類別排除在組合之外；預設不排除，玄學特徵與其他特徵一樣「通過自己家族的 BH 校正才納入」。
 */
export function selectModel(panel: Panel, train: Period, cost: number, iterations: number, modes: TradeMode[] = ['FOLLOW', 'FADE'],
  excludeGroups: string[] = []): { model: Model; tests: TestStats[] } {
  const tests = testFeatures(panel, train, cost, iterations, modes);
  const weights: Record<string, number> = {};
  for (const t of tests) {
    if (t.significant && !excludeGroups.includes(t.group)) weights[`${t.feature}:${t.side}:${t.mode === 'FOLLOW' ? t.side : -t.side}`] = t.edge;
  }
  const empty: Model = { weights, threshold: Infinity, minAtrPct: 0, trainMeanNet: NaN, trainTrades: 0, tradable: false };
  if (!Object.keys(weights).length) return { model: empty, tests };
  const scores: number[] = [];
  for (let r = 0; r < panel.size; r++) {
    if (panel.hour[r] < train.fromHour || panel.hour[r] >= train.toHour) continue;
    const s = Math.abs(scoreRow(panel, weights, r));
    if (s > 0) scores.push(s);
  }
  scores.sort((a, b) => a - b);
  const base = baseDays(panel, train);
  let best = empty;
  for (const q of THRESHOLD_QUANTILES) {
    const threshold = scores[Math.floor(q * (scores.length - 1))] ?? Infinity;
    for (const minAtrPct of ATR_FILTER_GRID) {
      const candidate: Model = { weights, threshold, minAtrPct, trainMeanNet: NaN, trainTrades: 0, tradable: true };
      const stats = collectDays(panel, train, base, cost, r => modelSide(panel, candidate, r));
      if (stats.n < MIN_TRAIN_TRADES) continue;
      if (Number.isNaN(best.trainMeanNet) || stats.meanNet > best.trainMeanNet) best = { ...candidate, trainMeanNet: stats.meanNet, trainTrades: stats.n };
    }
  }
  if (!(best.trainMeanNet > 0)) return { model: { ...best, tradable: false }, tests };
  return { model: best, tests };
}
