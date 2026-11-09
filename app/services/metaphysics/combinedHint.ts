/** @file 市場變盤強度＋個人流日吉凶的疊加提示（模板文字）。只描述運勢，不包含任何標的或買賣動作。 */
import type { FiveGrade } from './baziLuck';

export type HintTone = '宜守' | '動中有機' | '順勢' | '少動' | '平常心';
export interface CombinedHint { tone: HintTone; text: string }

/** 市場變盤強度 ≥ 2 視為「易變盤」，與命中率統計的變盤門檻一致。 */
const VOLATILE_STRENGTH = 2;

export function combinedHint(turningStrength: number, grade: FiveGrade): CombinedHint {
  const volatile = turningStrength >= VOLATILE_STRENGTH;
  const good = grade === '吉' || grade === '大吉';
  const bad = grade === '凶' || grade === '大凶';
  if (volatile && bad) return { tone: '宜守', text: '市場易變盤，你今天財星受剋，宜守。' };
  if (volatile && good) return { tone: '動中有機', text: '市場易變盤，你今天運勢偏順，動中有機。' };
  if (!volatile && good) return { tone: '順勢', text: '盤勢平穩，你今天運勢偏順，可順勢而為。' };
  if (!volatile && bad) return { tone: '少動', text: '盤勢平穩，但你今天運勢偏弱，不宜衝動。' };
  return { tone: '平常心', text: '今天運勢平平，保持平常心。' };
}
