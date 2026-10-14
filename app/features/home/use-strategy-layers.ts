/** @file 首頁策略圖層狀態與重放快取；畫面裁切及開關不重新計算整段策略，無交易副作用。 */
import { useMemo, useState } from 'react';
import { buildStrategyLayers, filterStrategyLayersByVisibleData } from './strategy-overlays';
import type { MarketKey, StockDataPoint, StrategyOverlayId, Timeframe } from './types';

export function useStrategyLayers(data: StockDataPoint[], visibleData: StockDataPoint[], market: MarketKey, timeframe: Timeframe,
  initialEnabledLayers?: StrategyOverlayId[], continuousMarket = false) {
  /** 保留跨標的的顯示偏好；開關僅影響畫面，不會建立交易或更動策略門檻。 */
  const [enabledStrategyLayers, setEnabledStrategyLayers] = useState<StrategyOverlayId[]>(initialEnabledLayers ?? [
    'big_fish', 'extreme_reversal', 'volatility_squeeze_breakout', 'range_mean_reversion',
  ]);
  /** 重放包含多個指標與持倉，只有行情或週期變動才重算；縮放不重建歷史。 */
  const allStrategyLayers = useMemo(() => buildStrategyLayers(data, { market, timeframe, continuousMarket }), [data, market, timeframe, continuousMarket]);
  const strategyLayers = useMemo(() => filterStrategyLayersByVisibleData(allStrategyLayers, visibleData), [allStrategyLayers, visibleData]);
  const activeStrategySignalCount = strategyLayers.filter(layer => enabledStrategyLayers.includes(layer.strategyId))
    .reduce((sum, layer) => sum + layer.events.length, 0);
  const totalStrategySignalCount = allStrategyLayers.filter(layer => enabledStrategyLayers.includes(layer.strategyId))
    .reduce((sum, layer) => sum + layer.events.length, 0);
  const toggleStrategyLayer = (id: StrategyOverlayId) => setEnabledStrategyLayers(previous =>
    previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  return { allStrategyLayers, strategyLayers, enabledStrategyLayers, setEnabledStrategyLayers,
    activeStrategySignalCount, totalStrategySignalCount, toggleStrategyLayer };
}
