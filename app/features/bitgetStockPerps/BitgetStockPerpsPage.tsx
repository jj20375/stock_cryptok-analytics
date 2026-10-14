/** @file Bitget 股票永續分析頁；重用首頁策略與 Vela 圖表，純行情研究不含下單。 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw, TrendingUp } from 'lucide-react';
import { Link, useRouteLoaderData } from 'react-router';
import { AppLayout } from '../../components/AppLayout';
import { StrategyLayerPanel } from '../home/components/StrategyLayerPanel';
import { VelaChart } from '../home/components/VelaChart';
import { useStrategyLayers } from '../home/use-strategy-layers';
import type { StockDataPoint, Timeframe } from '../../types';
import { listStockPerpContracts, loadStockPerpAnalysis, type StockPerpAnalysis, type StockPerpContract } from '../../services/bitgetStockPerps/market';
import { StockPerpHotPicks, STOCK_PERP_TIMEFRAME_LABELS } from './StockPerpHotPicks';
import { StockPerpChartRangePanel } from './StockPerpChartRangePanel';
import { selectStockPerpChartRange, STOCK_PERP_DEFAULT_RANGES, type StockPerpChartRange } from './chart-range';

function price(value: number | null | undefined) {
  return value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export default function BitgetStockPerpsPage() {
  /** 沿用登入身分決定是否補上 AI 解讀；公開技術掃描不需要帳戶金鑰。 */
  const user = useRouteLoaderData<{ user: { email: string } | null }>('root')?.user;
  const [contracts, setContracts] = useState<StockPerpContract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(true);
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  /** 各週期保留觀看偏好，切換短週期時不沿用不適用的一年日線範圍。 */
  const [chartRanges, setChartRanges] = useState(STOCK_PERP_DEFAULT_RANGES);
  const [analysis, setAnalysis] = useState<StockPerpAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  /** 清單未載入時仍可手動重試，避免無商品代號就永久停用重新整理。 */
  const [contractRefresh, setContractRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setContractsLoading(true); setError(null);
    void listStockPerpContracts(controller.signal).then(rows => {
      if (!cancelled) {
        setContracts(rows);
        setSymbol(rows.find(row => row.symbol === 'AAPLUSDT')?.symbol ?? rows[0]?.symbol ?? '');
        if (!rows.length) setError('Bitget 目前沒有回傳可交易的 USDT 股票永續商品。');
      }
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Bitget 商品清單讀取失敗');
    }).finally(() => { if (!cancelled) setContractsLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [contractRefresh]);

  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    setAnalysis(null);
    setLoading(true);
    setError(null);
    void loadStockPerpAnalysis(symbol, timeframe, controller.signal)
      .then(result => { if (!controller.signal.aborted) setAnalysis(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Bitget 行情讀取失敗'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [symbol, timeframe, refresh]);

  const chartData = useMemo<StockDataPoint[]>(() => (analysis?.candles ?? []).map(candle => ({
    date: new Date(candle.openTime).toISOString().slice(0, 10), timestamp: candle.openTime,
    price: candle.close, open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    volume: candle.volume, currency: 'USDT', isMock: false,
  })), [analysis]);
  /** 完整資料持續供策略暖機；觀看裁切不重新計算全部歷史或觸發 API。 */
  const chartSelection = useMemo(() => selectStockPerpChartRange(chartData, timeframe, chartRanges[timeframe]),
    [chartData, timeframe, chartRanges]);
  /** 股票永續頁先顯示趨勢與未破警示；其他首頁策略可由圖層開關重用。 */
  const layers = useStrategyLayers(chartData, chartSelection.data, 'US', timeframe, ['trend', 'volume_no_break'], true);
  const activeLayers = useMemo(() => layers.strategyLayers.filter(layer => layers.enabledStrategyLayers.includes(layer.strategyId)),
    [layers.strategyLayers, layers.enabledStrategyLayers]);
  const activeSignalCount = activeLayers.reduce((sum, layer) => sum + layer.events.length, 0);

  return (
    <AppLayout>
      <main className="min-h-screen bg-[#080d16] p-4 text-slate-100 md:p-6">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
            <div className="flex items-center gap-3">
              <TrendingUp className="text-cyan-400" />
              <div>
                <h1 className="text-xl font-bold">Bitget 股票合約分析</h1>
                <p className="text-xs text-slate-400">USDT 永續・Bitget 公開行情・重用首頁策略・已收盤 K</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/" className="inline-flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm hover:border-cyan-400 hover:text-cyan-300">
                <ArrowLeft size={16} />回到首頁
              </Link>
              <label htmlFor="stock-perp-symbol" className="text-xs text-slate-400">股票合約</label>
              <select id="stock-perp-symbol" value={symbol} onChange={event => setSymbol(event.target.value)}
                disabled={!contracts.length} className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm">
                {contracts.map(contract => <option key={contract.symbol} value={contract.symbol}>{contract.baseCoin} · {contract.symbol}</option>)}
              </select>
              <select aria-label="股票合約圖表週期" value={timeframe} onChange={event => setTimeframe(event.target.value as Timeframe)}
                className="rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm">
                {(Object.keys(STOCK_PERP_TIMEFRAME_LABELS) as Timeframe[]).map(value => <option key={value} value={value}>{STOCK_PERP_TIMEFRAME_LABELS[value]}</option>)}
              </select>
              <button type="button" onClick={() => contracts.length ? setRefresh(value => value + 1) : setContractRefresh(value => value + 1)} disabled={loading || contractsLoading}
                className="rounded border border-slate-600 p-2 disabled:opacity-50" aria-label="重新整理行情">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </header>

          {(error || (contractsLoading && !analysis)) && (
            <div role="alert" className="flex items-start gap-2 rounded border border-rose-700 bg-rose-950/50 p-4 text-sm text-rose-200">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              {error ?? '正在讀取 Bitget 股票永續清單…'}
            </div>
          )}

          <StockPerpHotPicks contracts={contracts} selectedSymbol={symbol} aiEnabled={!!user} onSelect={(nextSymbol, nextTimeframe) => {
            setSymbol(nextSymbol); setTimeframe(nextTimeframe);
            /** 候選點選只定位圖表，不自動開倉；小時線預設顯示支援該週期的兩個共用策略。 */
            if (nextTimeframe !== '1d') layers.setEnabledStrategyLayers(['big_fish', 'extreme_reversal']);
            document.getElementById('stock-perp-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }} />

          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['最新成交價', price(analysis?.lastPrice), 'USDT'],
              ['標記價格', price(analysis?.markPrice), 'USDT'],
              ['24H 高 / 低', `${price(analysis?.high24h)} / ${price(analysis?.low24h)}`, 'USDT'],
              ['資金費率', analysis?.fundingRate == null ? '—' : `${(analysis.fundingRate * 100).toFixed(4)}%`, analysis?.fundingIntervalHours ? `每 ${analysis.fundingIntervalHours} 小時` : ''],
              ['商品槓桿上限', analysis?.contract.maxLeverage ? `${analysis.contract.maxLeverage}×` : '—', '依 Bitget 商品規格'],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded border border-slate-700 bg-slate-900/80 p-4">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="mt-2 text-lg font-bold tabular-nums">{value}</div>
                <div className="mt-1 text-[10px] text-slate-500">{hint}</div>
              </div>
            ))}
          </section>

          <StockPerpChartRangePanel timeframe={timeframe} range={chartRanges[timeframe]} visibleData={chartSelection.data}
            totalCount={chartData.length} truncated={chartSelection.truncated} loading={loading || contractsLoading}
            onTimeframeChange={setTimeframe} onRangeChange={(range: StockPerpChartRange) => setChartRanges(previous => ({ ...previous, [timeframe]: range }))} />

          <section className="rounded border border-slate-700 bg-slate-900/70 p-4">
            <StrategyLayerPanel strategyLayers={layers.strategyLayers} allStrategyLayers={layers.allStrategyLayers}
              enabledStrategyLayers={layers.enabledStrategyLayers} activeStrategySignalCount={activeSignalCount}
              totalStrategySignalCount={layers.totalStrategySignalCount} onToggleStrategyLayer={layers.toggleStrategyLayer}
              onSetEnabledStrategyLayers={layers.setEnabledStrategyLayers} />
          </section>

          <section id="stock-perp-chart" className="h-[78vh] min-h-[680px] overflow-hidden rounded border border-slate-700 bg-white">
            {(contractsLoading || (loading && !analysis)) ? <div className="flex h-full items-center justify-center gap-2 text-slate-500"><RefreshCw className="animate-spin" size={18} />載入 Bitget 行情…</div>
              : analysis && <VelaChart market="CRYPTO" symbol={symbol} timeframe={timeframe} data={chartData}
                visibleRange={chartSelection.visibleRange}
                strategyLayers={activeLayers} allStrategyLayers={layers.allStrategyLayers}
                enabledStrategyLayerIds={layers.enabledStrategyLayers} />}
          </section>

          <p className="text-xs leading-relaxed text-slate-400">
            共用首頁既有策略模組與預設參數，圖層目前 {activeSignalCount} 個歷史訊號；Bitget 日線為 UTC 日線。此頁只讀公開行情與研究訊號，不需 API 金鑰、不會送單；訊號不是保證成交或獲利的建議。
          </p>
        </div>
      </main>
    </AppLayout>
  );
}
