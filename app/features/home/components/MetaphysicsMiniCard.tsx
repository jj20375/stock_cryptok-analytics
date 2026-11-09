/**
 * @component 首頁玄學小卡：今天三個市場的紫微變盤強度＋登入者今日流日等級。
 * 獨立向 /api/metaphysics 取資料，失敗時整張卡不顯示，不影響首頁其他區塊。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MoonStar } from 'lucide-react';
import { MetaphysicsDisclaimer } from '../../metaphysics/MetaphysicsDisclaimer';
import { GRADE_CLASS, strengthStars } from '../../metaphysics/dayStyles';

interface TodaySummary {
  markets: Array<{ market: string; label: string; turningStrength: number; directionScore: number }>;
  personal: { grade: string; flags: string[] } | null;
}

export function MetaphysicsMiniCard() {
  const [summary, setSummary] = useState<TodaySummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/metaphysics?view=today')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled) setSummary(body as TodaySummary | null); })
      .catch(() => { /* 小卡是附加資訊，失敗就不顯示 */ });
    return () => { cancelled = true; };
  }, []);
  if (!summary) return null;
  return (
    <Link to="/metaphysics" className="block space-y-2 rounded-sm border border-[#E4E3E0]/15 p-3 text-sm hover:border-[#E4E3E0]/40">
      <div className="flex items-center gap-2 font-semibold"><MoonStar className="h-4 w-4" />今日玄學羅盤</div>
      <ul className="space-y-0.5 text-xs">
        {summary.markets.map((m) => <li key={m.market}>{m.label} 變盤 {strengthStars(m.turningStrength)}</li>)}
      </ul>
      <p className="text-xs">我的流日：{summary.personal
        ? <span className={GRADE_CLASS[summary.personal.grade]}>{summary.personal.grade}{summary.personal.flags.length > 0 && `（${summary.personal.flags.join('、')}）`}</span>
        : '尚未填寫生辰'}</p>
      <MetaphysicsDisclaimer compact />
    </Link>
  );
}
