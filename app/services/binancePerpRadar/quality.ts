/** @file 將原始吃大魚進場分級；最佳型只描述型態相似度，不宣稱未來勝率。 */
import type { Candle } from '../strategy/types';
import { bigFishSupertrend, type BigFishSignal } from '../potentialRadar/bigFish';

export const PERP_BEST_SIGNAL_RULES = {
  /** 至少連續四小時為紅色趨勢，避免把短暫來回翻色誤列為底部啟動。 */
  minimumPriorRedBars: 16,
  /** 最佳型容許略低於 EMA200，但過度偏離時仍可能是下跌中的反彈。 */
  minimumEmaDistancePct: -5,
  /** 高於 EMA200 逾一成視為已延伸，不再標成使用者偏好的底部型態。 */
  maximumEmaDistancePct: 10,
  /** 觸發前四小時限制急跌與急漲，降低追逐單根暴衝或接快速落刀的風險。 */
  minimumPrior4hChangePct: -3,
  maximumPrior4hChangePct: 8,
  /** 觸發前一天限制極端行情；此門檻是型態風控，尚未代表樣本外最佳值。 */
  minimumPrior24hChangePct: -15,
  maximumPrior24hChangePct: 15,
  /** 翻綠收盤距防守線超過 12% 已偏離啟動點，不列最高優先。 */
  maximumSupertrendDistancePct: 12,
} as const;

export type PerpSignalGrade = 'BEST' | 'TREND_FLIP' | 'EARLY_MACD';

export interface PerpSignalQuality {
  grade: PerpSignalGrade;
  priorRedBars: number;
  emaDistancePct: number;
  supertrendDistancePct: number;
  prior4hChangePct: number | null;
  prior24hChangePct: number | null;
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

  const emaDistancePct = (close / signal.ema200 - 1) * 100;
  const supertrendDistancePct = (close / signal.supertrend - 1) * 100;
  const prior4hChangePct = priorChangePct(candles, index, 16);
  const prior24hChangePct = priorChangePct(candles, index, 96);
  const rules = PERP_BEST_SIGNAL_RULES;
  const best = signal.trendLong && priorRedBars >= rules.minimumPriorRedBars &&
    emaDistancePct >= rules.minimumEmaDistancePct && emaDistancePct <= rules.maximumEmaDistancePct &&
    supertrendDistancePct >= 0 && supertrendDistancePct <= rules.maximumSupertrendDistancePct &&
    prior4hChangePct !== null && prior4hChangePct >= rules.minimumPrior4hChangePct &&
    prior4hChangePct <= rules.maximumPrior4hChangePct &&
    prior24hChangePct !== null && prior24hChangePct >= rules.minimumPrior24hChangePct &&
    prior24hChangePct <= rules.maximumPrior24hChangePct;

  return {
    grade: best ? 'BEST' : signal.trendLong ? 'TREND_FLIP' : 'EARLY_MACD',
    priorRedBars, emaDistancePct, supertrendDistancePct, prior4hChangePct, prior24hChangePct,
  };
}
