/**
 * @file 玄學預測命中率：實際變盤判定、命中率、基準機率與 Wilson 95% 信賴區間。純函式，不抓行情。
 * 基準機率是關鍵：任何一天本來就有一定機率大波動，玄學命中率要明顯高於基準才有參考價值。
 */
import type { Candle } from '../strategy/types';
import { localDateOf } from './calendarTime';

/** 某市場當地日期的收盤價。 */
export interface DailyBar { date: string; close: number }
/** 某日的實際結果。 */
export interface DayOutcome { date: string; changePct: number; isTurning: boolean }

/** 大波動倍數：當日漲跌幅絕對值 ≥ 前 20 日平均漲跌幅絕對值 × 1.5 視為大波動。 */
const BIG_MOVE_MULTIPLIER = 1.5;
/** 平均波動回看天數（交易日）。 */
const VOLATILITY_LOOKBACK = 20;
/** 反轉判定：前 3 日連續同向、當日反向。 */
const TREND_DAYS = 3;
/** 方向表態門檻：|方向分數| ≥ 30 才算有表態。 */
export const DIRECTION_CALL_THRESHOLD = 30;
/** 變盤預測門檻：強度 ≥ 2 才算預測變盤。 */
export const TURNING_CALL_THRESHOLD = 2;

/** K 線 → 當地日期收盤序列（同一日期多根時保留最後一根）。 */
export function dailyBarsFromCandles(candles: Candle[], timeZone: string): DailyBar[] {
  const byDate = new Map<string, number>();
  for (const candle of [...candles].sort((a, b) => a.openTime - b.openTime)) byDate.set(localDateOf(candle.openTime, timeZone), candle.close);
  return [...byDate.entries()].map(([date, close]) => ({ date, close }));
}

/** 逐日判定實際是否變盤；前 VOLATILITY_LOOKBACK+1 根資料不足，不輸出。 */
export function classifyOutcomes(bars: DailyBar[]): DayOutcome[] {
  const changes = bars.map((bar, i) => (i === 0 ? 0 : (bar.close / bars[i - 1].close - 1) * 100));
  const outcomes: DayOutcome[] = [];
  for (let i = VOLATILITY_LOOKBACK + 1; i < bars.length; i++) {
    const window = changes.slice(i - VOLATILITY_LOOKBACK, i);
    const avgAbs = window.reduce((sum, c) => sum + Math.abs(c), 0) / VOLATILITY_LOOKBACK;
    const bigMove = avgAbs > 0 && Math.abs(changes[i]) >= avgAbs * BIG_MOVE_MULTIPLIER;
    const recent = changes.slice(i - TREND_DAYS, i);
    const trendSign = recent.every((c) => c > 0) ? 1 : recent.every((c) => c < 0) ? -1 : 0;
    const reversal = trendSign !== 0 && Math.sign(changes[i]) === -trendSign;
    outcomes.push({ date: bars[i].date, changePct: Math.round(changes[i] * 10000) / 10000, isTurning: bigMove || reversal });
  }
  return outcomes;
}

export interface RateStat { hits: number; total: number; rate: number | null; low: number | null; high: number | null }

/** Wilson 95% 信賴區間（z = 1.96）；樣本為 0 時回傳 null。 */
export function wilson(hits: number, total: number, z = 1.96): RateStat {
  if (total === 0) return { hits, total, rate: null, low: null, high: null };
  const p = hits / total, denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return { hits, total, rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** 命中率統計輸入：一筆預測加上實際結果（實際結果為空的列不計）。 */
export interface ScoredRow { turningStrength: number; directionScore: number; actualChangePct: number | null; isTurningActual: boolean | null }

export interface HitRateSummary {
  turning: RateStat;
  turningBaseline: RateStat;
  direction: RateStat;
  directionBaseline: RateStat;
  /** 玄學區間與基準區間不重疊，才算「與隨機有差異」。 */
  turningDistinguishable: boolean;
  directionDistinguishable: boolean;
}

const separated = (a: RateStat, b: RateStat) =>
  a.low != null && a.high != null && b.low != null && b.high != null && (a.low > b.high || a.high < b.low);

export function summarizeHitRate(rows: ScoredRow[]): HitRateSummary {
  const scored = rows.filter((r): r is ScoredRow & { actualChangePct: number; isTurningActual: boolean } =>
    r.actualChangePct != null && r.isTurningActual != null);
  const turningCalls = scored.filter((r) => r.turningStrength >= TURNING_CALL_THRESHOLD);
  const turning = wilson(turningCalls.filter((r) => r.isTurningActual).length, turningCalls.length);
  const turningBaseline = wilson(scored.filter((r) => r.isTurningActual).length, scored.length);
  const directionCalls = scored.filter((r) => Math.abs(r.directionScore) >= DIRECTION_CALL_THRESHOLD && r.actualChangePct !== 0);
  const direction = wilson(directionCalls.filter((r) => Math.sign(r.directionScore) === Math.sign(r.actualChangePct)).length, directionCalls.length);
  const nonFlat = scored.filter((r) => r.actualChangePct !== 0);
  // 基準：同期間「一直猜漲」的命中率。
  const directionBaseline = wilson(nonFlat.filter((r) => r.actualChangePct > 0).length, nonFlat.length);
  return { turning, turningBaseline, direction, directionBaseline,
    turningDistinguishable: separated(turning, turningBaseline), directionDistinguishable: separated(direction, directionBaseline) };
}
