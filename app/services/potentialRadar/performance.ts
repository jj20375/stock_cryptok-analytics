/** @file 潛力幣入選後績效彙整；保留未成熟樣本為 null，不把缺值當成零報酬。 */
import type { RadarObservation } from './types';

export type PerformanceGroupKey = 'ALL' | 'BIG_FISH' | 'TREND_CONFIRMED' | 'STRUCTURE' |
  'DERIVATIVE_HEALTHY' | 'DERIVATIVE_SQUEEZE' | 'DERIVATIVE_CROWDED' | 'DERIVATIVE_BEARISH';

export interface PerformanceGroup {
  key: PerformanceGroupKey;
  label: string;
  description: string;
  sampleCount: number;
  h24: ReturnSummary;
  h72: ReturnSummary;
  d7: ReturnSummary;
  completedCount: number;
  oneREligibleCount: number;
  oneRHitRate: number | null;
  worstDrawdown: number | null;
}

export interface ReturnSummary {
  count: number;
  average: number | null;
  positiveRate: number | null;
}

const GROUPS: Array<{
  key: PerformanceGroupKey;
  label: string;
  description: string;
  matches: (observation: RadarObservation) => boolean;
}> = [
  { key: 'ALL', label: '全部入選', description: '最近載入的所有入選研究樣本', matches: () => true },
  { key: 'BIG_FISH', label: '吃大魚進場', description: '4 小時 MACD 金叉或 Supertrend 翻綠（升級前樣本為 15 分線）',
    matches: observation => observation.signal.bigFish?.entry === true },
  { key: 'TREND_CONFIRMED', label: '趨勢共振', description: '4h MA20 回踩轉強且日線 MA7 向上',
    matches: observation => observation.signal.trendConfirmation?.confirmed === true },
  { key: 'STRUCTURE', label: '量價突破／回踩', description: '量價階段為剛啟動或回踩續強',
    matches: observation => observation.signal.phase === 'BREAKOUT' || observation.signal.phase === 'RETEST' },
  { key: 'DERIVATIVE_HEALTHY', label: '永續健康趨勢', description: '價格與 OI 同漲，且未同時出現多頭擁擠條件',
    matches: observation => observation.signal.derivatives?.status === 'HEALTHY_TREND' },
  { key: 'DERIVATIVE_SQUEEZE', label: '永續軋空上漲', description: '價格上漲但 OI 下降，可能主要來自空單回補',
    matches: observation => observation.signal.derivatives?.status === 'SHORT_SQUEEZE' },
  { key: 'DERIVATIVE_CROWDED', label: '永續多頭擁擠', description: '價格與 OI 同漲，資金費率及多空比同步偏高',
    matches: observation => observation.signal.derivatives?.status === 'CROWDED_LONG' },
  { key: 'DERIVATIVE_BEARISH', label: '永續空方／去槓桿', description: '新增空單或價格與 OI 同跌的去槓桿狀態',
    matches: observation => ['NEW_SHORTS', 'DELEVERAGING'].includes(observation.signal.derivatives?.status ?? '') },
];

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function summarizeReturn(observations: RadarObservation[], key: 'h24' | 'h72' | 'd7'): ReturnSummary {
  const values = observations.map(observation => observation.returns[key]).filter((value): value is number => value != null && Number.isFinite(value));
  return { count: values.length, average: average(values),
    positiveRate: values.length ? values.filter(value => value > 0).length / values.length * 100 : null };
}

/** 1R 以入選收盤至當時結構失效價的距離計算；只有完整七天且風險距離有效的樣本進入分母。 */
function summarizeOneR(observations: RadarObservation[]) {
  const eligible = observations.filter(observation => observation.complete && !observation.error &&
    Number.isFinite(observation.signal.invalidation) && observation.signal.invalidation > 0 &&
    observation.signal.invalidation < observation.entryPrice);
  const hits = eligible.filter(observation => {
    const riskPct = (observation.entryPrice - observation.signal.invalidation) / observation.entryPrice * 100;
    return observation.maxRise >= riskPct;
  });
  return { count: eligible.length, rate: eligible.length ? hits.length / eligible.length * 100 : null };
}

/** 各條件可重疊；ALL 是同一母體總覽，不能把各列樣本數相加。 */
export function summarizePotentialPerformance(observations: RadarObservation[]): PerformanceGroup[] {
  return GROUPS.map(group => {
    const matched = observations.filter(group.matches);
    const completed = matched.filter(observation => observation.complete && !observation.error);
    const oneR = summarizeOneR(matched);
    return {
      key: group.key, label: group.label, description: group.description, sampleCount: matched.length,
      h24: summarizeReturn(matched, 'h24'), h72: summarizeReturn(matched, 'h72'), d7: summarizeReturn(matched, 'd7'),
      completedCount: completed.length, oneREligibleCount: oneR.count, oneRHitRate: oneR.rate,
      worstDrawdown: completed.length ? Math.min(...completed.map(observation => observation.maxFall)) : null,
    };
  });
}
