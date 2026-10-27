/** @file 1h 已收盤訊號預測未來 4h 方向的研究策略；驗證未通過，僅供回測，不得接入實盤或推播。 */
import type { StrategyContext, StrategyModule, StrategyParamMeta } from '../types';
import { FEATURE_DEFINITIONS, FEATURE_WARMUP_BARS, HOUR_MS, featureDirection, trailingQuoteTurnover, type FeatureId } from '../hourlyEdgeFeatures';

/**
 * 【詳細繁體中文註解】：1h→4h 方向評分策略（研究候選，backtestOnly）
 *
 * 規則：
 *   1. 在最後一根「已收盤」1h K 計算 13 個技術特徵（趨勢／動能／量能／波動／江恩），各自輸出 +1／-1／0。
 *   2. 分數 = Σ 權重：特徵看漲時加上 `${id}_up`，看跌時加上 `${id}_down`。權重單位為「百分點」，
 *      數值 = 研究 DEV 期（2025-01-01～2026-04-01）該特徵在 BH 校正後顯著的「命中率超額」；
 *      負值代表反向操作（例如 24h 通道向上突破反而加空分），這是 1h 尺度短期反轉的結果。
 *   3. |分數| ≥ entryScore 且 ATR14 / 收盤 ≥ minAtrPct% 且近 24h 估計成交額達門檻 → 依分數正負做多／做空。
 *   4. 持有 holdBars 根 1h（預設 4 根 = 4 小時）後出場；期間以訊號根 ATR14 × stopAtr 停損。
 *
 * 驗證結果（詳見 docs/crypto-1h-4h-edge-report.md）：
 *   樣本外命中率比「一直猜漲／猜跌」高約 1～3 個百分點，但扣除來回 0.2% 成本後平均每筆為負，
 *   DEV 訓練期最佳組合本身也是負期望值，依事先規則判定為「不交易」。預設參數只保留研究結論，
 *   方便在回測頁重現與調整，絕不代表可實盤；backtestOnly 會讓交易入口在任何副作用前拒絕新倉。
 *
 * 玄學特徵（月相、水星逆行、吉凶時辰）在獨立的檢定家族中未通過，本模組刻意不提供其權重參數。
 * 合約做空僅為回測模擬，現貨不支援。
 */

/** 本策略可設定權重的技術特徵（排除玄學類）。 */
const WEIGHTED_FEATURES = FEATURE_DEFINITIONS.filter(f => f.group !== 'ESOTERIC');

/** DEV 期凍結的權重（百分點）；未列出的特徵在 DEV 未通過顯著性檢定，權重為 0。 */
const FROZEN_WEIGHTS: Partial<Record<`${FeatureId}_${'up' | 'down'}`, number>> = {
  ema_stack_up: -1.71, ema_stack_down: 1.42,
  htf_trend_4h_up: -1.42, htf_trend_4h_down: 0.96,
  tsmom_24h_up: -1.86, tsmom_24h_down: 1.61,
  donchian_24_up: -2.82,
  shock_reversal_down: -5.10,
  gann_sq9_cross_up: -1.61, gann_sq9_cross_down: 1.04,
  gann_time_up: -1.58,
};

export const HOURLY_FOUR_HOUR_EDGE_PARAMS: Record<string, number> = {
  ...Object.fromEntries(WEIGHTED_FEATURES.flatMap(f => [[`${f.id}_up`, FROZEN_WEIGHTS[`${f.id}_up`] ?? 0], [`${f.id}_down`, FROZEN_WEIGHTS[`${f.id}_down`] ?? 0]])),
  /** 進場分數門檻（百分點）：DEV 期分數絕對值的 75 百分位。 */
  entryScore: 3.95,
  /** ATR14 ÷ 收盤下限（%）：波動太小時預期 4h 位移付不起 0.2% 來回成本。 */
  minAtrPct: 2,
  /** 持有根數：4 根 1h = 預測窗口 4 小時。 */
  holdBars: 4,
  /** 停損距離 = 訊號根 ATR14 × stopAtr。 */
  stopAtr: 2,
  /**
   * 近 24 根 1h 估計成交額下限（USDT，來源交易所的收盤 × 成交量）。
   * Bybit／Binance.US 現貨量約為 Binance 的 3%，25 萬約對應 Binance 24h 成交額 800 萬等級，
   * 對應使用者「24h 成交額 ≥ 300 萬 USDT」的標的池並排除冷門時段。
   */
  minQuoteTurnoverUsdt: 250_000,
};

const weightMeta: StrategyParamMeta[] = WEIGHTED_FEATURES.flatMap(f => (['up', 'down'] as const).map(direction => ({
  key: `${f.id}_${direction}`,
  label: `${f.label}${direction === 'up' ? '看漲' : '看跌'}權重`,
  description: `${f.rule}。特徵${direction === 'up' ? '看漲' : '看跌'}時加入分數的百分點，正值偏多、負值偏空（反向）。`,
  min: -20, max: 20, step: 0.01,
})));

/** 分數：Σ 特徵方向對應的權重（百分點）。 */
export function hourlyEdgeScore(ctx: StrategyContext): number {
  let score = 0;
  for (const f of WEIGHTED_FEATURES) {
    const up = ctx.params[`${f.id}_up`] ?? 0, down = ctx.params[`${f.id}_down`] ?? 0;
    if (up === 0 && down === 0) continue;
    const direction = featureDirection(f.id, ctx.candles, ctx.indicators, ctx.index);
    if (direction === 1) score += up;
    else if (direction === -1) score += down;
  }
  return score;
}

/** 近 24 根中至少 22 根有成交，與研究面板相同，排除報價停滯的時段。 */
const MIN_ACTIVE_BARS = 22;

const hourlyFourHourEdge: StrategyModule = {
  id: 'hourly_four_hour_edge',
  name: '1h→4h 方向評分（研究・僅回測）',
  description: '以最後一根已收盤 1h K 的 13 個技術與江恩特徵評分，預測未來 4 小時漲跌並持有 4 根後出場。研究結論：樣本外命中率略高於基準，但扣除 0.2% 來回成本後為負期望值，驗證未通過，僅供回測研究。',
  markets: ['CRYPTO'],
  supportedIntervals: ['1h'],
  requiresNextOpen: true,
  warmupBars: FEATURE_WARMUP_BARS + 1,
  supportsShort: true,
  backtestOnly: true,
  defaultParams: HOURLY_FOUR_HOUR_EDGE_PARAMS,
  paramMeta: [
    ...weightMeta,
    { key: 'entryScore', label: '進場分數門檻', description: '|分數| 達此百分點才進場', min: 0, max: 50, step: 0.01 },
    { key: 'minAtrPct', label: 'ATR 波動下限 %', description: '1h ATR14 ÷ 收盤低於此值不進場，避免預期位移小於成本。預設 2% 只有高波動山寨幣會達標；BTC、ETH 的 1h ATR 通常只有 0.3%～1%，幾乎不會進場', min: 0, max: 20, step: 0.1 },
    { key: 'holdBars', label: '持有根數', description: '進場後持有幾根 1h 出場（4 = 4 小時）', min: 1, max: 24, step: 1 },
    { key: 'stopAtr', label: '停損 ATR 倍數', description: '停損距離 = 訊號根 ATR14 × 倍數', min: 0.5, max: 10, step: 0.1 },
    { key: 'minQuoteTurnoverUsdt', label: '近 24h 估計成交額下限', description: '單一來源量乘收盤價的 USDT 近似值', min: 0, max: 1_000_000_000, step: 1000 },
  ],

  evaluate(ctx) {
    const { candles, index, position, params } = ctx;
    if (position) {
      /** 回測引擎有 entryIndex；live 引擎可能未填，改以進場時間換算已持有根數。 */
      const held = position.entryIndex != null ? index - position.entryIndex : Math.round((candles[index].openTime - position.entryTime) / HOUR_MS);
      /** 在第 holdBars-1 根收盤發出 EXIT，下一根開盤成交，實際持有剛好 holdBars 根。 */
      return held >= params.holdBars - 1 ? { type: 'EXIT', reason: `持有 ${params.holdBars} 根 1h 到期` } : { type: 'HOLD' };
    }
    if (index < FEATURE_WARMUP_BARS || index < 24) return { type: 'HOLD', reason: '暖機不足' };
    const bar = candles[index];
    const atr = ctx.indicators.atr(14)[index];
    if (!(atr > 0) || (atr / bar.close) * 100 < params.minAtrPct) return { type: 'HOLD', reason: `1h ATR 波動低於 ${params.minAtrPct}%（ATR 波動下限）` };
    if (trailingQuoteTurnover(candles, index) < params.minQuoteTurnoverUsdt) return { type: 'HOLD', reason: '近 24h 成交額不足' };
    let active = 0;
    for (let i = index - 23; i <= index; i++) if (candles[i].volume > 0) active++;
    if (active < MIN_ACTIVE_BARS) return { type: 'HOLD', reason: '近 24h 成交不連續' };
    const score = hourlyEdgeScore(ctx);
    // 原因字串不帶逐根分數，回測頁才能把同類原因彙總成「未進場原因」統計
    if (score === 0 || Math.abs(score) < params.entryScore) return { type: 'HOLD', reason: `|分數| 未達進場門檻 ${params.entryScore}` };
    const side = score > 0 ? 'LONG' : 'SHORT';
    const stopDistance = atr * params.stopAtr;
    return { type: 'ENTRY', side, stopLossPct: (stopDistance / bar.close) * 100, entryPlan: { stopDistance },
      reason: `1h→4h 分數 ${score.toFixed(2)}（門檻 ${params.entryScore}），ATR ${((atr / bar.close) * 100).toFixed(2)}%` };
  },
};

export default hourlyFourHourEdge;
