/** @file 潛力幣 Gate 永續籌碼摘要；只呈現排程保存的公開統計，不在瀏覽器即時抓取。 */
import { DERIVATIVE_LABELS } from '../../services/potentialRadar/derivatives';
import type { DerivativeSignal } from '../../services/potentialRadar/types';

const signedPct = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const ratio = (value: number | null) => value == null ? '—' : `${value.toFixed(2)}x`;
const money = (value: number | null) => {
  if (value == null) return '—';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return `${(value / 1_000).toFixed(1)}K`;
};

const TONES: Record<DerivativeSignal['status'], string> = {
  HEALTHY_TREND: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  SHORT_SQUEEZE: 'border-amber-400/50 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  CROWDED_LONG: 'border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-200',
  NEW_SHORTS: 'border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-200',
  DELEVERAGING: 'border-orange-400/50 bg-orange-500/10 text-orange-700 dark:text-orange-200',
  NEUTRAL: 'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-200',
  UNAVAILABLE: 'border-slate-400/30 bg-slate-500/5 text-slate-500 dark:text-slate-400',
};

export function DerivativesPanel({ derivatives, compact = false }: { derivatives: DerivativeSignal | null | undefined; compact?: boolean }) {
  if (derivatives === undefined) return <p className="text-xs opacity-60">永續籌碼：此筆舊快照尚未計算。</p>;
  if (derivatives === null) return <p className="text-xs opacity-60">永續籌碼：本輪只精算前三個優先候選。</p>;
  return <section className={`rounded-lg border p-3 ${TONES[derivatives.status]}`} aria-label="Gate 永續籌碼確認">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm">Gate 永續 · {DERIVATIVE_LABELS[derivatives.status]}</strong>
      <span className="text-[11px] opacity-70">不影響原始進場觸發</span>
    </div>
    {derivatives.status === 'UNAVAILABLE' ? <p className="mt-2 text-xs">{derivatives.reasons[0]}</p> : <>
      <dl className={`mt-2 grid gap-x-4 gap-y-1 text-xs ${compact ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2'}`}>
        <div><dt className="opacity-65">OI／近 1h</dt><dd className="font-semibold">{money(derivatives.openInterestUsd)}／{signedPct(derivatives.openInterestChange1hPct)}</dd></div>
        <div><dt className="opacity-65">資金費率／分位</dt><dd className="font-semibold">{derivatives.fundingRate == null ? '—' : `${(derivatives.fundingRate * 100).toFixed(4)}%`}／{derivatives.fundingPercentile == null ? '—' : `P${derivatives.fundingPercentile.toFixed(0)}`}</dd></div>
        <div><dt className="opacity-65">主動／大戶多空比</dt><dd className="font-semibold">{ratio(derivatives.takerLongShortRatio)}／{ratio(derivatives.topLongShortRatio)}</dd></div>
        <div><dt className="opacity-65">1h 多／空單清算</dt><dd className="font-semibold">{money(derivatives.longLiquidationUsd1h)}／{money(derivatives.shortLiquidationUsd1h)}</dd></div>
      </dl>
      {derivatives.risks.length > 0 && <p className="mt-2 text-xs font-medium">{derivatives.risks.join('；')}</p>}
    </>}
  </section>;
}
