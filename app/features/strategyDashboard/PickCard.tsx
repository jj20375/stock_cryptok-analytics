/** @file 單一關注標的卡片：呈現雷達訊號、進場區間、停損參考、驗證狀態與新鮮度；沒有任何下單按鈕。 */
import { BarChart3 } from 'lucide-react';
import type { DashboardPick } from '../../services/strategyDashboard/types';
import { formatAgo, formatPct, formatPrice, formatTaipei } from './format';

const VALIDATION_STYLES = {
  BACKTEST: 'border-emerald-500 bg-emerald-500/10 text-emerald-200',
  TRACKED: 'border-sky-500 bg-sky-500/10 text-sky-200',
  UNVERIFIED: 'border-amber-500 bg-amber-500/10 text-amber-200',
} as const;

export function PickCard({ pick, rank, now, onOpenChart }: {
  pick: DashboardPick;
  rank: number;
  now: number;
  onOpenChart: (pick: DashboardPick) => void;
}) {
  const levels = pick.levels;
  return <article className="flex h-full flex-col rounded-xl border border-black/15 bg-white/75 p-4 shadow-sm">
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs opacity-55">#{rank}</p>
        <h3 className="text-xl font-bold leading-tight">{pick.symbol}</h3>
        <p className="truncate text-xs opacity-65" title={pick.name}>{pick.name}</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-lg font-semibold">{formatPrice(pick.market, pick.price)}</p>
        <p className={`font-mono text-sm ${pick.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {pick.changeLabel} {formatPct(pick.changePct)}</p>
      </div>
    </header>

    <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
      {pick.strategies.map(label => <span key={label} className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-cyan-200">{label}</span>)}
      <span className="rounded-full border border-black/20 px-2.5 py-1" title="雷達品質分數只代表條件符合程度，不是勝率">品質 {pick.score}/100</span>
    </div>

    <div className={`mt-3 rounded border-l-4 px-3 py-2 text-xs ${VALIDATION_STYLES[pick.validation.status]}`}>
      <p className="font-semibold">{pick.validation.status === 'UNVERIFIED' ? '⚠ ' : ''}{pick.validation.label}</p>
      <p className="mt-0.5 opacity-80">{pick.validation.detail}</p>
    </div>

    {levels ? <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
      <div className="col-span-2"><dt className="text-xs opacity-55">建議進場區間（{levels.entryBasis} ～ 收盤參考價）</dt>
        <dd className="font-mono font-semibold">{levels.entryLow === levels.entryHigh ? formatPrice(pick.market, levels.entryHigh)
          : `${formatPrice(pick.market, levels.entryLow)} ～ ${formatPrice(pick.market, levels.entryHigh)}`}</dd></div>
      <div><dt className="text-xs opacity-55">停損參考（結構失效價）</dt>
        <dd className="font-mono text-rose-400">{formatPrice(pick.market, levels.stopLoss)}</dd></div>
      <div><dt className="text-xs opacity-55">距收盤風險</dt><dd className="font-mono">−{levels.riskPct.toFixed(2)}%</dd></div>
    </dl> : <p className="mt-3 rounded bg-black/5 px-3 py-2 text-xs">雷達結構失效價不低於收盤價，暫不提供進場區間與停損參考。</p>}

    <div className="mt-3 border-t border-black/10 pt-2 text-xs leading-5">
      <p><span className="font-semibold">理由：</span>{pick.reasons.slice(0, 3).join('；') || '雷達未提供理由'}</p>
      {pick.risks.length > 0 && <p className="mt-1 text-amber-300"><span className="font-semibold">風險：</span>{pick.risks.slice(0, 2).join('；')}</p>}
    </div>

    <footer className="mt-auto pt-3 text-xs">
      <p className="opacity-70">訊號：{pick.signalTimeframe}・{formatTaipei(pick.signalClosedAt)} 收盤（台北）</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 ${pick.fresh ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
          {pick.fresh ? '最新收盤段' : '非最新收盤段'}</span>
        <span className="opacity-70">計算於 {formatAgo(pick.checkedAt, now)}</span>
      </p>
      <button type="button" onClick={() => onOpenChart(pick)}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded border border-black/20 px-3 py-2 text-sm hover:bg-black/5">
        <BarChart3 size={16} />查看 K 線與訊號標記
      </button>
    </footer>
  </article>;
}
