/** @file 美股候選入選後績效彙整；缺少到期資料時維持 null，不把缺值當成零報酬。 */
import type { UsStockObservation } from './types';

export interface UsStockReturnSummary {
  count: number;
  average: number | null;
  positiveRate: number | null;
}

export interface UsStockPerformanceGroup {
  key: string;
  label: string;
  sampleCount: number;
  h4: UsStockReturnSummary;
  d1: UsStockReturnSummary;
  d5: UsStockReturnSummary;
  completeCount: number;
  worstDrawdown: number | null;
}

const average = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function summarizeReturn(observations: UsStockObservation[], key: 'h4' | 'd1' | 'd5'): UsStockReturnSummary {
  const values = observations.map(item => item.returns[key])
    .filter((value): value is number => value != null && Number.isFinite(value));
  return { count: values.length, average: average(values),
    positiveRate: values.length ? values.filter(value => value > 0).length / values.length * 100 : null };
}

/** 條件可重疊，各列不能相加；完整樣本才納入最差回撤統計。 */
export function summarizeUsStockPerformance(observations: UsStockObservation[], benchmarkLabel = 'SPY'): UsStockPerformanceGroup[] {
  const groups = [
    { key: 'ALL', label: '全部入選', matches: () => true },
    { key: 'BIG_FISH', label: '經典吃大魚', matches: (item: UsStockObservation) => item.signal.bigFish.entry },
    { key: 'BREAKOUT', label: '放量突破', matches: (item: UsStockObservation) => item.signal.phase === 'BREAKOUT' },
    { key: 'RETEST', label: '回踩續強', matches: (item: UsStockObservation) => item.signal.phase === 'RETEST' },
    { key: 'MARKET_TREND', label: `個股＋${benchmarkLabel} 順勢`, matches: (item: UsStockObservation) => item.signal.dailyTrendUp && item.signal.marketTrendUp },
  ];
  return groups.map(group => {
    const matched = observations.filter(group.matches);
    const completed = matched.filter(item => item.complete && !item.error);
    return { key: group.key, label: group.label, sampleCount: matched.length,
      h4: summarizeReturn(matched, 'h4'), d1: summarizeReturn(matched, 'd1'), d5: summarizeReturn(matched, 'd5'),
      completeCount: completed.length,
      worstDrawdown: completed.length ? Math.min(...completed.map(item => item.maxFall)) : null };
  });
}
