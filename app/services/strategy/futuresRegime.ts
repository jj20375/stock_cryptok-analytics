/** @file 永續合約盤勢分類；完整四根 UTC 1H 合成 4H，只使用當時已收盤資料。 */
import { IndicatorCache } from './indicatorCache';
import type { Candle, StrategyContext } from './types';

export const HOUR_MS = 3_600_000;
/** 規則修正版：確認根與回踩根分離，槓桿依停損距離取上限內可用倍數；舊報告不重寫。 */
export const FUTURES_RULES_VERSION = 2;
export type FuturesPhase = 'UP' | 'DOWN' | 'RANGE' | 'WAIT' | 'SHOCK';
export const FUTURES_PHASE_LABELS: Record<FuturesPhase, string> = {
  UP: '上升趨勢', DOWN: '下降趨勢', RANGE: '區間盤整', WAIT: '等待盤勢', SHOCK: '波動衝擊・冷卻',
};
/** EMA200 的 4H 暖機至少需 800 根 1H；額外保留對齊與斜率比較裕度。 */
export const FUTURES_WARMUP = 820;
/** 持倉可能在最新未收盤小時才建立；此時最後已知根就是零持倉時間，不能回退到歷史索引零。 */
export function futuresEntryIndex(candles: Candle[], openedAt: number) {
  const next = candles.findIndex(c => c.openTime > openedAt);
  return next < 0 ? candles.length - 1 : Math.max(0, next - 1);
}
const seriesCache = new WeakMap<IndicatorCache, { candles: Candle[]; map: number[]; indicators: IndicatorCache; gapPrefix: number[] }>();

function series(ctx: StrategyContext) {
  const cached = seriesCache.get(ctx.indicators);
  if (cached) return cached;
  const candles: Candle[] = [], map: number[] = [], gapPrefix: number[] = [];
  for (let i = 0; i < ctx.candles.length; i++) {
    const current = ctx.candles[i];
    if (i >= 3 && (current.openTime + HOUR_MS) % (4 * HOUR_MS) === 0) {
      const group = ctx.candles.slice(i - 3, i + 1);
      if (group.every((c, j) => c.openTime === current.openTime - (3 - j) * HOUR_MS)) {
        const previous = candles.at(-1);
        gapPrefix.push((gapPrefix.at(-1) ?? 0) + (previous && group[0].openTime - previous.openTime !== 4 * HOUR_MS ? 1 : 0));
        candles.push({ openTime: group[0].openTime, open: group[0].open, close: current.close,
          high: Math.max(...group.map(c => c.high)), low: Math.min(...group.map(c => c.low)), volume: group.reduce((sum, c) => sum + c.volume, 0) });
      }
    }
    map.push(candles.length - 1);
  }
  const result = { candles, map, gapPrefix, indicators: new IndicatorCache(candles) };
  seriesCache.set(ctx.indicators, result);
  return result;
}

export function futuresRegime(ctx: StrategyContext): { phase: FuturesPhase; atr: number; adx: number; reason: string } {
  const i = ctx.index, atrs = ctx.indicators.atr(14), atr = atrs[i];
  const wait = (reason: string) => ({ phase: 'WAIT' as const, atr, adx: NaN, reason });
  if (i < FUTURES_WARMUP || !Number.isFinite(atr) || atr <= 0) return wait('等待完整 4H 暖機');
  /** 最近六根若有缺口或 3 ATR 衝擊，兩種策略都不建立新倉；出場不受此限制。 */
  for (let j = i - 5; j <= i; j++) {
    const c = ctx.candles[j], previous = ctx.candles[j - 1];
    if (c.openTime - previous.openTime !== HOUR_MS) return wait('1H 資料缺口，等待連續行情');
    const tr = Math.max(c.high - c.low, Math.abs(c.high - previous.close), Math.abs(c.low - previous.close));
    if (tr > atrs[j - 1] * 3) return { phase: 'SHOCK', atr, adx: NaN, reason: '最近六根出現 3 ATR 衝擊，暫停新倉' };
  }
  const s = series(ctx), k = s.map[i];
  if (k < 202 || ctx.candles[i].openTime + HOUR_MS - (s.candles[k].openTime + 4 * HOUR_MS) >= 4 * HOUR_MS
    || s.gapPrefix[k] !== s.gapPrefix[k - 200]) return wait('4H 歷史不足、過期或有缺口');
  const ema20 = s.indicators.ema(20), ema50 = s.indicators.ema(50), ema200 = s.indicators.ema(200);
  const adx = s.indicators.adx(14).adx, atr4h = s.indicators.atr(14)[k], close = s.candles[k].close;
  let phase: FuturesPhase = 'WAIT';
  /** ADX 25／20 是研究起點，中間帶及方向衝突一律等待，避免兩策略同時觸發。 */
  if (adx[k] >= 25 && close > ema200[k] && ema20[k] > ema50[k] && ema50[k] > ema50[k - 3]) phase = 'UP';
  else if (adx[k] >= 25 && close < ema200[k] && ema20[k] < ema50[k] && ema50[k] < ema50[k - 3]) phase = 'DOWN';
  else if ([adx[k], adx[k - 1], adx[k - 2]].every(v => Number.isFinite(v) && v < 20)
    && Math.abs(ema50[k] - ema50[k - 3]) <= atr4h * 0.5) phase = 'RANGE';
  return { phase, atr, adx: adx[k], reason: `${FUTURES_PHASE_LABELS[phase]}・4H ADX ${adx[k]?.toFixed(1)}` };
}
