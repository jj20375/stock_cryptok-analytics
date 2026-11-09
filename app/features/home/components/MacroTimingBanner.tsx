/**
 * @component 跌勢與震盪盤中的「VIX × 台指夜盤 TSM/SOX × 美股期貨走盤」做空／做多切入時機橫幅
 *
 * 【詳細繁體中文註解】：
 * 專門呈現 `MacroTimingWindow` 的四種實戰時機：
 * - `REVERSAL_LONG_WINDOW`（恐慌極值見頂回落・跌深反轉做多時機）
 * - `SHORT_WINDOW`（VIX 避險升溫＋期貨／夜盤破線・反彈做空時機）
 * - `TREND_LONG_WINDOW`（低恐慌＋期貨共振・順勢回踩做多時機）
 * - `WAIT`（多空拉鋸・等待區間邊界反轉）
 * 並同時列出「做多確認檢核表」與「做空確認檢核表」，讓使用者清楚掌握何時開空、何時抄底做多。
 */
import { Crosshair, Flame, TrendingDown, TrendingUp } from 'lucide-react';
import type { MacroTimingWindow } from '../../../services/macroService';
import { cn } from '../../../utils/cn';

interface MacroTimingBannerProps {
  /** 由 macroService 計算出的做多／做空切入時機結構 */
  timingWindow: MacroTimingWindow;
  /** 市場中文名稱（美股 / 台股 / 幣圈） */
  marketLabel: string;
}

/** 依據時機狀態回傳橫幅邊框與底色樣式 */
function getStanceBoxStyle(stance: MacroTimingWindow['stance']): string {
  if (stance === 'REVERSAL_LONG_WINDOW' || stance === 'TREND_LONG_WINDOW') {
    return 'border-emerald-500/40 bg-emerald-950/20';
  }
  if (stance === 'SHORT_WINDOW') {
    return 'border-rose-500/40 bg-rose-950/20';
  }
  return 'border-amber-500/35 bg-amber-950/15';
}

/** 依據時機狀態回傳徽章配色 */
function getStanceBadgeStyle(stance: MacroTimingWindow['stance']): string {
  if (stance === 'REVERSAL_LONG_WINDOW' || stance === 'TREND_LONG_WINDOW') {
    return 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200';
  }
  if (stance === 'SHORT_WINDOW') {
    return 'border-rose-400/50 bg-rose-500/20 text-rose-200';
  }
  return 'border-amber-400/50 bg-amber-500/20 text-amber-200';
}

export function MacroTimingBanner({ timingWindow, marketLabel }: MacroTimingBannerProps) {
  return (
    <div
      className={cn(
        'mt-3 rounded-sm border p-3.5 space-y-2.5 transition-all',
        getStanceBoxStyle(timingWindow.stance)
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-mono font-bold text-cyan-300">
          <Crosshair className="w-4 h-4 shrink-0" />
          <span>⚡ {marketLabel}多空切入時機雷達（VIX 恐慌 × 期貨走盤 × 夜盤連動）</span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm text-xs font-mono font-bold border',
            getStanceBadgeStyle(timingWindow.stance)
          )}
        >
          {timingWindow.stance === 'SHORT_WINDOW' && <TrendingDown className="w-3.5 h-3.5" />}
          {(timingWindow.stance === 'REVERSAL_LONG_WINDOW' ||
            timingWindow.stance === 'TREND_LONG_WINDOW') && <TrendingUp className="w-3.5 h-3.5" />}
          {timingWindow.stance === 'WAIT' && <Flame className="w-3.5 h-3.5" />}
          {timingWindow.badge}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-[#E4E3E0]/90">{timingWindow.triggerReason}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2 border-t border-[#E4E3E0]/10 text-[11px] font-mono">
        <div className="p-2.5 rounded-sm bg-emerald-950/25 border border-emerald-500/25 space-y-1">
          <div className="font-bold text-emerald-300 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            做多／抄底反轉觸發條件（VIX 見頂回落＋走盤止穩）
          </div>
          {timingWindow.longChecklist.map((item) => (
            <div key={item} className="text-[#E4E3E0]/85 leading-snug">
              {item}
            </div>
          ))}
        </div>

        <div className="p-2.5 rounded-sm bg-rose-950/25 border border-rose-500/25 space-y-1">
          <div className="font-bold text-rose-300 flex items-center gap-1">
            <TrendingDown className="w-3.5 h-3.5" />
            做空／反彈避險觸發條件（VIX 突破均線＋夜盤轉弱）
          </div>
          {timingWindow.shortChecklist.map((item) => (
            <div key={item} className="text-[#E4E3E0]/85 leading-snug">
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
