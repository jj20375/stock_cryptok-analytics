/** @file 潛力幣圖表抽屜；沿用首頁 K 線與指標操作，但只呈現雷達鎖定交易所的收盤資料。 */
import { useEffect, useRef, useState } from 'react';
import { BarChart3, LoaderCircle, X } from 'lucide-react';
import { dispose, init, type Chart } from 'klinecharts';
import { bigFishLabel } from '../../services/potentialRadar/bigFish';
import type { RadarSnapshot } from '../../services/potentialRadar/types';
import type { PotentialChartInterval, PotentialChartSource } from '../../services/potentialRadar/chartRequest';
import { fetchPotentialChart, type PotentialChartData } from './chartApi';
import { DerivativesPanel } from './DerivativesPanel';

const CHART_INTERVALS: Array<{ value: PotentialChartInterval; label: string }> = [
  { value: '15m', label: '15M' }, { value: '1h', label: '60M' },
  { value: '4h', label: '4H' }, { value: '1d', label: '1D' },
];
const OVERLAY_GROUP_ID = 'potential-radar-big-fish';
const formatPrice = (value: number) => value.toLocaleString('en-US', { maximumSignificantDigits: 8 });
const sourceLabel = (source: PotentialChartSource) => source === 'GATE_SPOT' ? 'Gate 現貨' : 'Bybit 現貨';

interface PotentialChartDrawerProps {
  snapshot: RadarSnapshot | null;
  onClose: () => void;
}

/** 將雷達卡片的當根訊號標在 15 分 K 線；切到較大週期時仍保留文字說明，避免錯位標記。 */
function drawBigFishMarker(chart: Chart, snapshot: RadarSnapshot, data: PotentialChartData | null) {
  try {
    chart.removeOverlay({ groupId: OVERLAY_GROUP_ID });
    const fish = snapshot.signal?.bigFish;
    if (!fish?.entry || data?.interval !== '15m') return;
    const candle = data.candles.find(item => item.openTime === fish.barTime);
    if (!candle) return;
    chart.createOverlay([{
      name: 'simpleAnnotation', groupId: OVERLAY_GROUP_ID, lock: true, zLevel: 20,
      points: [{ timestamp: fish.barTime, value: Math.max(candle.low - candle.close * 0.006, 0) }],
      extendData: '▲ 吃大魚進場',
      styles: {
        line: { color: '#22c55e', size: 2, style: 'solid' },
        polygon: { color: '#22c55e', borderColor: '#22c55e', borderSize: 1, style: 'fill' },
        text: { color: '#ffffff', size: 10, family: 'monospace', weight: 700, backgroundColor: '#22c55e', borderColor: '#22c55e', borderSize: 1, borderRadius: 2, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
      },
    }] as any, 'main');
  } catch (error) {
    console.error('[PotentialRadar Chart] 訊號標記失敗:', error);
  }
}

export function PotentialChartDrawer({ snapshot, onClose }: PotentialChartDrawerProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [interval, setInterval] = useState<PotentialChartInterval>('15m');
  const [chartData, setChartData] = useState<PotentialChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEma, setShowEma] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showMacd, setShowMacd] = useState(true);

  useEffect(() => {
    if (!snapshot) return;
    /** 每次選擇新標的回到策略原生的 15 分週期，避免把舊週期誤當成訊號時間框架。 */
    setInterval('15m');
    setChartData(null);
    setError(null);
  }, [snapshot?.symbol]);

  useEffect(() => {
    if (!snapshot) return;
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [snapshot, onClose]);

  const source = (snapshot?.signal?.source ?? 'BYBIT_SPOT') as PotentialChartSource;

  useEffect(() => {
    if (!snapshot?.signal) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchPotentialChart({ symbol: snapshot.symbol, source, interval }, controller.signal)
      .then(setChartData)
      .catch(requestError => {
        if (requestError.name !== 'AbortError') setError(requestError.message || '圖表行情暫時無法取得。');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [snapshot, interval, source]);

  useEffect(() => {
    if (!snapshot || !chartContainerRef.current) return;
    const chart = init(chartContainerRef.current);
    chartRef.current = chart;
    chart.setStyles({
      grid: { horizontal: { show: true, color: '#334155' }, vertical: { show: false } },
      candle: {
        type: 'candle_solid' as any,
        bar: { upColor: '#ef4444', downColor: '#22c55e', noChangeColor: '#94a3b8' },
        tooltip: { showRule: 'always' as any, showType: 'standard' as any },
      },
      indicator: { tooltip: { showRule: 'always' as any, showType: 'standard' as any } },
    } as any);
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartContainerRef.current);
    return () => {
      resizeObserver.disconnect();
      if (chartContainerRef.current) dispose(chartContainerRef.current);
      chartRef.current = null;
    };
  }, [snapshot?.symbol]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartData) return;
    chart.applyNewData(chartData.candles.map(candle => ({
      timestamp: candle.openTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume,
    })));
    chart.resize();
  }, [chartData]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      /** EMA200 是吃大魚的趨勢濾網，同時保留首頁熟悉的 EMA12／26 方便對照 MACD。 */
      if (showEma) chart.createIndicator({ name: 'EMA', calcParams: [12, 26, 200] }, false, { id: 'main' } as any);
      else chart.removeIndicator('main', 'EMA');
      if (showVolume) {
        chart.createIndicator('VOL', false, { id: 'potential_volume' } as any);
        chart.setPaneOptions({ id: 'potential_volume', height: 84, minHeight: 56 });
      } else chart.removeIndicator('potential_volume', 'VOL');
      if (showMacd) {
        chart.createIndicator('MACD', false, { id: 'potential_macd' } as any);
        chart.setPaneOptions({ id: 'potential_macd', height: 84, minHeight: 56 });
      } else chart.removeIndicator('potential_macd', 'MACD');
      chart.resize();
    } catch (indicatorError) {
      console.error('[PotentialRadar Chart] 指標更新失敗:', indicatorError);
    }
  }, [showEma, showVolume, showMacd, snapshot?.symbol]);

  useEffect(() => {
    if (chartRef.current && snapshot) drawBigFishMarker(chartRef.current, snapshot, chartData);
  }, [snapshot, chartData]);

  if (!snapshot?.signal) return null;
  const signal = snapshot.signal;
  const latest = chartData?.candles.at(-1);
  const previous = chartData?.candles.at(-2);
  const change = latest && previous ? (latest.close / previous.close - 1) * 100 : null;

  return <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${snapshot.symbol} K 線圖`}>
    <button aria-label="關閉 K 線圖" className="absolute inset-0 h-full w-full bg-black/65" onClick={onClose} />
    <aside className="absolute right-0 top-0 flex h-[100dvh] w-full max-w-5xl flex-col border-l border-slate-700 bg-[#0e1725] text-[#e5edf9] shadow-2xl">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700 px-4 py-4 md:px-6">
        <div><p className="text-xs tracking-widest text-slate-400">POTENTIAL RADAR · {sourceLabel(source)}</p>
          <h2 className="mt-1 text-2xl font-bold">{snapshot.symbol.replace(/USDT$/, '')}<span className="ml-2 text-sm font-normal text-slate-400">／USDT</span></h2>
          <p className="mt-1 text-xs text-slate-400">{signal.bigFish ? bigFishLabel(signal.bigFish) : '吃大魚訊號尚未計算'}</p></div>
        <button aria-label="關閉" onClick={onClose} className="rounded-md border border-slate-600 p-2 text-slate-200 hover:bg-slate-800"><X size={20} /></button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 md:px-6">
        <div className="flex flex-wrap gap-2" aria-label="K 線週期">{CHART_INTERVALS.map(item =>
          <button key={item.value} onClick={() => setInterval(item.value)} aria-pressed={interval === item.value}
            className={`rounded border px-3 py-2 text-xs font-semibold ${interval === item.value ? 'border-cyan-400 bg-cyan-950 text-cyan-100' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}>{item.label}</button>)}</div>
        <div className="flex flex-wrap gap-2" aria-label="圖表指標">
          <button onClick={() => setShowEma(!showEma)} aria-pressed={showEma} className={`rounded border px-3 py-2 text-xs ${showEma ? 'border-amber-400 text-amber-200' : 'border-slate-600 text-slate-400'}`}>EMA 12／26／200</button>
          <button onClick={() => setShowVolume(!showVolume)} aria-pressed={showVolume} className={`rounded border px-3 py-2 text-xs ${showVolume ? 'border-emerald-400 text-emerald-200' : 'border-slate-600 text-slate-400'}`}>成交量</button>
          <button onClick={() => setShowMacd(!showMacd)} aria-pressed={showMacd} className={`rounded border px-3 py-2 text-xs ${showMacd ? 'border-violet-400 text-violet-200' : 'border-slate-600 text-slate-400'}`}>MACD</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 border-b border-slate-700 px-4 py-3 text-sm md:grid-cols-4 md:px-6">
        <div><p className="text-xs text-slate-400">最新收盤</p><strong>{latest ? formatPrice(latest.close) : '—'}</strong></div>
        <div><p className="text-xs text-slate-400">本根漲跌</p><strong className={change != null && change < 0 ? 'text-emerald-400' : 'text-rose-400'}>{change == null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`}</strong></div>
        <div><p className="text-xs text-slate-400">15M 動態防守線 ST</p><strong>{signal.bigFish ? formatPrice(signal.bigFish.supertrend) : '—'}</strong></div>
        <div><p className="text-xs text-slate-400">15M EMA200</p><strong>{signal.bigFish ? formatPrice(signal.bigFish.ema200) : '—'}</strong></div>
      </div>
      <div className="border-b border-slate-700 px-4 py-3 dark md:px-6"><DerivativesPanel derivatives={signal.derivatives} compact /></div>
      <div className="relative min-h-0 flex-1 p-3 md:p-5">
        <div ref={chartContainerRef} className="h-full min-h-[360px] w-full" />
        {loading && <div className="absolute inset-0 grid place-items-center bg-[#0e1725]/75 text-sm text-slate-300"><span className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />讀取已收盤 K 線…</span></div>}
        {error && <div role="alert" className="absolute inset-4 grid place-items-center rounded border border-amber-500/60 bg-[#0e1725]/95 p-5 text-center text-sm text-amber-100">{error}</div>}
      </div>
      <footer className="border-t border-slate-700 px-4 py-3 text-xs text-slate-400 md:px-6"><span className="inline-flex items-center gap-1"><BarChart3 size={14} />15 分圖會標出吃大魚進場；其他週期只供趨勢對照。K 線皆為 {sourceLabel(source)} 已收盤資料。</span></footer>
    </aside>
  </div>;
}
