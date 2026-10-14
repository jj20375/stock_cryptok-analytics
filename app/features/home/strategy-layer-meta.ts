/** @file 策略圖層名稱、色彩與模組映射；UI 只持有顯示資訊，不另寫交易判斷。 */
import type { StrategyOverlayId, StrategyOverlayLayer } from './types';
import type { StrategyModule } from '../../services/strategy/types';
import bigFish from '../../services/strategy/strategies/bigFishTrend';
import extremeReversal from '../../services/strategy/strategies/extremeReversal';
import trend from '../../services/strategy/strategies/trendMomentum';
import consecutiveVolume from '../../services/strategy/strategies/consecutiveVolumeBreakout';
import volumeNoBreak from '../../services/strategy/strategies/volumeNoBreakoutFade';
import squeeze from '../../services/strategy/strategies/volatilitySqueezeBreakout';
import range from '../../services/strategy/strategies/rangeMeanReversion';

type LegacyOverlayId = Exclude<StrategyOverlayId, `futures_${string}`>;
export const STRATEGY_LAYER_MODULES: Record<LegacyOverlayId, StrategyModule> = {
  big_fish: bigFish, extreme_reversal: extremeReversal, trend, consecutive_volume: consecutiveVolume,
  volume_no_break: volumeNoBreak, volatility_squeeze_breakout: squeeze, range_mean_reversion: range,
};
export const STRATEGY_LAYER_META: Record<LegacyOverlayId, Omit<StrategyOverlayLayer, 'events'>> = {
  big_fish: { strategyId: 'big_fish', strategyName: bigFish.name, shortName: '吃大魚 2.0', color: '#a855f7', icon: 'fish', lines: [] },
  extreme_reversal: { strategyId: 'extreme_reversal', strategyName: extremeReversal.name, shortName: '極值反彈', color: '#0f766e', icon: 'zap', lines: [] },
  trend: { strategyId: 'trend', strategyName: trend.name, shortName: '趨勢追蹤', color: '#2563eb', icon: 'trend', lines: [] },
  consecutive_volume: { strategyId: 'consecutive_volume', strategyName: consecutiveVolume.name, shortName: '連續爆量', color: '#059669', icon: 'volume', lines: [] },
  volume_no_break: { strategyId: 'volume_no_break', strategyName: volumeNoBreak.name, shortName: '量增未破', color: '#ea580c', icon: 'warning', lines: [] },
  volatility_squeeze_breakout: { strategyId: 'volatility_squeeze_breakout', strategyName: squeeze.name, shortName: '收斂突破', color: '#b45309', icon: 'squeeze', lines: [] },
  range_mean_reversion: { strategyId: 'range_mean_reversion', strategyName: range.name, shortName: '區間回歸', color: '#be185d', icon: 'range', lines: [] },
};
