/** @file 台股雷達 K 線抽屜；以 Yahoo 1h 合成台股 4h，並標出經典吃大魚訊號。 */
import { useEffect, useRef, useState } from 'react';
import { BarChart3, LoaderCircle, X } from 'lucide-react';
import { dispose, init, type Chart } from 'klinecharts';
import { bigFishLabel } from '../../services/potentialRadar/bigFish';
import { aggregateTwStockFourHourCandles, twStockHourlyClosedAt } from '../../services/twStockRadar/candles';
import type { TwStockCandle, TwStockSnapshot } from '../../services/twStockRadar/types';

type ChartInterval = '4h' | '1d';
const OVERLAY_GROUP_ID = 'tw-stock-big-fish';

function parseYahooCandles(payload: any, interval: ChartInterval): TwStockCandle[] {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) throw new Error('Yahoo 圖表資料格式異常');
  const raw = result.timestamp.map((seconds: number, index: number) => ({
    openTime: seconds * 1000,
    closeTime: interval === '4h' ? twStockHourlyClosedAt(seconds * 1000) : seconds * 1000 + 5 * 60 * 60 * 1000,
    open: quote.open?.[index], high: quote.high?.[index], low: quote.low?.[index],
    close: quote.close?.[index], volume: quote.volume?.[index] ?? 0,
  })).filter((candle: TwStockCandle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.closeTime! <= Date.now());
  return interval === '4h' ? aggregateTwStockFourHourCandles(raw) : raw;
}

function drawBigFishMarker(chart: Chart, snapshot: TwStockSnapshot, candles: TwStockCandle[], interval: ChartInterval) {
  try {
    chart.removeOverlay({ groupId: OVERLAY_GROUP_ID });
    const fish = snapshot.signal?.bigFish;
    if (!fish?.entry || interval !== '4h') return;
    const candle = candles.find(item => item.openTime === fish.barTime);
    if (!candle) return;
    chart.createOverlay([{
      name: 'simpleAnnotation', groupId: OVERLAY_GROUP_ID, lock: true, zLevel: 20,
      points: [{ timestamp: fish.barTime, value: Math.max(candle.low - candle.close * 0.006, 0) }],
      extendData: '▲ 經典吃大魚',
      styles: { polygon: { color: '#22c55e', borderColor: '#22c55e' },
        text: { color: '#fff', size: 10, backgroundColor: '#16a34a', borderColor: '#16a34a', paddingLeft: 4, paddingRight: 4 } },
    }] as any, 'main');
  } catch (error) { console.error('[TW Stock Radar Chart] 訊號標記失敗:', error); }
}

export function TwStockChartDrawer({ snapshot, onClose }: { snapshot: TwStockSnapshot | null; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [interval, setInterval] = useState<ChartInterval>('4h');
  const [candles, setCandles] = useState<TwStockCandle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (snapshot) { setInterval('4h'); setCandles([]); setError(null); } }, [snapshot?.symbol]);
  useEffect(() => {
    if (!snapshot) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    const yahooInterval = interval === '4h' ? '1h' : '1d';
    fetch(`/api/stock/${encodeURIComponent(snapshot.symbol)}?range=1y&interval=${yahooInterval}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 ? '登入已過期，請重新登入。' : 'Yahoo 台股 K 線暫時無法取得。');
        return parseYahooCandles(await response.json(), interval);
      }).then(setCandles).catch(requestError => {
        if (requestError.name !== 'AbortError') setError(requestError.message || '圖表讀取失敗。');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [snapshot, interval]);

  useEffect(() => {
    if (!snapshot || !containerRef.current) return;
    const chart = init(containerRef.current);
    chartRef.current = chart;
    chart.setStyles({
      grid: { horizontal: { show: true, color: '#334155' }, vertical: { show: false } },
      /** 台股介面採紅漲綠跌，符合本地市場習慣。 */
      candle: { type: 'candle_solid' as any, bar: { upColor: '#ef4444', downColor: '#22c55e', noChangeColor: '#94a3b8' },
        tooltip: { showRule: 'always' as any, showType: 'standard' as any } },
    } as any);
    chart.createIndicator({ name: 'EMA', calcParams: interval === '4h' ? [12, 26, 200] : [20, 50] }, false, { id: 'main' } as any);
    chart.createIndicator('VOL', false, { id: 'tw_stock_volume' } as any);
    chart.createIndicator('MACD', false, { id: 'tw_stock_macd' } as any);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); if (containerRef.current) dispose(containerRef.current); chartRef.current = null; };
  }, [snapshot?.symbol, interval]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !snapshot || !candles.length) return;
    chart.applyNewData(candles.map(candle => ({ timestamp: candle.openTime, open: candle.open, high: candle.high,
      low: candle.low, close: candle.close, volume: candle.volume })));
    drawBigFishMarker(chart, snapshot, candles, interval);
    chart.resize();
  }, [candles, interval, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [snapshot, onClose]);

  if (!snapshot?.signal) return null;
  const signal = snapshot.signal;
  return <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${snapshot.symbol} K 線圖`}>
    <button aria-label="關閉 K 線圖" className="absolute inset-0 h-full w-full bg-black/65" onClick={onClose} />
    <aside className="absolute right-0 top-0 flex h-[100dvh] w-full max-w-5xl flex-col border-l border-slate-700 bg-[#0e1725] text-[#e5edf9] shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-4 md:px-6">
        <div><p className="text-xs tracking-widest text-slate-400">TAIWAN STOCK RADAR · YAHOO FINANCE</p>
          <h2 className="mt-1 text-2xl font-bold">{snapshot.symbol.replace(/\.(TW|TWO)$/i, '')}<span className="ml-2 text-sm font-normal text-slate-400">{snapshot.name}</span></h2>
          <p className="mt-1 text-xs text-slate-400">{bigFishLabel(signal.bigFish)}</p></div>
        <button aria-label="關閉" onClick={onClose} className="rounded border border-slate-600 p-2"><X size={20} /></button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 md:px-6">
        <div className="flex gap-2">{([['4h', '4H'], ['1d', '1D']] as const).map(([value, label]) =>
          <button key={value} onClick={() => setInterval(value)} aria-pressed={interval === value}
            className={`rounded border px-4 py-2 text-xs ${interval === value ? 'border-cyan-400 bg-cyan-950' : 'border-slate-600'}`}>{label}</button>)}</div>
        <p className="text-xs text-slate-400">4H EMA12／26／200 · MACD · 成交量｜1D EMA20／50</p>
      </div>
      <div className="grid grid-cols-2 gap-3 border-b border-slate-700 px-4 py-3 text-sm md:grid-cols-4 md:px-6">
        <div><p className="text-xs text-slate-400">訊號收盤</p><strong>NT${signal.price.toFixed(2)}</strong></div>
        <div><p className="text-xs text-slate-400">品質分數</p><strong>{signal.score}/100</strong></div>
        <div><p className="text-xs text-slate-400">Supertrend 防守線</p><strong>NT${signal.bigFish.supertrend.toFixed(2)}</strong></div>
        <div><p className="text-xs text-slate-400">EMA200</p><strong>NT${signal.bigFish.ema200.toFixed(2)}</strong></div>
      </div>
      <div className="relative min-h-0 flex-1 p-3 md:p-5"><div ref={containerRef} className="h-full min-h-[360px] w-full" />
        {loading && <div className="absolute inset-0 grid place-items-center bg-[#0e1725]/75"><span className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />讀取已收盤 K 線…</span></div>}
        {error && <div role="alert" className="absolute inset-4 grid place-items-center rounded border border-amber-500 bg-[#0e1725]/95 p-5 text-amber-100">{error}</div>}
      </div>
      <footer className="border-t border-slate-700 px-4 py-3 text-xs text-slate-400"><span className="inline-flex items-center gap-1"><BarChart3 size={14} />只使用台股正常交易時段已收盤 K 線；4 小時圖會標出本次經典吃大魚進場。</span></footer>
    </aside>
  </div>;
}
