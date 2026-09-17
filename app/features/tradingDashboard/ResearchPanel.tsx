/** @component 統一研究面板；僅顯示回測／模擬，不提供下單控制或推估未來勝率。 */
import { useResearch } from './useResearch';
import { tradingPct, tradingTime } from './components';
import type { ResearchDashboard } from '../../services/freqtrade/research.server';

export function ResearchPanel() {
  const { data, error } = useResearch();
  return <ResearchPanelView data={data} error={error} />;
}

export function ResearchPanelView({ data, error = '' }: { data: ResearchDashboard | null; error?: string }) {
  return <section className="terminal-panel terminal-research" aria-label="策略研究與模擬">
    <div className="terminal-panel-heading"><h2>策略研究與模擬</h2><span>Freqtrade · 現貨模擬</span></div>
    {(error || data?.error) && <p role="alert" className="terminal-status error">{error || data?.error} 下方如有快照，僅供追溯。</p>}
    {!data && !error && <p className="terminal-muted">正在讀取研究服務…</p>}
    {data && !data.runs.length && !data.error && <p className="terminal-muted">尚未同步研究結果。啟動本機模擬服務後，績效摘要會顯示在這裡。</p>}
    <div className="terminal-research-grid">{data?.runs.map(run => {
      const m = run.metrics;
      const r = run.research;
      const label = run.mode === 'BACKTEST' ? '歷史回測' : run.stale || error ? '同步中斷' : run.status === 'RUNNING' ? '模擬運行中' : run.status === 'STOPPED' ? '模擬已停止' : '模擬服務異常';
      return <article key={run.runId} className="terminal-research-run">
        <div className="terminal-panel-heading"><h3>{run.mode === 'BACKTEST' ? '歷史驗證' : '即時模擬'}</h3>
          <span className={`terminal-status ${run.stale || error || run.status === 'ERROR' ? 'warn' : ''}`}>{label}</span></div>
        <p>{run.strategyName} <span className="terminal-muted">{run.timeframe} · {run.exchange}</span></p>
        <div className="terminal-research-metrics">
          <div><span>已平倉樣本</span><strong>{m.totalTrades} 筆</strong></div>
          <div><span>歷史勝率</span><strong>{m.totalTrades ? tradingPct(m.winRatePct).replace('+', '') : '—'}</strong></div>
          <div><span>獲利因子 PF</span><strong>{m.totalTrades ? m.profitFactor?.toFixed(2) ?? '—' : '—'}</strong></div>
          <div><span>已平倉最大回撤</span><strong>{m.totalTrades ? tradingPct(m.maxDrawdownPct).replace('+', '') : '—'}</strong></div>
          <div><span>已實現資金報酬</span><strong>{m.totalTrades ? tradingPct(m.netProfitPct) : '—'}</strong></div>
          <div><span>模擬未平倉</span><strong>{m.openTrades} 筆</strong></div>
        </div>
        <p className="terminal-muted">{m.totalTrades === 0 ? '尚無已平倉樣本，不能評估策略表現。' : '歷史結果不代表未來勝率；PF 空白可能是尚無虧損樣本。'}</p>
        <details className="terminal-divider"><summary>研究範圍與成本</summary>
          <dl className="terminal-kv"><dt>策略版本</dt><dd>{run.strategyVersion}</dd><dt>引擎版本</dt><dd>{r?.engineVersion ?? '未提供'}</dd>
            <dt>資料期間（台北）</dt><dd>{r?.periodStart ? tradingTime(r.periodStart) : '未提供'} ～ {r ? tradingTime(r.periodEnd) : '未提供'}</dd>
            <dt>每側手續費</dt><dd>{r?.feeRate != null ? `${(r.feeRate * 100).toFixed(3)}%` : '未提供'}</dd>
            <dt>固定滑價假設</dt><dd>{r?.slippageBps != null ? `${r.slippageBps} bps` : '未提供／非固定模型'}</dd></dl>
          <p className="terminal-muted">{r?.pairs.join('、') || '未提供交易對'}<br />實驗識別：{r?.configurationId ?? '未提供'}</p>
        </details>
        <p className="terminal-muted mt-3">快照：{tradingTime(run.generatedAt)}（台北）</p>
      </article>;
    })}</div>
    <p className="terminal-footer">15 分實驗策略與網站的 4 小時波段策略分開評估，績效不會轉換成個別幣種的勝率。此面板無實盤下單功能。</p>
  </section>;
}
