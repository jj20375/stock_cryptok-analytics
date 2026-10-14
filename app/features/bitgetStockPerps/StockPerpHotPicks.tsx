/** @component 股票永續熱門候選：表單交由 Hook 掃描，結果按原始評分排序，點選只更新分析圖表。 */
import { Zap } from 'lucide-react';
import { STOCK_PERP_SCAN_STRATEGIES } from '../../services/bitgetStockPerps/scanner';
import type { StockPerpContract } from '../../services/bitgetStockPerps/market';
import type { Timeframe } from '../../types';
import { useStockPerpScanner } from './useStockPerpScanner';
import { cn } from '../../utils/cn';

export const STOCK_PERP_TIMEFRAME_LABELS: Record<Timeframe, string> = { '1d': '日線', '4h': '4小時線', '60m': '1小時線', '15m': '15分鐘線' };

export function StockPerpHotPicks({ contracts, selectedSymbol, aiEnabled, onSelect }: {
  contracts: StockPerpContract[]; selectedSymbol: string; aiEnabled: boolean; onSelect: (symbol: string, timeframe: Timeframe) => void;
}) {
  const scanner = useStockPerpScanner(contracts, aiEnabled);
  const { progress, reportSettings } = scanner;
  const percent = progress ? (progress.total ? Math.round(progress.processed / progress.total * 100) : 100) : 0;
  const reportName = STOCK_PERP_SCAN_STRATEGIES.find(item => item.id === reportSettings?.strategy)?.name;
  return (
    <section className="rounded border border-slate-700 bg-[#111315] p-4 md:p-5" aria-label="股票合約熱門標的掃描">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <h2 className="flex items-center gap-2 font-serif text-lg font-bold italic"><Zap size={18} className="text-emerald-400" />股票合約熱門標的 TOP 10</h2>
        <span className="text-xs text-slate-400">技術條件排序 · {aiEnabled ? '登入後可取得 AI 解讀' : '登入後可啟用 AI 解讀'}</span>
      </div>
      <div className="grid gap-4 rounded border border-slate-700 bg-slate-900/80 p-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="mb-2 text-xs font-bold text-slate-400">選擇量化分析策略</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {STOCK_PERP_SCAN_STRATEGIES.map(strategy => (
              <button key={strategy.id} type="button" disabled={scanner.busy} aria-pressed={scanner.strategy === strategy.id}
                onClick={() => scanner.setStrategy(strategy.id)} className={cn('rounded border p-3 text-left disabled:opacity-50',
                  scanner.strategy === strategy.id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-[#080d16] text-slate-300')}>
                <strong className="block text-xs">{strategy.name}</strong><span className="mt-2 block text-[11px] leading-relaxed opacity-70">{strategy.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-between gap-3">
          <div>
            <p className="mb-2 text-xs font-bold text-slate-400">掃描時間週期</p>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(STOCK_PERP_TIMEFRAME_LABELS) as Timeframe[]).map(timeframe => (
                <button key={timeframe} type="button" aria-pressed={scanner.timeframe === timeframe}
                  disabled={scanner.busy || (scanner.strategy === 'daily_volume_spike' && timeframe !== '1d')}
                  onClick={() => scanner.setTimeframe(timeframe)} className={cn('rounded border py-2 text-xs font-bold disabled:opacity-40',
                    scanner.timeframe === timeframe ? 'border-emerald-500 bg-emerald-500 text-slate-950' : 'border-slate-700 bg-[#080d16]')}>
                  {STOCK_PERP_TIMEFRAME_LABELS[timeframe]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void scanner.run()} disabled={scanner.busy || !contracts.length}
              className="flex flex-1 items-center justify-center gap-2 rounded bg-emerald-500 p-3 text-sm font-bold text-slate-950 disabled:opacity-50">
              <Zap size={16} />{scanner.phase === 'ai' ? 'AI 解讀中…' : scanner.busy ? '掃描中…' : 'START SCAN'}
            </button>
            {scanner.busy && <button type="button" onClick={scanner.cancel} className="rounded border border-slate-600 px-3 text-xs">取消</button>}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">掃描 Bitget 目前上架的 {contracts.length} 個股票永續商品；先篩選近 24H 成交額 ≥ 10 萬 USDT、價差 ≤ 0.5%，只評分已收盤 K 線。</p>
      {scanner.busy && <div className="mt-3" role="status" aria-live="polite">
        <div className="mb-1 flex justify-between text-xs text-emerald-300"><span>{progress ? `已檢查 ${progress.processed} / ${progress.total} 個` : '取得商品流動性…'}</span><span>{percent}%</span></div>
        <progress value={percent} max={100} className="h-2 w-full accent-emerald-500" aria-label="股票合約掃描進度" />
      </div>}
      {scanner.message && <p role="status" className="mt-3 text-xs text-amber-300">{scanner.message}</p>}
      {progress && <div className="mt-3 text-xs text-slate-400" aria-live="polite">
        <p>{reportName} · {reportSettings && STOCK_PERP_TIMEFRAME_LABELS[reportSettings.timeframe]} · {new Date(progress.scanAt).toLocaleString('zh-TW')}
          {' · '}{scanner.phase === 'done' ? '掃描完成' : '部分結果'} · 符合 {progress.matched} 個，顯示 TOP {progress.results.length}</p>
        <p className="mt-1">流動性排除 {progress.excluded} · 資料不足 {progress.insufficient} · 資料逾期 {progress.stale} · 行情失敗 {progress.failed}</p>
        {!!progress.issues.length && <details className="mt-2"><summary className="cursor-pointer">查看行情失敗原因</summary>{progress.issues.map(issue => <p key={issue} className="mt-1">{issue}</p>)}</details>}
      </div>}
      {!!progress?.results.length && <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {progress.results.map((pick, index) => (
          <button type="button" key={pick.symbol} onClick={() => onSelect(pick.symbol, reportSettings!.timeframe)}
            className={cn('rounded border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-emerald-400',
              pick.symbol === selectedSymbol ? 'border-emerald-400 bg-emerald-500/15' : 'border-slate-700 bg-slate-900/80 hover:border-emerald-500')}>
            <div className="flex justify-between gap-2 text-xs"><span className="text-emerald-300">RANK #{index + 1}</span><span>{pick.bias}</span></div>
            <h3 className="mt-2 font-bold">{pick.name}</h3><p className="text-[11px] text-slate-400">{pick.symbol}</p>
            <p className="mt-3 text-xs leading-relaxed">{pick.reason}</p>
            {pick.aiInsight && <p className="mt-2 border-l-2 border-indigo-400 pl-2 text-xs text-indigo-200">AI：{pick.aiInsight}</p>}
            <p className="mt-3 text-[11px] text-slate-400">參考收盤 {pick.price.toLocaleString()} USDT<br />訊號收盤 {new Date(pick.signalTime).toLocaleString('zh-TW')}</p>
            <p className="mt-1 text-[11px] text-slate-400">24H 額 {(pick.turnoverUsdt / 10_000).toFixed(1)} 萬 USDT · 價差 {pick.spreadPct.toFixed(3)}%</p>
            <div className="mt-3 flex justify-between text-xs font-bold"><span>條件分數</span><span>{pick.score} / 100</span></div>
            <p className="mt-2 text-[11px] text-emerald-300">點選查看此週期合約圖表 →</p>
          </button>
        ))}
      </div>}
      {scanner.phase === 'done' && progress && !progress.results.length && <p className="py-8 text-center text-sm text-slate-400">
        {progress.total === 0 ? '目前沒有通過流動性篩選的商品。' : '本次已檢查商品沒有符合條件的候選，請切換策略或週期。'}
      </p>}
      {scanner.phase === 'idle' && <p className="py-8 text-center text-sm text-slate-400">選擇策略與週期，點 START SCAN 找出符合條件的股票合約。</p>}
      <p className="mt-3 text-[11px] text-slate-500">分數是技術條件匹配度，並非勝率；觀察名單包含放量下跌與做空警示，點選只開啟分析圖表。</p>
    </section>
  );
}
