/**
 * @file 吃大魚 Pro（15m 防雙巴勝利方程式＋江恩波動率倍數目標）策略模組
 *
 * 【詳細繁體中文註解】：設計動機與核心邏輯（與原版 bigFish.ts / bigFishTrend.ts 完全獨立並存）
 *
 * 1. 解決原版吃大魚 2.0 在 15 分線盤整區的「紅線下連環進出場（雙巴）」問題：
 *    - 原版公式為 `earlyLong (MACD 金叉 & Close > EMA200*0.98) OR trendLong (Supertrend 紅翻綠)`，
 *      而平倉條件為 `direction === 1 (Supertrend 為紅線)`。
 *    - 當價格在 EMA200 附近橫盤、但 Supertrend 仍為紅線（`direction === 1`）時，
 *      原版只要遇到 15m MACD 小金叉就會進場，然後下一根因為 Supertrend 還是紅線而立刻平倉，形成連續雙巴。
 *    - 本模組（吃大魚 Pro）嚴格規定：
 *      - **模式 A（底部反轉一號槍）**：`Supertrend(10, 4)` 由紅翻綠（`direction === -1 && prevDirection === 1`），
 *        且翻綠前至少經歷 `minPriorRedBars`（預設 12 根）紅線洗盤釋放浮額、當根收盤實體強度 >= `minCloseStrength / 100`（預設 55%），
 *        且收盤距離新生成的綠線防守位不超過 `maxStopDistPct`（預設 6%）。
 *      - **模式 B（均線順勢二號槍）**：`Supertrend(10, 4)` **已經處於綠線狀態（`direction === -1`）**，
 *        收盤站上 `EMA200` 且 `EMA200` 未下彎，搭配 `MACD(12, 26, 9)` 金叉共振且正乖離 <= `maxEmaExtensionPct`（預設 6%）。
 *        **徹底禁止在 Supertrend 紅線壓制下僅憑 MACD 金叉開倉**。
 *
 * 2. 整合「江恩波動率倍數表格（Gann Volatility Multiples）」與「1R 自動移至保本」：
 *    - 完整還原 TradingView 江恩倍數對照表：
 *      - 低點往上（乘）：`pivotLow * [1.0595, 1.08, 1.1225, 1.144, 1.1664, 1.2121, 1.2355]`
 *      - 高點往下（除）：`pivotHigh / [1.0595, 1.08, 1.1225, 1.144, 1.1664, 1.2121, 1.2355]`
 *    - 進場時自動啟用 `breakevenTriggerR: 1`（當浮盈達 1 倍初始風險距離時，停損自動上移至含雙邊手續費緩衝的保本價），
 *      並於觸及江恩波段目標倍數（預設 `1.08x`）或 Supertrend 翻紅時獲利了結。
 */

import { BIG_FISH_RULES } from '../bigFish';
import type { IndicatorCache } from '../indicatorCache';
import { strategyParamError } from '../parameters';
import type { Candle, StrategyAction, StrategyContext, StrategyModule } from '../types';

/**
 * 【詳細繁體中文註解】：江恩波動率倍數常數（對齊使用者 TradingView 江恩波動率倍數表格）
 */
export const GANN_VOLATILITY_MULTIPLES = [
  1.0595,
  1.08,
  1.1225,
  1.144,
  1.1664,
  1.2121,
  1.2355,
] as const;

export interface GannVolatilityLevel {
  multiple: number;
  /** 低點往上目標價 = 基準低點 × 倍數 */
  upTarget: number;
  /** 高點往下支撐價 = 基準高點 ÷ 倍數 */
  downTarget: number;
}

export interface GannVolatilityTable {
  pivotLow: number;
  pivotHigh: number;
  levels: GannVolatilityLevel[];
}

/**
 * 【詳細繁體中文註解】：根據基準轉折低點（pivotLow）與基準轉折高點（pivotHigh）計算江恩波動率倍數對照表。
 */
export function calculateGannVolatilityTable(pivotLow: number, pivotHigh: number): GannVolatilityTable {
  const safeLow = Number.isFinite(pivotLow) && pivotLow > 0 ? pivotLow : 0;
  const safeHigh = Number.isFinite(pivotHigh) && pivotHigh > 0 ? pivotHigh : 0;
  return {
    pivotLow: safeLow,
    pivotHigh: safeHigh,
    levels: GANN_VOLATILITY_MULTIPLES.map(multiple => ({
      multiple,
      upTarget: safeLow * multiple,
      downTarget: safeHigh > 0 ? safeHigh / multiple : 0,
    })),
  };
}

export interface BigFishProSignal {
  triggered: boolean;
  mode: 'BOTTOM_FLIP' | 'TREND_RESONANCE' | 'RECENT_FLIP_HOLD' | 'NONE';
  score: number;
  reason: string;
  closePrice: number;
  supertrend: number;
  ema200: number;
  priorRedBars: number;
  closeStrength: number;
  volumeRatio: number;
  stopDistance: number;
  gannTable: GannVolatilityTable;
}

/**
 * 【詳細繁體中文註解】：在指定已收盤 K 線索引 `index` 評估「吃大魚 Pro」訊號與江恩目標表。
 * 嚴格只讀取 `0..index` 的歷史資料，無任何前視偏差。
 */
export function evaluateBigFishProAt(
  candles: Candle[],
  index: number,
  indicators: IndicatorCache,
  params: Record<string, number>,
): BigFishProSignal {
  const emptyGann = calculateGannVolatilityTable(0, 0);
  if (index < 50 || !candles[index]) {
    return {
      triggered: false,
      mode: 'NONE',
      score: 0,
      reason: '歷史 K 線不足暖機門檻',
      closePrice: 0,
      supertrend: 0,
      ema200: 0,
      priorRedBars: 0,
      closeStrength: 0,
      volumeRatio: 0,
      stopDistance: 0,
      gannTable: emptyGann,
    };
  }

  const current = candles[index];
  const st = indicators.bigFish();
  const macd = indicators.macd();
  // 足夠 200 根時使用標準 EMA200；若 15m 短期序列不足 200 根則自動降級使用 EMA50 基準
  const effectiveEmaPeriod = index >= BIG_FISH_RULES.emaPeriod ? BIG_FISH_RULES.emaPeriod : 50;
  const ema200Series = indicators.ema(effectiveEmaPeriod);

  const currDir = st.direction[index];
  const prevDir = st.direction[index - 1];
  const supertrend = st.line[index];
  const ema200 = ema200Series[index];
  const prevEma200 = ema200Series[Math.max(0, index - 4)] ?? ema200;

  const dif = macd.dif[index];
  const prevDif = macd.dif[index - 1];
  const sig = macd.macd[index];
  const prevSig = macd.macd[index - 1];
  const hist = macd.hist[index];
  const prevHist = macd.hist[index - 1];

  // 計算當根收盤實體強度（0 ~ 1）
  const range = current.high - current.low;
  const closeStrength = range > 0 ? (current.close - current.low) / range : 0.6;

  // 計算前 20 根均量比
  const volSlice = candles.slice(Math.max(0, index - 20), index);
  const avgVol20 = volSlice.length > 0
    ? volSlice.reduce((sum, b) => sum + b.volume, 0) / volSlice.length
    : current.volume;
  const volumeRatio = avgVol20 > 0 ? current.volume / avgVol20 : 1;

  // 計算翻綠前連續紅線根數（洗盤完整度）
  let priorRedBars = 0;
  for (let cursor = index - 1; cursor >= 0 && st.direction[cursor] === 1; cursor--) {
    priorRedBars++;
  }

  // 計算江恩波動率表格的基準轉折高低點（取前 20 根含當根的波段極值，對齊江恩 10/10 轉折視窗）
  const pivotWindow = candles.slice(Math.max(0, index - 19), index + 1);
  const pivotLow = Math.min(...pivotWindow.map(b => b.low));
  const pivotHigh = Math.max(...pivotWindow.map(b => b.high));
  const gannTable = calculateGannVolatilityTable(pivotLow, pivotHigh);

  const stopDistPct = supertrend > 0 ? ((current.close - supertrend) / current.close) * 100 : 5;
  const stopDistance = Math.max(current.close * 0.01, current.close - supertrend);
  const emaDistPct = ema200 > 0 ? ((current.close / ema200) - 1) * 100 : 0;

  const minPriorRedBars = params.minPriorRedBars ?? 12;
  const minCloseStrength = (params.minCloseStrengthPct ?? 55) / 100;
  const maxStopDistPct = params.maxStopDistPct ?? 6;
  const maxEmaExtensionPct = params.maxEmaExtensionPct ?? 6;

  const target1 = gannTable.levels[0]?.upTarget ?? current.close * 1.0595;
  const target2 = gannTable.levels[1]?.upTarget ?? current.close * 1.08;

  // 模式 A：底部洗盤後 Supertrend 首次由紅翻綠（10/15 20:45 一號狙擊槍）
  if (
    currDir === -1 &&
    prevDir === 1 &&
    priorRedBars >= minPriorRedBars &&
    closeStrength >= minCloseStrength &&
    stopDistPct > 0 &&
    stopDistPct <= maxStopDistPct &&
    volumeRatio >= 1.0
  ) {
    const score = Math.min(98, Math.round(82 + Math.min(8, priorRedBars / 3) + Math.min(8, volumeRatio * 3)));
    return {
      triggered: true,
      mode: 'BOTTOM_FLIP',
      score,
      reason: `【底部翻綠一號槍】洗盤 ${priorRedBars} 根後 Supertrend 翻綠突破（量比 ${volumeRatio.toFixed(1)}x）｜防守 ${supertrend.toFixed(2)}｜江恩目標 ${target1.toFixed(2)} / ${target2.toFixed(2)}`,
      closePrice: current.close,
      supertrend,
      ema200,
      priorRedBars,
      closeStrength,
      volumeRatio,
      stopDistance,
      gannTable,
    };
  }

  // 模式 B：綠線護航＋站穩上升 EMA200＋MACD 金叉轉強（順勢二號加倉槍，徹底排除紅線下假金叉）
  const macdBullCross = (dif > sig && prevDif <= prevSig) || (hist > 0 && prevHist <= 0 && dif > sig);
  if (
    currDir === -1 &&
    current.close > ema200 &&
    ema200 >= prevEma200 * 0.999 &&
    macdBullCross &&
    closeStrength >= 0.5 &&
    emaDistPct >= 0 &&
    emaDistPct <= maxEmaExtensionPct &&
    stopDistPct > 0 &&
    stopDistPct <= maxStopDistPct
  ) {
    const score = Math.min(95, Math.round(80 + Math.min(10, volumeRatio * 4) + Math.min(5, closeStrength * 5)));
    return {
      triggered: true,
      mode: 'TREND_RESONANCE',
      score,
      reason: `【均線共振二號槍】綠線站穩 EMA200 (${ema200.toFixed(2)}) + MACD 金叉共振｜防守 ${supertrend.toFixed(2)}｜江恩目標 ${target1.toFixed(2)} / ${target2.toFixed(2)}`,
      closePrice: current.close,
      supertrend,
      ema200,
      priorRedBars,
      closeStrength,
      volumeRatio,
      stopDistance,
      gannTable,
    };
  }

  return {
    triggered: false,
    mode: 'NONE',
    score: 0,
    reason: currDir === 1 ? 'Supertrend 紅線空頭壓制中，拒絕盤整假金叉進場' : '綠色趨勢延續中，等待洗盤翻綠或均線金叉共振',
    closePrice: current.close,
    supertrend,
    ema200,
    priorRedBars,
    closeStrength,
    volumeRatio,
    stopDistance,
    gannTable,
  };
}

const bigFishPro: StrategyModule = {
  id: 'big_fish_pro',
  name: '吃大魚 Pro（15m 勝利方程式＋江恩目標）',
  description:
    '針對 15 分／短週期高波動優化：廢除紅線下 MACD 假金叉，僅在「長紅洗盤後 Supertrend 首次翻綠」或「綠線站穩上升 EMA200 + MACD 金叉共振」進場；搭配 1R 自動保本與江恩波動率倍數目標（1.0595x / 1.08x）。',
  markets: ['CRYPTO', 'US', 'TW'],
  supportedIntervals: ['15m', '1h', '4h', '1d'],
  warmupBars: BIG_FISH_RULES.emaPeriod,
  supportsShort: false,
  defaultParams: {
    minPriorRedBars: 12,
    minCloseStrengthPct: 55,
    maxStopDistPct: 6,
    maxEmaExtensionPct: 6,
    gannTargetPct: 8,
  },
  paramMeta: [
    { key: 'minPriorRedBars', label: '翻綠前最少紅K數', description: '底部翻綠前須經歷至少 N 根紅線洗盤，過濾盤整來回翻色', min: 4, max: 40, step: 1 },
    { key: 'minCloseStrengthPct', label: '最低收盤強度 %', description: '當根收盤位於高低點區間百分比，排除長上影線假突破', min: 40, max: 85, step: 5 },
    { key: 'maxStopDistPct', label: '最大防守線距離 %', description: '進場價距下方綠色 Supertrend 的最大風險距離', min: 2, max: 15, step: 0.5 },
    { key: 'maxEmaExtensionPct', label: 'EMA200 最大正乖離 %', description: '二號順勢槍距 EMA200 的最大允許正乖離，避免高檔追價', min: 2, max: 15, step: 0.5 },
    { key: 'gannTargetPct', label: '江恩波段停利 %', description: '對應江恩 1.08x（8%）或 1.1225x（12.25%）波段目標，未觸及則沿綠線移動停利', min: 4, max: 25, step: 0.5 },
  ],
  evaluate(ctx: StrategyContext): StrategyAction {
    if (strategyParamError(bigFishPro, ctx.params) || ctx.index < BIG_FISH_RULES.emaPeriod) {
      return { type: 'HOLD' };
    }
    const { candles, index, indicators, position, params } = ctx;
    const current = candles[index];
    const st = indicators.bigFish();

    if (position) {
      // 1. 觸及江恩波段目標價（例如 1.08x）主動獲利了結
      const targetPrice = position.entryPlan?.targetPrice;
      if (targetPrice != null && current.high >= targetPrice) {
        return { type: 'EXIT', reason: `觸及江恩波動率目標價 ${targetPrice.toFixed(2)}，波段獲利平倉` };
      }
      // 2. Supertrend 正式由綠翻紅，趨勢出場
      if (st.direction[index] === 1) {
        return { type: 'EXIT', reason: 'Supertrend 翻紅，趨勢徹底反轉平倉' };
      }
      return { type: 'HOLD' };
    }

    const sig = evaluateBigFishProAt(candles, index, indicators, params);
    if (!sig.triggered) {
      return { type: 'HOLD', reason: sig.reason };
    }

    const stopLossPct = Math.min(15, Math.max(1, (sig.stopDistance / sig.closePrice) * 100));
    const gannTargetPrice = sig.gannTable.pivotLow > 0
      ? Math.max(sig.closePrice * (1 + (params.gannTargetPct ?? 8) / 100), sig.gannTable.levels[1]?.upTarget ?? 0)
      : sig.closePrice * (1 + (params.gannTargetPct ?? 8) / 100);

    return {
      type: 'ENTRY',
      side: 'LONG',
      stopLossPct,
      entryPlan: {
        stopDistance: sig.stopDistance,
        stopPrice: sig.supertrend,
        targetPrice: gannTargetPrice,
        breakevenTriggerR: 1,
      },
      reason: sig.reason,
    };
  },
};

export default bigFishPro;
