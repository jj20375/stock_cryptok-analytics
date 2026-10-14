/** @file SSR 安全載入 Vela；成交標記與入出場參考線只用於歷史復盤。 */
import { useEffect, useRef, useState } from 'react';
import type { OHLCV } from '@luxalgo/vela';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import type { Session } from '../../services/bitgetLedger/types';
interface ChartData { bars: OHLCV[]; timeframe: string; from: number; to: number; truncated: boolean }
export function JournalChart({ accountId, session }: { accountId: string; session: Session }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [replaying, setReplaying] = useState(false), [replayIndex, setReplayIndex] = useState(0), [barCount, setBarCount] = useState(0);
  const workspaceRef = useRef<VelaWorkspace | null>(null), chartDataRef = useRef<ChartData | null>(null);
  useEffect(() => {
    const abort = new AbortController(); let workspace: VelaWorkspace | null = null;
    setLoading(true); setError(null); setReplaying(false); setTruncated(false); setBarCount(0); chartDataRef.current = null;
    void (async () => {
      const response = await fetch('/trade-journal', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'chart', accountId, sessionId: session.id }), signal: abort.signal });
      const payload = await response.json() as ChartData & { error?: string };
      if (!response.ok) throw new Error(payload.error || '圖表載入未完成');
      const { VelaWorkspace: Workspace } = await import('@luxalgo/vela/workspace');
      if (abort.signal.aborted || !container.current) return;
      workspace = new Workspace(container.current, {
        layout: false, live: false, symbol: session.symbol, timeframe: payload.timeframe, data: payload.bars,
        timezone: 'Etc/UTC', bottombar: false,
        topbar: { left: ['style', 'indicators', 'undo-redo'], right: ['screenshot'] },
        theme: { background: '#ffffff', textColor: '#141414', gridColor: '#ededed', borderColor: '#d4d4d4', upColor: '#ef4444', downColor: '#22c55e', fontFamily: 'ui-monospace, monospace' },
      });
      workspaceRef.current = workspace; chartDataRef.current = payload; setBarCount(payload.bars.length);
      setReplayIndex(payload.bars.length - 1); setTruncated(payload.truncated);
      workspace.chart.addNativeIndicator('ema', { inputs: { length: 20 } });
      renderMarks(workspace.chart, session);
      let stopLoss: string | null = null;
      try { stopLoss = session.snapshot ? String(JSON.parse(session.snapshot).stopLossPrice ?? '') : null; } catch { /* 無策略快照時不猜停損價。 */ }
      for (const [price, color] of [[session.averageEntry, '#2563eb'], [session.averageExit, '#a855f7'], [stopLoss, '#e11d48']] as const) {
        if (!price || !Number.isFinite(Number(price)) || Number(price) <= 0) continue;
        const drawing = workspace.chart.drawings.add('trendline', { anchors: [{ time: payload.from, price: Number(price) }, { time: payload.to, price: Number(price) }], style: { lineColor: color, lineWidth: 1 } });
        if (drawing) workspace.chart.drawings.update(drawing.id, { locked: true });
      }
      workspace.chart.setVisibleRange({ from: payload.from, to: payload.to });
      setLoading(false);
    })().catch(reason => { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : '圖表無法載入'); setLoading(false); } });
    return () => { abort.abort(); workspace?.destroy(); workspaceRef.current = null; chartDataRef.current = null; };
  }, [accountId, session]);
  useEffect(() => {
    const workspace = workspaceRef.current, data = chartDataRef.current;
    if (!workspace || !data) return;
    const bars = replaying ? data.bars.slice(0, replayIndex + 1) : data.bars;
    let active = true;
    /** 重播截掉未來 K 線與成交標記，避免用未來訊號解釋當時決策；完整均價線在重播時隱藏。 */
    for (const drawing of workspace.chart.drawings.all()) workspace.chart.drawings.update(drawing.id, { visible: !replaying });
    void workspace.chart.setMarket({ symbol: session.symbol, timeframe: data.timeframe, data: bars }).then(() => {
      const interval = data.timeframe === '1D' ? 86_400_000 : data.timeframe === '4H' ? 14_400_000 : 3_600_000;
      if (active) renderMarks(workspace.chart, session, replaying ? bars.at(-1)!.time + interval - 1 : undefined);
    }).catch(() => { if (active) setError('重播行情更新未完成'); });
    return () => { active = false; };
  }, [replaying, replayIndex, session]);
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
      <span>Bitget 公開合約 K 線 · UTC · EMA20 參考 · 藍：進場／紫：平倉／紅：原停損</span>
      <button type="button" disabled={!barCount} onClick={() => { setReplaying(value => !value); setReplayIndex(0); }} className="rounded border px-3 py-1 disabled:opacity-40">{replaying ? '回到完整圖' : '逐根重播'}</button>
      {replaying && <label className="flex items-center gap-2">K 線 {replayIndex + 1}/{barCount}<input aria-label="重播進度" type="range" min={0} max={Math.max(0, barCount - 1)} value={replayIndex} onChange={event => setReplayIndex(Number(event.target.value))} /></label>}
    </div>
    {truncated && <p className="text-xs text-amber-700">歷史行情不足以涵蓋開倉時間，請以成交明細復盤。</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {loading && <p role="status" className="text-sm text-gray-500">正在取得此倉位的 Bitget 歷史行情…</p>}
    <div ref={container} className="h-[560px] w-full overflow-hidden rounded-lg bg-white" aria-label={`${session.symbol} 倉位復盤圖`} />
  </div>;
}
function renderMarks(chart: VelaWorkspace['chart'], session: Session, until = Infinity) {
  chart.marks.set(session.fills.filter(fill => fill.executedAt <= until).map((fill, index) => ({
    id: `${session.id}:${fill.exchangeId}:${index}`, time: fill.executedAt,
    title: `${fill.effect === 'open' ? '開倉' : fill.effect === 'close' ? '平倉' : '成交'} ${fill.quantity} @ ${fill.price}`,
    glyph: { shape: 'pin' as const, color: fill.side === 'buy' ? '#2563eb' : '#a855f7', letter: fill.side === 'buy' ? 'B' : 'S' },
    content: { text: `成交 ID：${fill.exchangeId}\n費用：${fill.fees?.map(fee => `${fee.amount} ${fee.coin}`).join('、') ?? '尚未取得'}` },
  })));
}
