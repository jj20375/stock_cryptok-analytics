/** @file 截圖七策略的當沖研究清單；日線公式只在此以 15 分 K 解讀，不改全域適用週期。 */
import { getStrategy } from '../strategy/registry';
import type { StrategyModule } from '../strategy/types';

export const DAYTRADE_STRATEGY_IDS = ['big_fish', 'extreme_reversal', 'trend_momentum',
  'consecutive_volume_breakout', 'volume_no_breakout_fade', 'volatility_squeeze_breakout', 'range_mean_reversion'];

export function daytradeStrategies(): StrategyModule[] {
  return DAYTRADE_STRATEGY_IDS.map(id => {
    const strategy = getStrategy(id);
    if (!strategy) throw new Error(`當沖策略未註冊：${id}`);
    return strategy;
  });
}

/** 量增未破原本產生 SHORT，只用於只做多名單的排除風控，不能倒轉成買進訊號。 */
export const DAYTRADE_RISK_STRATEGY_ID = 'volume_no_breakout_fade';
