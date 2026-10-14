/** @component 首頁行情卡片與共用圖表控制列；觀看資料與完整策略圖層由 route 提供。 */
import { Activity, RefreshCw, Search, Star } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '../../../utils/cn';
import { VelaChart } from './VelaChart';
import { StrategyLayerPanel } from './StrategyLayerPanel';
import { MarketQuoteCards } from './MarketQuoteCards';
import { ChartRangePanel, CHART_TIMEFRAME_LABELS } from '../../../components/ChartRangePanel';
import { MARKET_CHART_TIMEZONES } from '../../../utils/chartDate';
import type {
  MarketKey,
  PortfolioStock,
  StockDataPoint,
  StockOption,
  StrategyOverlayId,
  StrategyOverlayLayer,
  Timeframe,
} from '../types';

interface MainChartPanelProps {
  market: MarketKey;
  selectedStock: StockOption;
  user: unknown;
  portfolio: PortfolioStock[];
  isAddingToPortfolio: boolean;
  latestData: StockDataPoint | null;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  filteredData: StockDataPoint[];
  allData: StockDataPoint[];
  loading: boolean;
  isAiAnalyzing: boolean;
  timeframe: Timeframe;
  timeRange: string;
  strategyLayers: StrategyOverlayLayer[];
  allStrategyLayers: StrategyOverlayLayer[];
  enabledStrategyLayers: StrategyOverlayId[];
  activeStrategySignalCount: number;
  totalStrategySignalCount: number;
  onTimeframeChange: (timeframe: Timeframe) => void;
  onTimeRangeChange: (range: string) => void;
  onToggleStrategyLayer: (strategyId: StrategyOverlayId) => void;
  onSetEnabledStrategyLayers: (strategyIds: StrategyOverlayId[]) => void;
  onAddToPortfolio: (stock: StockOption) => void;
  onRemoveFromPortfolio: (symbol: string) => void;
}

export function MainChartPanel({
  market,
  selectedStock,
  user,
  portfolio,
  isAddingToPortfolio,
  latestData,
  currentPrice,
  priceChange,
  priceChangePercent,
  filteredData,
  allData,
  loading,
  isAiAnalyzing,
  timeframe,
  timeRange,
  strategyLayers,
  allStrategyLayers,
  enabledStrategyLayers,
  activeStrategySignalCount,
  totalStrategySignalCount,
  onTimeframeChange,
  onTimeRangeChange,
  onToggleStrategyLayer,
  onSetEnabledStrategyLayers,
  onAddToPortfolio,
  onRemoveFromPortfolio,
}: MainChartPanelProps) {
  const isInPortfolio = portfolio.some(item => item.symbol === selectedStock.symbol);
  /** 控制列需要全部策略，圖表只接收已啟用的圖層，避免關閉後仍畫出訊號與線條。 */
  const activeStrategyLayers = useMemo(
    () => strategyLayers.filter(layer => enabledStrategyLayers.includes(layer.strategyId)),
    [strategyLayers, enabledStrategyLayers]
  );
  /** 比照股票合約，切換範圍只定位時間軸；保留完整資料，避免短區間讓 EMA／SMA 暖機消失。 */
  const visibleRange = useMemo(() => {
    const first = filteredData[0], last = filteredData.at(-1);
    if (!first || !last) return undefined;
    const intervalMs = timeframe === '1d' ? 86_400_000 : timeframe === '4h' ? 14_400_000 : timeframe === '60m' ? 3_600_000 : 900_000;
    return { from: first.timestamp, to: last.timestamp + intervalMs * 2 };
  }, [filteredData, timeframe]);

  return (
    <div className="lg:col-span-3 flex flex-col gap-4">
      <MarketQuoteCards latestData={latestData} currentPrice={currentPrice} priceChange={priceChange}
        priceChangePercent={priceChangePercent} market={market} loading={loading} />
      <ChartRangePanel ariaLabel="首頁 K 線觀看範圍" timeframe={timeframe} range={timeframe === '1d' ? timeRange : 'ALL'}
        ranges={timeframe === '1d' ? [
          { value: '1M', label: '1個月' }, { value: '3M', label: '3個月' }, { value: '6M', label: '6個月' },
          { value: '1Y', label: '1年' }, { value: '2Y', label: '2年' }, { value: '5Y', label: '5年' }, { value: 'ALL', label: '全部' },
        ] : [{ value: 'ALL', label: '全部' }]}
        visibleData={filteredData} totalCount={allData.length} timezone={MARKET_CHART_TIMEZONES[market]} loading={loading}
        onTimeframeChange={onTimeframeChange} onRangeChange={onTimeRangeChange}
        availabilityHint="全部＝此週期已取得的資料；日線可切換觀看範圍，短週期顯示全部已載入 K 線。較長區間仍以行情來源實際提供的歷史資料為準。" />

      <div className="p-3 md:p-4 bg-white/50 border border-[#141414] rounded-sm">
        <StrategyLayerPanel
          strategyLayers={strategyLayers}
          allStrategyLayers={allStrategyLayers}
          enabledStrategyLayers={enabledStrategyLayers}
          activeStrategySignalCount={activeStrategySignalCount}
          totalStrategySignalCount={totalStrategySignalCount}
          onToggleStrategyLayer={onToggleStrategyLayer}
          onSetEnabledStrategyLayers={onSetEnabledStrategyLayers}
        />
      </div>

      {/* Vela 主圖保留足夠高度，讓工作區按容器尺寸分配價格圖與副圖。 */}
      <section className="border border-[#141414] p-3 md:p-4 bg-white min-h-[980px] md:min-h-[820px] h-[94vh] md:h-[92vh] max-h-[1500px] rounded-sm relative flex flex-col overflow-hidden">
        {isAiAnalyzing && (
          <div className="absolute inset-0 z-50 bg-[#141414]/80 backdrop-blur-sm flex flex-col items-center justify-center text-white p-8 text-center">
            <div className="relative mb-6">
              <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
              <Activity className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-indigo-400 animate-pulse" />
            </div>
            <h3 className="text-lg font-serif italic mb-2 tracking-widest uppercase">AI 智能深度分析中...</h3>
            <p className="text-xs opacity-60 max-w-xs leading-relaxed">
              正在利用 Gemini AI 分析技術指標趨勢、支撐壓力位與 K 線型態，為您挑選最具潛力的交易標的。
            </p>
            <div className="mt-8 flex gap-1">
              <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" />
            </div>
          </div>
        )}
        <div className="flex justify-between items-start mb-2">
          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold font-serif leading-none">{selectedStock.name}({selectedStock.symbol})</h2>
              {user && (
                <button
                  onClick={() => {
                    if (isInPortfolio) {
                      onRemoveFromPortfolio(selectedStock.symbol);
                    } else {
                      onAddToPortfolio(selectedStock);
                    }
                  }}
                  disabled={isAddingToPortfolio}
                  className={cn(
                    "p-1 rounded-full border transition-all",
                    isInPortfolio
                      ? "bg-amber-100 border-amber-300 text-amber-500"
                      : "border-[#141414]/10 hover:bg-[#141414]/5",
                    isAddingToPortfolio && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isAddingToPortfolio ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Star size={14} fill={isInPortfolio ? "currentColor" : "none"} />
                  )}
                </button>
              )}
            </div>
            <span className="text-[10px] font-mono opacity-50">顯示 {filteredData.length} 根 · {CHART_TIMEFRAME_LABELS[timeframe]}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 w-full relative">
          {filteredData.length === 0 && !loading && !isAiAnalyzing && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
              <Search className="w-12 h-12 text-[#141414]/20 mb-4" />
              <h3 className="text-xl font-serif italic text-[#141414]/60 mb-2">查無資料 (No Data Found)</h3>
              <p className="text-sm text-[#141414]/40 font-mono text-center max-w-md">
                無法取得 {selectedStock.symbol} 的歷史數據。<br />
                請確認代號是否正確，或嘗試切換時間週期。
              </p>
            </div>
          )}
          <VelaChart
            market={market}
            symbol={selectedStock.symbol}
            timeframe={timeframe}
            data={allData}
            visibleRange={visibleRange}
            strategyLayers={activeStrategyLayers}
            allStrategyLayers={allStrategyLayers}
            enabledStrategyLayerIds={enabledStrategyLayers}
          />
        </div>
      </section>
    </div>
  );
}
