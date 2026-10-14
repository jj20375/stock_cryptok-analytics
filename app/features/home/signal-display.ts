/** @file 策略短名、方向與密集標籤分組；展示完整原因，等待與觀察不冒充已成交。 */
import type { StrategyEvent, StrategyOverlayId, StrategyOverlayLayer } from './types';

/** 短標籤直接交代策略名稱；深色底搭配白字，避免只靠小圖示或顏色辨識。 */
export const SIGNAL_STRATEGIES: Record<StrategyOverlayId, { name: string; color: string }> = {
  big_fish: { name: '大魚', color: '#7e22ce' },
  extreme_reversal: { name: '反彈', color: '#0f766e' },
  trend: { name: '趨勢', color: '#1d4ed8' },
  consecutive_volume: { name: '爆量', color: '#047857' },
  volume_no_break: { name: '未破', color: '#c2410c' },
  volatility_squeeze_breakout: { name: '收斂', color: '#b45309' },
  range_mean_reversion: { name: '區間', color: '#be185d' },
  futures_trend_retest: { name: '合約趨勢', color: '#1d4ed8' },
  futures_range_reclaim: { name: '區間回收', color: '#be185d' },
  futures_rsi_pullback_research: { name: 'RSI2回踩', color: '#0369a1' },
  futures_big_fish: { name: '合約大魚', color: '#7e22ce' },
};
export const SIGNAL_ACTIONS = { ENTRY: '進場', EXIT: '平倉', WARNING: '警示' } as const;
export function getSignalAction(item: StrategyEvent): string {
  if (item.pending) return '待確認';
  if (item.cancelled) return '進場取消';
  if (item.type === 'WARNING') return item.side === 'SHORT' ? '做空觀察' : '警示';
  if (item.type === 'ENTRY') return item.side === 'SHORT' ? '做空進場' : item.side === 'LONG' ? '做多進場' : '進場';
  return item.side === 'SHORT' ? '空單回補' : '平倉';
}
export interface SignalItem extends StrategyEvent {
  id: string;
  strategyId: StrategyOverlayId;
  strategyName: string;
}
export function getSignalItems(layers: StrategyOverlayLayer[]): SignalItem[] {
  return layers.flatMap(layer => layer.events.map((event, index) => ({ ...event,
    id: `${layer.strategyId}:${event.timestamp}:${event.type}:${index}`,
    strategyId: layer.strategyId, strategyName: layer.shortName,
  }))).sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/** 相近標籤依可見時間範圍及容器寬度合併；保留每筆原因，縮放後可再次展開。 */
export function groupChartSignals(items: SignalItem[], range?: { from: number; to: number }, width = 1000) {
  const groups: { timestamp: number; below: boolean; items: SignalItem[] }[] = [];
  /** 方向文字較長，每個氣泡預留約 140px；畫面窄時合併，避免相鄰 K 線標籤重疊。 */
  const minGap = range ? Math.max(0, range.to - range.from) * 140 / Math.max(140, width - 100) : 0;
  for (const below of [true, false]) {
    let previous: typeof groups[number] | undefined;
    for (const item of items) {
      const itemBelow = (item.type === 'ENTRY' && item.side !== 'SHORT') || (item.type === 'EXIT' && item.side === 'SHORT');
      if (itemBelow !== below || (range && (item.timestamp < range.from || item.timestamp > range.to))) continue;
      if (previous && item.timestamp - previous.timestamp <= minGap) previous.items.push(item);
      else { previous = { timestamp: item.timestamp, below, items: [item] }; groups.push(previous); }
    }
  }
  return groups;
}
