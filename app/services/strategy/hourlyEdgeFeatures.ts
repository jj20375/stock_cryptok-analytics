/** @file 1h 已收盤 K 線 → 未來 4h 方向的候選特徵；研究腳本與策略模組共用同一份計算，不抓資料、不下單。 */
/**
 * 【詳細繁體中文註解】：1h→4h 方向特徵庫
 *
 * 每個特徵在第 index 根「已收盤」1h K 線上輸出 +1（看漲）、-1（看跌）或 0（無訊號），
 * 預測目標固定為「close[index+4] 相對 close[index] 的漲跌」，即訊號收盤後 4 小時的方向。
 *
 * 分類（研究報告逐一單獨檢驗，作為組合權重的依據）：
 *   趨勢：ema_stack、htf_trend_4h
 *   動能：tsmom_4h、tsmom_24h、rsi_reversion、macd_cross
 *   量能：volume_spike
 *   波動：squeeze_breakout、donchian_24、shock_reversal
 *   江恩：gann_angle、gann_sq9_cross、gann_time
 *   玄學：moon_phase、mercury_retrograde、lucky_hour（只供單獨檢驗，見 esotericCalendar.ts）
 *
 * 防前視鐵則：只讀 candles[0..index] 與指標快取中 <= index 的值；
 * 4h 週期資料只用「已完整收完 4 根 1h」的 4h K，正在形成中的 4h K 一律不用。
 */
import type { Candle } from './types';
import type { IndicatorCache } from './indicatorCache';
import { gannAngleState, gannTimeReversal, squareOfNineCross } from './gannTools';
import { luckyNumberHourSignal, mercuryRetrogradeSignal, moonPhaseSignal } from './esotericCalendar';

export const HOUR_MS = 3_600_000;
/** 預測窗口：4 根 1h K（4 小時）。 */
export const FORECAST_BARS = 4;

export type FeatureGroup = 'TREND' | 'MOMENTUM' | 'VOLUME' | 'VOLATILITY' | 'GANN' | 'ESOTERIC';
export type FeatureId =
  | 'ema_stack' | 'htf_trend_4h' | 'tsmom_4h' | 'tsmom_24h' | 'rsi_reversion' | 'macd_cross' | 'volume_spike'
  | 'squeeze_breakout' | 'donchian_24' | 'shock_reversal' | 'gann_angle' | 'gann_sq9_cross' | 'gann_time'
  | 'moon_phase' | 'mercury_retrograde' | 'lucky_hour';

export interface FeatureDefinition { id: FeatureId; group: FeatureGroup; label: string; rule: string }

/** 特徵說明表；門檻皆為研究前先寫死的常見教科書值，不依結果回頭調整（避免資料探勘）。 */
export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  { id: 'ema_stack', group: 'TREND', label: 'EMA 多空排列', rule: 'EMA20>EMA50>EMA200 看漲；反向排列看跌' },
  { id: 'htf_trend_4h', group: 'TREND', label: '4h 趨勢', rule: '最後一根已收盤 4h K 收在 4h EMA20 上方且 EMA20 上升看漲；反之看跌' },
  { id: 'tsmom_4h', group: 'MOMENTUM', label: '4h 動能延續', rule: '近 4 根 1h 報酬 >0 看漲、<0 看跌' },
  { id: 'tsmom_24h', group: 'MOMENTUM', label: '24h 動能延續', rule: '近 24 根 1h 報酬 >0 看漲、<0 看跌' },
  { id: 'rsi_reversion', group: 'MOMENTUM', label: 'RSI 極端反轉', rule: 'RSI14<25 看漲；>75 看跌' },
  { id: 'macd_cross', group: 'MOMENTUM', label: 'MACD 柱翻正負', rule: 'MACD(12,26,9) 柱由負翻正看漲；由正翻負看跌' },
  { id: 'volume_spike', group: 'VOLUME', label: '爆量方向', rule: '量 >3 倍前 20 根均量，依該根 K 紅黑判方向' },
  { id: 'squeeze_breakout', group: 'VOLATILITY', label: '布林壓縮突破', rule: '前一根布林寬度在近 120 根最低 20%，收盤突破上軌看漲、跌破下軌看跌' },
  { id: 'donchian_24', group: 'VOLATILITY', label: '24h 通道突破', rule: '收盤高於前 24 根最高價看漲；低於最低價看跌' },
  { id: 'shock_reversal', group: 'VOLATILITY', label: '急漲急跌反轉', rule: '真實波幅 >3 倍前一根 ATR14，反向押注' },
  { id: 'gann_angle', group: 'GANN', label: '江恩 1x1 角度線', rule: '72 根擺動點畫 1x1 線（每根 0.125 ATR），同時站上兩線看漲、跌破兩線看跌' },
  { id: 'gann_sq9_cross', group: 'GANN', label: '江恩九方圖 45°', rule: '收盤向上穿越九方圖 45° 價位看漲、向下穿越看跌' },
  { id: 'gann_time', group: 'GANN', label: '江恩時間平方', rule: '距 72 根擺動點剛好 9/16/25/36/49/64 根時押注反轉' },
  { id: 'moon_phase', group: 'ESOTERIC', label: '月相', rule: '新月 ±1 天看漲、滿月 ±1 天看跌' },
  { id: 'mercury_retrograde', group: 'ESOTERIC', label: '水星逆行', rule: '逆行期間看跌' },
  { id: 'lucky_hour', group: 'ESOTERIC', label: '吉凶數字時辰', rule: '台北 8／18 點看漲、4／14 點看跌' },
];

export const FEATURE_IDS = FEATURE_DEFINITIONS.map(f => f.id);

/** 最長回看：EMA200 需要長暖機才收斂（EMA 以第一根為種子），4h EMA20 需 ~100 根 1h；取 600 根保守值。 */
export const FEATURE_WARMUP_BARS = 600;

/** 特徵門檻常數（單位見註解）；改動任何一個都屬於新的假設，必須重跑樣本外驗證。 */
const RSI_OVERSOLD = 25;          // RSI14 極端超賣，比一般 30 更嚴格，減少雜訊
const RSI_OVERBOUGHT = 75;        // RSI14 極端超買
const VOLUME_SPIKE_MULTIPLE = 3;  // 當根量 / 前 20 根均量
const SHOCK_TR_MULTIPLE = 3;      // 真實波幅 / 前一根 ATR14
const SQUEEZE_LOOKBACK = 120;     // 布林寬度百分位的回看根數（5 天）
const SQUEEZE_PERCENTILE = 0.2;   // 最低 20% 視為壓縮
const GANN_LOOKBACK = 72;         // 擺動點回看 72 根 1h（3 天）
const GANN_ATR_FRACTION = 0.125;  // 1x1 線每根上升 0.125 ATR（8 根 = 1 ATR），刻度為人為假設

const sign = (value: number): -1 | 0 | 1 => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * 4h 趨勢序列：以 UTC 00/04/08/12/16/20 對齊彙總 4h K，只在 4 根 1h 全部收完後才更新。
 * 第 i 根 1h 收盤時刻 = openTime[i] + 1h；若該時刻剛好是 4h 邊界，就把這個 4h K 納入計算。
 * 以 WeakMap 依 candles 陣列記憶化，同一段序列只算一次，live 與回測結果一致。
 */
const htfCache = new WeakMap<Candle[], Int8Array>();

export function higherTimeframeTrend(candles: Candle[]): Int8Array {
  const cached = htfCache.get(candles);
  if (cached) return cached;
  const out = new Int8Array(candles.length);
  const period = 20;
  const multiplier = 2 / (period + 1);
  let ema: number | null = null;
  let previousEma: number | null = null;
  let lastClose = 0;
  let state: -1 | 0 | 1 = 0;
  let bucketCount = 0;
  let bucketStart = -1;
  for (let i = 0; i < candles.length; i++) {
    const start = Math.floor(candles[i].openTime / (4 * HOUR_MS)) * 4 * HOUR_MS;
    if (start !== bucketStart) { bucketStart = start; bucketCount = 0; }
    bucketCount++;
    const closesBucket = candles[i].openTime + HOUR_MS === start + 4 * HOUR_MS;
    /** 缺根（交易所停機）的 4h K 不完整，不更新趨勢以免用殘缺資料。 */
    if (closesBucket && bucketCount === 4) {
      lastClose = candles[i].close;
      previousEma = ema;
      ema = ema == null ? lastClose : lastClose * multiplier + ema * (1 - multiplier);
      state = previousEma == null ? 0 : lastClose > ema && ema > previousEma ? 1 : lastClose < ema && ema < previousEma ? -1 : 0;
    }
    out[i] = state;
  }
  htfCache.set(candles, out);
  return out;
}

/** 前 n 根（不含當根）的平均成交量；資料不足回傳 null。 */
function priorVolumeMean(candles: Candle[], index: number, bars: number): number | null {
  if (index < bars) return null;
  let sum = 0;
  for (let i = index - bars; i < index; i++) sum += candles[i].volume;
  return sum / bars;
}

/** 前一根布林寬度是否落在近 SQUEEZE_LOOKBACK 根的最低 20%。 */
function wasSqueezed(width: number[], index: number): boolean {
  const previous = width[index - 1];
  /** 布林寬度暖機期為 NaN；NaN 參與比較永遠為 false，會誤判成「最低百分位」，必須先排除。 */
  if (!Number.isFinite(previous) || index < SQUEEZE_LOOKBACK + 1) return false;
  let below = 0;
  for (let i = index - SQUEEZE_LOOKBACK; i < index; i++) if (Number.isFinite(width[i]) && width[i] < previous) below++;
  return below / SQUEEZE_LOOKBACK <= SQUEEZE_PERCENTILE;
}

/** 單一特徵在 index 的方向；index 不足暖機時一律回 0。 */
export function featureDirection(id: FeatureId, candles: Candle[], indicators: IndicatorCache, index: number): -1 | 0 | 1 {
  if (index < FEATURE_WARMUP_BARS) return 0;
  const bar = candles[index];
  const closeTime = bar.openTime + HOUR_MS;
  switch (id) {
    case 'ema_stack': {
      const e20 = indicators.ema(20)[index], e50 = indicators.ema(50)[index], e200 = indicators.ema(200)[index];
      return e20 > e50 && e50 > e200 ? 1 : e20 < e50 && e50 < e200 ? -1 : 0;
    }
    case 'htf_trend_4h': return higherTimeframeTrend(candles)[index] as -1 | 0 | 1;
    case 'tsmom_4h': return sign(bar.close - candles[index - 4].close);
    case 'tsmom_24h': return sign(bar.close - candles[index - 24].close);
    case 'rsi_reversion': {
      const rsi = indicators.rsi(14)[index];
      return rsi == null ? 0 : rsi < RSI_OVERSOLD ? 1 : rsi > RSI_OVERBOUGHT ? -1 : 0;
    }
    case 'macd_cross': {
      const hist = indicators.macd().hist;
      return hist[index - 1] <= 0 && hist[index] > 0 ? 1 : hist[index - 1] >= 0 && hist[index] < 0 ? -1 : 0;
    }
    case 'volume_spike': {
      const mean = priorVolumeMean(candles, index, 20);
      return mean && bar.volume > mean * VOLUME_SPIKE_MULTIPLE ? sign(bar.close - bar.open) : 0;
    }
    case 'squeeze_breakout': {
      const bands = indicators.bollinger(20, 2);
      if (!wasSqueezed(bands.width, index)) return 0;
      const upper = bands.upper[index], lower = bands.lower[index];
      return bar.close > upper ? 1 : bar.close < lower ? -1 : 0;
    }
    case 'donchian_24': {
      let high = -Infinity, low = Infinity;
      for (let i = index - 24; i < index; i++) { high = Math.max(high, candles[i].high); low = Math.min(low, candles[i].low); }
      return bar.close > high ? 1 : bar.close < low ? -1 : 0;
    }
    case 'shock_reversal': {
      const atrPrevious = indicators.atr(14)[index - 1];
      const trueRange = Math.max(bar.high - bar.low, Math.abs(bar.high - candles[index - 1].close), Math.abs(bar.low - candles[index - 1].close));
      return atrPrevious > 0 && trueRange > atrPrevious * SHOCK_TR_MULTIPLE ? (-sign(bar.close - bar.open) as -1 | 0 | 1) : 0;
    }
    case 'gann_angle': return gannAngleState(candles, indicators.atr(14), index, GANN_LOOKBACK, GANN_ATR_FRACTION);
    case 'gann_sq9_cross': return squareOfNineCross(candles, index);
    case 'gann_time': return gannTimeReversal(candles, index, GANN_LOOKBACK);
    case 'moon_phase': return moonPhaseSignal(closeTime);
    case 'mercury_retrograde': return mercuryRetrogradeSignal(closeTime);
    case 'lucky_hour': return luckyNumberHourSignal(closeTime);
  }
}

/** 近 24 根 1h 的估計成交額（USDT）＝ Σ 收盤 × 成交量；用於逐時點流動性門檻。 */
export function trailingQuoteTurnover(candles: Candle[], index: number, bars = 24): number {
  let sum = 0;
  for (let i = Math.max(0, index - bars + 1); i <= index; i++) sum += candles[i].close * candles[i].volume;
  return sum;
}
