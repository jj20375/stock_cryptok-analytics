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
  const isShort = pick.direction === 'SHORT';
  return <article className={`flex h-full flex-col rounded-xl border p-4 shadow-sm ${
    isShort ? 'border-rose-500/35 bg-rose-950/5' : 'border-black/15 bg-white/75'
  }`}>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs opacity-55">#{rank}</p>
          <span className={`rounded px-2 py-0.5 text-[11px] font-mono font-bold border ${
            isShort
              ? 'border-rose-500/50 bg-rose-500/20 text-rose-300'
              : 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
          }`}>
            {isShort ? '🔴 做空 SHORT' : '🟢 做多 LONG'}
          </span>
        </div>
        <h3 className="mt-1 text-xl font-bold leading-tight">{pick.symbol}</h3>
        <p className="truncate text-xs opacity-65" title={pick.name}>{pick.name}</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-lg font-semibold">{formatPrice(pick.market, pick.price)}</p>
        <p className={`font-mono text-sm ${pick.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {pick.changeLabel} {formatPct(pick.changePct)}</p>
      </div>
    </header>

    <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
      {pick.strategies.map(label => <span key={label} className={`rounded-full border px-2.5 py-1 ${
        isShort ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
      }`}>{label}</span>)}
      <span className="rounded-full border border-black/20 px-2.5 py-1" title="雷達品質分數只代表條件符合程度，不是勝率">品質 {pick.score}/100</span>
    </div>

    <div className={`mt-3 rounded border-l-4 px-3 py-2 text-xs ${VALIDATION_STYLES[pick.validation.status]}`}>
      <p className="font-semibold">{pick.validation.status === 'UNVERIFIED' ? '⚠ ' : ''}{pick.validation.label}</p>
      <p className="mt-0.5 opacity-80">{pick.validation.detail}</p>
    </div>

    {levels ? <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
      <div className="col-span-2"><dt className="text-xs opacity-55">
        {isShort ? `建議做空反轉區間（收盤參考價 ～ ${levels.entryBasis}）` : `建議做多進場區間（${levels.entryBasis} ～ 收盤參考價）`}
      </dt>
        <dd className={`font-mono font-semibold ${isShort ? 'text-rose-300' : 'text-emerald-300'}`}>
          {levels.entryLow === levels.entryHigh ? formatPrice(pick.market, levels.entryHigh)
            : `${formatPrice(pick.market, levels.entryLow)} ～ ${formatPrice(pick.market, levels.entryHigh)}`}
        </dd></div>
      <div><dt className="text-xs opacity-55">{isShort ? '空單停損（突破失效價）' : '多單停損（結構失效價）'}</dt>
        <dd className="font-mono text-rose-400">{formatPrice(pick.market, levels.stopLoss)}</dd></div>
      <div><dt className="text-xs opacity-55">{levels.targetPrice ? '反轉／波段目標價' : '距收盤風險'}</dt>
        <dd className="font-mono">
          {levels.targetPrice
            ? `${formatPrice(pick.market, levels.targetPrice)} (風險 −${levels.riskPct.toFixed(1)}%)`
            : `−${levels.riskPct.toFixed(2)}%`}
        </dd></div>
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
