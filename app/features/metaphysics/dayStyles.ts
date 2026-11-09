/** @file 玄學羅盤日曆的共用樣式工具；顏色沿用漲跌羅盤慣例（emerald 偏多、rose 偏空）。 */

/** 方向分數 |分數| ≥ 30 才算表態，與命中率統計門檻一致。 */
const DIRECTION_THRESHOLD = 30;

export function directionTone(score: number): { label: string; className: string } {
  if (score >= DIRECTION_THRESHOLD) return { label: '偏多', className: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300' };
  if (score <= -DIRECTION_THRESHOLD) return { label: '偏空', className: 'border-rose-500/40 bg-rose-950/20 text-rose-300' };
  return { label: '中性', className: 'border-current/15' };
}

export const strengthStars = (strength: number) => '★'.repeat(strength) + '☆'.repeat(3 - strength);

/** 'YYYY-MM-DD' → 'M/D 週X'（日期字串本身就是當地日期，直接用 UTC 解讀避免瀏覽器時區位移）。 */
export function shortDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()} 週${'日一二三四五六'[date.getUTCDay()]}`;
}

export const GRADE_CLASS: Record<string, string> = {
  大吉: 'text-emerald-300', 吉: 'text-emerald-200', 平: 'opacity-70', 凶: 'text-rose-200', 大凶: 'text-rose-300',
};
