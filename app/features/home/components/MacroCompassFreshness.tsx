/**
 * @component 羅盤判讀時間與報價新鮮度列
 * 顯示「這份判讀是幾點算的」與各報價最後更新時間，並標出抓取失敗的來源。
 * 目的：避免使用者拿前一晚的判讀操作當天台股（VIX、10Y 只在美股時段更新，台股盤中其實停在前一晚）。
 */
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../../../utils/cn';
import type { MacroIndicators, MacroSourceKey } from '../../../services/macroService';

/** 判讀超過 15 分鐘視為過時並以黃字警示（前端每 5 分鐘自動更新，正常情況不會觸發） */
const STALE_OUTLOOK_MS = 15 * 60 * 1000;

/** 新鮮度列顯示的報價來源與中文名稱；依台股盤前最關心的順序排列 */
const SOURCE_LABELS: { key: MacroSourceKey; label: string }[] = [
  { key: 'nq', label: 'NQ' },
  { key: 'es', label: 'ES' },
  { key: 'usdTwd', label: '台幣' },
  { key: 'dxy', label: 'DXY' },
  { key: 'vix', label: 'VIX' },
  { key: 'us10y', label: '10Y' },
];

/** 以瀏覽器時區顯示時間；非今天的報價加上日期，一眼看出是前一晚的數據 */
function formatQuoteTime(ms: number, now: number): string {
  const date = new Date(ms);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function MacroCompassFreshness({ macro }: { macro: MacroIndicators }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // 每 30 秒刷新「幾分鐘前」字樣，不重新抓資料
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ageMinutes = Math.max(0, Math.floor((now - macro.timestamp) / 60_000));
  const isStale = now - macro.timestamp > STALE_OUTLOOK_MS;
  const quoteTimes = macro.dataStatus?.quoteTimes ?? {};
  const missing = macro.dataStatus?.missing ?? [];
  const missingLabels = SOURCE_LABELS.filter(({ key }) => missing.includes(key)).map(({ label }) => label);

  return (
    <div className="mt-2 flex flex-col gap-1 text-[11px] font-mono text-[#E4E3E0]/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn('inline-flex items-center gap-1', isStale && 'text-amber-300')}>
          <Clock className="w-3 h-3" />
          判讀時間 {formatQuoteTime(macro.timestamp, now)}（{ageMinutes === 0 ? '剛剛' : `${ageMinutes} 分鐘前`}）
          {isStale && ' · 已過時，請按「更新風向」'}
        </span>
        <span className="text-[#E4E3E0]/45">
          報價：
          {SOURCE_LABELS.filter(({ key }) => quoteTimes[key]).map(({ key, label }) => `${label} ${formatQuoteTime(quoteTimes[key]!, now)}`).join(' · ')}
        </span>
      </div>
      {missingLabels.length > 0 && (
        <div className="text-amber-300">
          ⚠️ {missingLabels.join('、')} 報價抓取失敗，相關維度標示「資料暫缺」且未納入評分。
        </div>
      )}
    </div>
  );
}
