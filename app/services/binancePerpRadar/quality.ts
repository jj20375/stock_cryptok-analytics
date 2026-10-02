/** @file 將原始吃大魚進場分級；最佳型只描述型態相似度，不宣稱未來勝率。 */
import type { Candle } from '../strategy/types';
import { bigFishSupertrend, type BigFishSignal } from '../potentialRadar/bigFish';

/**
 * 【策略參數注意】以下門檻原本在 15 分線上依 AIN／PONS 型態調出，改用 4 小時線後「依 K 線根數原樣沿用」：
 * 型態以形狀（幾根紅、前幾根漲跌）定義，換週期時保留根數才是同一個形狀；若改成依小時換算，
 * 「至少紅四小時」在 4 小時線上只剩一根，會讓幾乎所有翻綠都變成最佳型。
 * 這些數值尚未在 4 小時線上重新驗證，應以 TradingView 訊號績效頁的實際樣本再評估。
 * 分級只影響 BEST／TREND_FLIP 的標示與通知順序（兩者都會開倉），EARLY_MACD 仍不自動開倉。
 */
export const PERP_BEST_SIGNAL_RULES = {
  /** 翻綠前至少連續 16 根紅色趨勢（4 小時線約 2.7 天），避免把短暫來回翻色誤列為底部啟動。 */
  minimumPriorRedBars: 16,
  /** 最佳型容許略低於 EMA200，但過度偏離時仍可能是下跌中的反彈。 */
  minimumEmaDistancePct: -5,
  /** 高於 EMA200 逾一成視為已延伸，不再標成使用者偏好的底部型態。 */
  maximumEmaDistancePct: 10,
  /** 觸發前 16 根（4 小時線約 2.7 天）限制急跌與急漲，降低追逐暴衝或接快速落刀的風險。 */
  priorShortBars: 16,
  minimumPriorShortChangePct: -3,
  maximumPriorShortChangePct: 8,
  /** 觸發前 96 根（4 小時線約 16 天）限制極端行情；此門檻是型態風控，尚未代表樣本外最佳值。 */
  priorLongBars: 96,
  minimumPriorLongChangePct: -15,
  maximumPriorLongChangePct: 15,
  /** 翻綠收盤距防守線超過 12% 已偏離啟動點，不列最高優先。 */
  maximumSupertrendDistancePct: 12,
} as const;

export type PerpSignalGrade = 'BEST' | 'TREND_FLIP' | 'EARLY_MACD';

export interface PerpSignalQuality {
  grade: PerpSignalGrade;
  priorRedBars: number;
  emaDistancePct: number;
  supertrendDistancePct: number;
  /** 觸發前 priorShortBars 根的漲跌幅；歷史不足時為 null。 */
  priorShortChangePct: number | null;
  /** 觸發前 priorLongBars 根的漲跌幅；歷史不足時為 null。 */
  priorLongChangePct: number | null;
}

function priorChangePct(candles: Candle[], index: number, bars: number) {
  if (index < bars || index < 1) return null;
  const reference = candles[index - bars]?.close;
  const previousClose = candles[index - 1]?.close;
  if (!reference || !previousClose) return null;
  return (previousClose / reference - 1) * 100;
}

/**
 * AIN／PONS 類最佳型必須是 Supertrend 長紅後首次翻綠、仍貼近 EMA200，且翻綠前未先過熱。
 * MACD 金叉或不完整歷史仍會保留為一般訊號，避免分級門檻改寫使用者原始進場邏輯。
 */
export function classifyPerpSignal(candles: Candle[], signal: BigFishSignal): PerpSignalQuality {
  const index = candles.length - 1;
  const close = candles[index]?.close ?? NaN;
  const { direction } = bigFishSupertrend(candles);
  let priorRedBars = 0;
  for (let cursor = index - 1; cursor >= 0 && direction[cursor] === 1; cursor--) priorRedBars++;

  const rules = PERP_BEST_SIGNAL_RULES;
  const emaDistancePct = (close / signal.ema200 - 1) * 100;
  const supertrendDistancePct = (close / signal.supertrend - 1) * 100;
  const priorShortChangePct = priorChangePct(candles, index, rules.priorShortBars);
  const priorLongChangePct = priorChangePct(candles, index, rules.priorLongBars);
  const best = signal.trendLong && priorRedBars >= rules.minimumPriorRedBars &&
    emaDistancePct >= rules.minimumEmaDistancePct && emaDistancePct <= rules.maximumEmaDistancePct &&
    supertrendDistancePct >= 0 && supertrendDistancePct <= rules.maximumSupertrendDistancePct &&
    priorShortChangePct !== null && priorShortChangePct >= rules.minimumPriorShortChangePct &&
    priorShortChangePct <= rules.maximumPriorShortChangePct &&
    priorLongChangePct !== null && priorLongChangePct >= rules.minimumPriorLongChangePct &&
    priorLongChangePct <= rules.maximumPriorLongChangePct;

  return {
    grade: best ? 'BEST' : signal.trendLong ? 'TREND_FLIP' : 'EARLY_MACD',
    priorRedBars, emaDistancePct, supertrendDistancePct, priorShortChangePct, priorLongChangePct,
  };
}
