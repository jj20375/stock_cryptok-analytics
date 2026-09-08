import type { Candle, StrategyContext, StrategyModule } from '../types';

/** 只用已收盤的 4h K 線；完整 UTC 日由六根連續 K 線組成，避免偷看當日收盤。 */
export const WAVE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 6 * WAVE_INTERVAL_MS;
export type WavePhase = 'WAIT' | 'WATCH' | 'BREAKOUT' | 'RETEST' | 'EXTENDED' | 'EXIT';
export const WAVE_LABELS: Record<WavePhase, string> = {
  WAIT: '等待條件', WATCH: '波段候選', BREAKOUT: '波段啟動',
  RETEST: '回測續強', EXTENDED: '漲幅延伸，等待整理', EXIT: '趨勢失效',
};
export interface WaveSignal {
  phase: WavePhase;
  reason: string;
  price: number;
  barTime: number;
  breakout: number | null;
  volumeRatio: number | null;
  stopLossPct: number | null;
  dailyTrend: boolean;
}

/** 門檻為待驗證假設：20 根突破、2 倍量、2 ATR 停損；不代表勝率或翻倍保證。 */
export const WAVE_PARAMS = {
  breakoutBars: 20, volumeMultiplier: 2, stopAtr: 2, maxStopPct: 12,
  maxExtensionAtr: 1.5, exitBars: 10,
  // 單一交易所前六根 4h 的近似 USDT 成交額下限，排除薄量行情。
  minQuoteVolume: 1_000_000,
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function dailyCloses(candles: Candle[], index: number): number[] {
  const closes: number[] = [];
  for (let i = Math.max(5, index - 311); i <= index; i++) {
    if ((candles[i].openTime + WAVE_INTERVAL_MS) % DAY_MS !== 0) continue;
    const complete = Array.from({ length: 6 }, (_, offset) =>
      candles[i - offset]?.openTime === candles[i].openTime - offset * WAVE_INTERVAL_MS
    ).every(Boolean);
    if (complete) closes.push(candles[i].close);
  }
  return closes;
}

function breakoutAt(ctx: StrategyContext, index: number) {
  const history = ctx.candles.slice(index - ctx.params.breakoutBars, index);
  const level = Math.max(...history.map(c => c.high));
  const averageVolume = mean(history.map(c => c.volume));
  const ratio = averageVolume > 0 ? ctx.candles[index].volume / averageVolume : 0;
  return { level, ratio, triggered: ctx.candles[index].close > level && ratio >= ctx.params.volumeMultiplier };
}

/** 雷達與回測共用判斷；只讀 index 以前的資料，所有價格均以報價幣 USDT 表示。 */
export function analyzeWave(ctx: StrategyContext): WaveSignal {
  const { candles, index, params, indicators } = ctx;
  const current = candles[index];
  const signal: WaveSignal = {
    phase: 'WAIT', reason: '等待完整日線與量價條件', price: current?.close ?? 0,
    barTime: current?.openTime ?? 0, breakout: null, volumeRatio: null,
    stopLossPct: null, dailyTrend: false,
  };
  if (!current || index < 312) return signal;
  // 參數來自使用者表單，無效或超出計算範圍時拒絕產生交易訊號。
  if (!Number.isInteger(params.breakoutBars) || params.breakoutBars < 5 || params.breakoutBars > 60 ||
      !Number.isInteger(params.exitBars) || params.exitBars < 2 || params.exitBars > 60 ||
      !Object.values(params).every(Number.isFinite) || params.volumeMultiplier < 1 ||
      params.stopAtr <= 0 || params.maxStopPct <= 0 || params.maxExtensionAtr <= 0 || params.minQuoteVolume < 0) return signal;
  const daily = dailyCloses(candles, index);
  if (daily.length < 51) return signal;
  const ma20 = mean(daily.slice(-20));
  signal.dailyTrend = daily.at(-1)! > ma20 && ma20 > mean(daily.slice(-50)) && ma20 > mean(daily.slice(-21, -1));
  const breakout = breakoutAt(ctx, index);
  signal.breakout = breakout.level;
  signal.volumeRatio = breakout.ratio;
  const atr = indicators.atr(14)[index];
  if (!Number.isFinite(atr) || atr <= 0) return signal;
  // 至少 2% 防止過緊；若依波動計算需要超過上限則不開倉，不把停損硬縮小。
  signal.stopLossPct = Math.max(2, params.stopAtr * atr / current.close * 100);
  if (!signal.dailyTrend) return { ...signal, reason: '已收盤日線尚未形成上升趨勢' };
  const quoteVolume = candles.slice(index - 5, index + 1).reduce((sum, c) => sum + c.volume * c.close, 0);
  if (quoteVolume < params.minQuoteVolume) return { ...signal, reason: '單一現貨來源成交額不足，保留觀察但不觸發' };
  if (signal.stopLossPct > params.maxStopPct) return { ...signal, reason: '波動所需停損距離超過風險上限' };
  if (current.close - breakout.level > params.maxExtensionAtr * atr) {
    return { ...signal, phase: 'EXTENDED', reason: '價格離突破點過遠，等待整理後重新評估' };
  }
  if (breakout.triggered) return { ...signal, phase: 'BREAKOUT', reason: '日線向上，4 小時收盤突破前高且成交量放大' };
  // 最近六根內曾放量突破；後續所有收盤守住同一突破位，當根回測後突破前根高點才算續強。
  for (let i = index - 1; i >= index - 6; i--) {
    const prior = breakoutAt(ctx, i);
    if (prior.triggered && candles.slice(i + 1, index + 1).every(c => c.close >= prior.level) &&
        current.low <= prior.level + atr * 0.5 && current.close > candles[index - 1].high) {
      if (current.close - prior.level > params.maxExtensionAtr * atr) continue;
      return { ...signal, phase: 'RETEST', breakout: prior.level, reason: '近期放量突破後守住突破位，回測後再次轉強' };
    }
  }
  if (current.close <= breakout.level && breakout.level - current.close <= atr && breakout.ratio >= 1.2) {
    return { ...signal, phase: 'WATCH', reason: '日線向上且接近區間高點，量能增加，尚待收盤突破' };
  }
  return { ...signal, reason: '日線向上，等待放量突破或回測續強' };
}

const cryptoWave: StrategyModule = {
  id: 'crypto_wave', name: '翻倍目標・現貨波段驗證',
  description: '完整日線 MA20/50 向上，4h 放量突破或回測續強進場；ATR 初始停損與前 N 根低點收盤出場。單幣複利回測，翻倍僅為目標，未經樣本外驗證。',
  markets: ['CRYPTO'], supportedIntervals: ['4h'], warmupBars: 312, supportsShort: false,
  defaultParams: WAVE_PARAMS,
  paramMeta: [
    { key: 'breakoutBars', label: '突破回看根數', description: '僅比較當根之前的 4h 高點', min: 5, max: 60, step: 1 },
    { key: 'volumeMultiplier', label: '突破量能倍數', description: '相對前 N 根均量，預設 2 倍為驗證起點', min: 1, max: 5, step: 0.1 },
    { key: 'stopAtr', label: '初始停損 ATR 倍數', description: 'ATR14 波動停損，至少 2%', min: 1, max: 5, step: 0.5 },
    { key: 'maxStopPct', label: '停損距離上限 %', description: '超過上限不進場', min: 2, max: 20, step: 1 },
    { key: 'maxExtensionAtr', label: '最大追價距離 ATR', description: '偏離突破位太遠則等待', min: 0.5, max: 3, step: 0.5 },
    { key: 'exitBars', label: '出場回看根數', description: '收盤跌破前 N 根低點，下一根開盤出場', min: 2, max: 60, step: 1 },
    { key: 'minQuoteVolume', label: '近 24h 估計成交額下限', description: '單一來源量乘收盤價的 USDT 近似值，非全市場成交額', min: 0, max: 100000000, step: 100000 },
  ],
  evaluate(ctx) {
    if (ctx.position) {
      // 出場不受進場量能限制，避免低量或日線轉弱時阻擋風控。
      const count = ctx.params.exitBars;
      if (!Number.isInteger(count) || count < 2 || count > 60 || ctx.index < count) return { type: 'HOLD' };
      const floor = Math.min(...ctx.candles.slice(ctx.index - count, ctx.index).map(c => c.low));
      if (ctx.candles[ctx.index].close < floor) return { type: 'EXIT', reason: `收盤跌破前 ${count} 根低點，波段結構失效` };
      return { type: 'HOLD' };
    }
    const signal = analyzeWave(ctx);
    if (signal.phase === 'BREAKOUT' || signal.phase === 'RETEST') {
      return { type: 'ENTRY', side: 'LONG', stopLossPct: signal.stopLossPct!, reason: signal.reason };
    }
    return { type: 'HOLD' };
  },
};
export default cryptoWave;
