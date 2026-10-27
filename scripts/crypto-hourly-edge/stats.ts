/** @file 1h→4h 研究的統計工具：Wilson 區間、依日區塊 bootstrap、BH 多重檢定；純計算無副作用。 */
/**
 * 【詳細繁體中文註解】：為什麼不能直接用二項分布信賴區間
 *
 * 1. 每根 1h 都預測「未來 4 小時」，相鄰樣本的預測窗口重疊 3 小時，彼此高度相關。
 * 2. 同一小時內幾十檔幣常一起漲跌（跟 BTC 連動），橫斷面也不獨立。
 * 直接把幾十萬個樣本當獨立會讓區間窄到不真實。因此主要區間用「以 UTC 日為區塊」重抽：
 * 同一天所有幣、所有小時一起抽出或一起不抽，保留日內與跨幣相關性。
 * Wilson 區間只作為「天真區間」對照，讓報告能顯示兩者差距。
 */

/** 可重現的亂數產生器（mulberry32），固定種子讓 bootstrap 結果每次重跑都相同。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wilson 95% 區間（假設樣本獨立，僅供對照）。 */
export function wilsonInterval(hits: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [NaN, NaN];
  const p = hits / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [center - half, center + half];
}

/**
 * 單日彙總：某個檢定在某一天出手的樣本數、多單數、命中數、淨報酬總和，以及「當天全部樣本」的漲跌數。
 * 基準不用「當天」比例：反轉類訊號常出現在暴跌日，當天比例已包含訊號前那段下跌，會把基準壓低、
 * 讓超額被高估。基準一律用「整個（重抽後）期間」的上漲／下跌比例，即「一直猜漲／一直猜跌」。
 */
export interface DayBucket { n: number; longN: number; hits: number; sumNet: number; allN: number; allUp: number; allDown: number }

/** 期間基準下的「預期命中數」：多單比對期間上漲比例、空單比對期間下跌比例。 */
const expectedBaseHits = (n: number, longN: number, allN: number, allUp: number, allDown: number) =>
  allN ? (longN * allUp + (n - longN) * allDown) / allN : NaN;

export interface BootstrapResult {
  /** 命中率超額（命中率 − 同期基準比例）的 95% 區間，單位為比例（0.01 = 1 個百分點）。 */
  edgeCi: [number, number];
  /** 命中率本身的 95% 區間。 */
  hitCi: [number, number];
  /** 每筆平均淨報酬（已扣成本）的 95% 區間，單位為比例。 */
  netCi: [number, number];
  /** 單尾 p 值：H0 為「命中率超額 ≤ 0」。 */
  pEdge: number;
  /** 單尾 p 值：H0 為「平均淨報酬 ≤ 0」。 */
  pNet: number;
}

/** 整段（未重抽）彙總：命中率、期間基準與超額。 */
export function summarizeDays(days: DayBucket[]) {
  let n = 0, longN = 0, hits = 0, sumNet = 0, allN = 0, allUp = 0, allDown = 0;
  for (const d of days) { n += d.n; longN += d.longN; hits += d.hits; sumNet += d.sumNet; allN += d.allN; allUp += d.allUp; allDown += d.allDown; }
  const baseRate = expectedBaseHits(n, longN, allN, allUp, allDown) / n;
  return { n, longN, hits, sumNet, baseRate, edge: hits / n - baseRate };
}

const percentile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

/**
 * 依日區塊 bootstrap：從 days 中「有放回」抽出同樣天數，重算命中率超額與平均淨報酬。
 * p 值採重抽分布平移到虛無假設（以觀察值為中心）後的單尾比例，避免偏態下 p 值失真。
 */
export function dayBlockBootstrap(days: DayBucket[], iterations = 1000, seed = 20261026): BootstrapResult {
  const random = seededRandom(seed);
  const observed = summarizeDays(days);
  const observedEdge = observed.edge;
  const observedNet = observed.sumNet / observed.n;
  const edges: number[] = [], hitRates: number[] = [], nets: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let n = 0, longN = 0, hits = 0, sumNet = 0, allN = 0, allUp = 0, allDown = 0;
    for (let k = 0; k < days.length; k++) {
      const d = days[Math.floor(random() * days.length)];
      n += d.n; longN += d.longN; hits += d.hits; sumNet += d.sumNet; allN += d.allN; allUp += d.allUp; allDown += d.allDown;
    }
    if (n === 0 || allN === 0) continue;
    edges.push(hits / n - expectedBaseHits(n, longN, allN, allUp, allDown) / n); hitRates.push(hits / n); nets.push(sumNet / n);
  }
  edges.sort((a, b) => a - b); hitRates.sort((a, b) => a - b); nets.sort((a, b) => a - b);
  const pOneSided = (draws: number[], observed: number) => {
    if (!draws.length) return 1;
    let extreme = 0;
    for (const value of draws) if (value - observed >= observed) extreme++;
    return (extreme + 1) / (draws.length + 1);
  };
  return {
    edgeCi: [percentile(edges, 0.025), percentile(edges, 0.975)],
    hitCi: [percentile(hitRates, 0.025), percentile(hitRates, 0.975)],
    netCi: [percentile(nets, 0.025), percentile(nets, 0.975)],
    pEdge: pOneSided(edges, observedEdge),
    pNet: pOneSided(nets, observedNet),
  };
}

/** Benjamini-Hochberg：回傳每個 p 值在 FDR q 下是否顯著（同時檢定數十個特徵時控制假發現比例）。 */
export function benjaminiHochberg(pValues: number[], q = 0.05): boolean[] {
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let cutoff = -1;
  order.forEach(({ p }, rank) => { if (p <= ((rank + 1) / order.length) * q) cutoff = rank; });
  const significant = new Array(pValues.length).fill(false);
  for (let rank = 0; rank <= cutoff; rank++) significant[order[rank].i] = true;
  return significant;
}

/** 權益序列的最大回撤（比例，0.2 = -20%）。 */
export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity, worst = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    worst = Math.max(worst, (peak - value) / peak);
  }
  return worst;
}
