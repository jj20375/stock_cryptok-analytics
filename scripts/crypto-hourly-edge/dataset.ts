/** @file 將快取 K 線轉成「每檔 × 每根 1h」的特徵／標籤面板；純計算，只讀 research/ 快取。 */
/**
 * 【詳細繁體中文註解】：研究面板
 *
 * 每一列代表「某檔幣在某根已收盤 1h K 的收盤時刻」：
 *   - 特徵：hourlyEdgeFeatures.featureDirection（與策略模組同一份程式碼）
 *   - 預測標籤 fwd：close[i+4] / close[i] − 1（收盤後 4 小時的漲跌，方向與幅度）
 *   - 交易模擬 tradeLong／tradeShort：與回測引擎 nextOpen 一致——open[i+1] 進場、open[i+5] 出場，
 *     期間以 2×ATR14（訊號根鎖定）盤中停損；回傳「未扣成本」報酬，成本在分析時另扣，方便做成本壓力測試。
 *
 * 逐時點流動性門檻（避免今天的熱門幣在過去冷門時期被計入）：
 *   來源交易所近 24h 估計成交額 ≥ MIN_SOURCE_TURNOVER_USDT，且近 24 根至少 22 根有成交量。
 *   門檻只用 i 以前的資料，不偷看未來。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IndicatorCache } from '../../app/services/strategy/indicatorCache';
import { FEATURE_IDS, FEATURE_WARMUP_BARS, FORECAST_BARS, HOUR_MS, featureDirection, trailingQuoteTurnover, type FeatureId }
  from '../../app/services/strategy/hourlyEdgeFeatures';
import { loadCachedSeries, RESEARCH_DIR, type Universe } from './data';

/** 來源交易所 24h 估計成交額門檻（USDT）。來源量約為 Binance 的 3%，25 萬約對應 Binance 800 萬等級。 */
export const MIN_SOURCE_TURNOVER_USDT = 250_000;
/** 近 24 根中至少要有幾根成交量 > 0，排除價格停滯的冷門時段。 */
const MIN_ACTIVE_BARS = 22;
/** 研究用停損倍數：2 × ATR14（訊號根數值），與策略模組預設 stopAtr 相同。 */
export const STOP_ATR_MULTIPLE = 2;

export interface Panel {
  symbols: string[];
  sources: string[];
  /** 列數 */
  size: number;
  /** 訊號 K 的 openTime ÷ 1h（UTC 小時序號）；收盤時刻 = hour + 1。 */
  hour: Int32Array;
  symbol: Int16Array;
  /** 4 小時收盤對收盤報酬（比例）。 */
  fwd: Float32Array;
  /** ATR14 ÷ 收盤（比例），衡量當下波動。 */
  atrPct: Float32Array;
  /** 多單／空單模擬報酬（比例，未扣成本，含 2ATR 停損）。 */
  tradeLong: Float32Array;
  tradeShort: Float32Array;
  /** 停損距離 ÷ 進場價（比例），換算 R 倍數用。 */
  stopPct: Float32Array;
  features: Record<FeatureId, Int8Array>;
}

/** 模擬單筆交易：open[i+1] 進場，持有 4 根，期間觸及停損即以停損價（跳空時用開盤價）出場。 */
function simulateTrade(candles: { open: number; high: number; low: number }[], i: number, stopDistance: number, side: 1 | -1): number {
  const entry = candles[i + 1].open;
  const stop = entry - side * stopDistance;
  for (let j = i + 1; j <= i + FORECAST_BARS; j++) {
    const bar = candles[j];
    if (side === 1 && bar.low <= stop) return Math.min(bar.open, stop) / entry - 1;
    if (side === -1 && bar.high >= stop) return 1 - Math.max(bar.open, stop) / entry;
  }
  const exit = candles[i + FORECAST_BARS + 1].open;
  return side === 1 ? exit / entry - 1 : 1 - exit / entry;
}

export async function buildPanel(): Promise<Panel> {
  const universe = JSON.parse(await readFile(join(RESEARCH_DIR, 'universe.json'), 'utf8')) as Universe;
  const columns = { hour: [] as number[], symbol: [] as number[], fwd: [] as number[], atrPct: [] as number[],
    tradeLong: [] as number[], tradeShort: [] as number[], stopPct: [] as number[] };
  const featureColumns = Object.fromEntries(FEATURE_IDS.map(id => [id, [] as number[]])) as Record<FeatureId, number[]>;
  const symbols: string[] = [], sources: string[] = [];
  for (const entry of universe.entries) {
    const series = await loadCachedSeries(entry.symbol);
    if (!series || series.candles.length < FEATURE_WARMUP_BARS + 500) continue;
    const symbolIndex = symbols.length;
    symbols.push(entry.symbol); sources.push(series.source);
    const candles = series.candles;
    const indicators = new IndicatorCache(candles);
    const atr = indicators.atr(14);
    for (let i = FEATURE_WARMUP_BARS; i + FORECAST_BARS + 1 < candles.length; i++) {
      /** 預測窗口 i..i+5 必須連續（無停機缺口），否則 4 小時報酬實際跨越更長時間。 */
      if (candles[i + FORECAST_BARS + 1].openTime - candles[i].openTime !== (FORECAST_BARS + 1) * HOUR_MS) continue;
      if (candles[i].openTime - candles[i - 24].openTime !== 24 * HOUR_MS) continue;
      if (trailingQuoteTurnover(candles, i) < MIN_SOURCE_TURNOVER_USDT) continue;
      let active = 0;
      for (let k = i - 23; k <= i; k++) if (candles[k].volume > 0) active++;
      if (active < MIN_ACTIVE_BARS || !(atr[i] > 0)) continue;
      const stopDistance = atr[i] * STOP_ATR_MULTIPLE;
      columns.hour.push(candles[i].openTime / HOUR_MS);
      columns.symbol.push(symbolIndex);
      columns.fwd.push(candles[i + FORECAST_BARS].close / candles[i].close - 1);
      columns.atrPct.push(atr[i] / candles[i].close);
      columns.tradeLong.push(simulateTrade(candles, i, stopDistance, 1));
      columns.tradeShort.push(simulateTrade(candles, i, stopDistance, -1));
      columns.stopPct.push(stopDistance / candles[i + 1].open);
      for (const id of FEATURE_IDS) featureColumns[id].push(featureDirection(id, candles, indicators, i));
    }
  }
  return {
    symbols, sources, size: columns.hour.length,
    hour: Int32Array.from(columns.hour), symbol: Int16Array.from(columns.symbol),
    fwd: Float32Array.from(columns.fwd), atrPct: Float32Array.from(columns.atrPct),
    tradeLong: Float32Array.from(columns.tradeLong), tradeShort: Float32Array.from(columns.tradeShort),
    stopPct: Float32Array.from(columns.stopPct),
    features: Object.fromEntries(FEATURE_IDS.map(id => [id, Int8Array.from(featureColumns[id])])) as Record<FeatureId, Int8Array>,
  };
}
