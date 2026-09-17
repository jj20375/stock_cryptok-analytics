import { Activity, RefreshCw, Search, Star } from 'lucide-react';
import type { RefObject } from 'react';
import { cn } from '../../../utils/cn';
import { StrategyLayerPanel } from './StrategyLayerPanel';
import type {
  IndicatorVisibility,
  PortfolioStock,
  StockDataPoint,
  StockOption,
  StrategyOverlayId,
  StrategyOverlayLayer,
  Timeframe,
} from '../types';

interface MainChartPanelProps {
  selectedStock: StockOption;
  user: unknown;
  portfolio: PortfolioStock[];
  isAddingToPortfolio: boolean;
  latestData: StockDataPoint | null;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  filteredData: StockDataPoint[];
  loading: boolean;
  isAiAnalyzing: boolean;
  timeframe: Timeframe;
  timeRange: string;
  showIndicators: IndicatorVisibility;
  strategyLayers: StrategyOverlayLayer[];
  allStrategyLayers: StrategyOverlayLayer[];
  enabledStrategyLayers: StrategyOverlayId[];
  activeStrategySignalCount: number;
  totalStrategySignalCount: number;
  chartContainerRef: RefObject<HTMLDivElement>;
  onTimeframeChange: (timeframe: Timeframe) => void;
  onTimeRangeChange: (range: string) => void;
  onToggleIndicator: (key: keyof IndicatorVisibility) => void;
  onToggleStrategyLayer: (strategyId: StrategyOverlayId) => void;
  onSetEnabledStrategyLayers: (strategyIds: StrategyOverlayId[]) => void;
  onAddToPortfolio: (stock: StockOption) => void;
  onRemoveFromPortfolio: (symbol: string) => void;
}

export function MainChartPanel({
  selectedStock,
  user,
  portfolio,
  isAddingToPortfolio,
  latestData,
  currentPrice,
  priceChange,
  priceChangePercent,
  filteredData,
  loading,
  isAiAnalyzing,
  timeframe,
  timeRange,
  showIndicators,
  strategyLayers,
  allStrategyLayers,
  enabledStrategyLayers,
  activeStrategySignalCount,
  totalStrategySignalCount,
  chartContainerRef,
  onTimeframeChange,
  onTimeRangeChange,
  onToggleIndicator,
  onToggleStrategyLayer,
  onSetEnabledStrategyLayers,
  onAddToPortfolio,
  onRemoveFromPortfolio,
}: MainChartPanelProps) {
  const isInPortfolio = portfolio.some(item => item.symbol === selectedStock.symbol);

  return (
    <div className="lg:col-span-3 flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-[#141414] pb-2 bg-white/80 p-3 md:p-4 rounded-sm gap-3">
        <div className="flex flex-wrap items-center gap-4 md:gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono opacity-50 uppercase">Date</span>
            <span className="text-xs font-mono font-bold">{latestData?.date}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono opacity-50 uppercase">Price</span>
            <span className={cn("text-lg md:xl font-mono font-bold", priceChange >= 0 ? "text-rose-500" : "text-emerald-500")}>
              {currentPrice.toFixed(2)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono opacity-50 uppercase">Change</span>
            <span className={cn("text-xs font-mono font-bold", priceChange >= 0 ? "text-rose-500" : "text-emerald-500")}>
              {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)} ({Math.abs(priceChangePercent).toFixed(2)}%)
            </span>
          </div>
          <div className="hidden md:flex flex-col">
            <span className="text-[10px] font-mono opacity-50 uppercase">Open</span>
            <span className="text-xs font-mono font-bold">{latestData?.open.toFixed(2)}</span>
          </div>
          <div className="hidden md:flex flex-col">
            <span className="text-[10px] font-mono opacity-50 uppercase">High</span>
            <span className="text-xs font-mono font-bold">{latestData?.high.toFixed(2)}</span>
          </div>
          <div className="hidden md:flex flex-col">
            <span className="text-[10px] font-mono opacity-50 uppercase">Low</span>
            <span className="text-xs font-mono font-bold">{latestData?.low.toFixed(2)}</span>
          </div>
          <div className="hidden md:flex flex-col">
            <span className="text-[10px] font-mono opacity-50 uppercase">Volume</span>
            <span className="text-xs font-mono font-bold">{latestData?.volume.toLocaleString()}</span>
          </div>
        </div>

        <div className="w-full overflow-x-auto custom-scrollbar md:overflow-visible">
          <div className="flex gap-1 items-center min-w-max md:min-w-0 pb-1 md:pb-0">
            <div className="flex gap-1 border-r border-[#141414]/20 pr-2 mr-2 flex-shrink-0">
              {(['15m', '60m', '4h', '1d'] as Timeframe[]).map((option) => (
                <button
                  key={option}
                  onClick={() => onTimeframeChange(option)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-mono border border-[#141414] transition-all rounded-sm flex-shrink-0",
                    timeframe === option ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                  )}
                >
                  {option === '1d' ? '1D' : option === '60m' ? '60M' : option === '4h' ? '4H' : option.toUpperCase()}
                </button>
              ))}
            </div>
            {timeframe === '1d' && (
              <div className="flex gap-1 flex-shrink-0">
                {['1M', '3M', '6M', '1Y', '2Y', '5Y'].map((range) => (
                  <button
                    key={range}
                    onClick={() => onTimeRangeChange(range)}
                    className={cn(
                      "px-2 py-1 text-[10px] font-mono border border-[#141414] transition-all rounded-sm flex-shrink-0",
                      timeRange === range ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                    )}
                  >
                    {range}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 bg-white/50 border border-[#141414] rounded-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-mono font-bold uppercase opacity-50 mr-2">主圖指標:</span>
            <div className="flex gap-1 bg-white p-1 border border-[#141414]/10 rounded-sm">
              {[
                { key: 'ma5', label: 'MA5' },
                { key: 'ma10', label: 'MA10' },
                { key: 'ma20', label: 'MA20' },
                { key: 'ma60', label: 'MA60' },
                { key: 'ma120', label: 'MA120' },
                { key: 'ema', label: 'EMA' },
              ].map((indicator) => (
                <button
                  key={indicator.key}
                  onClick={() => onToggleIndicator(indicator.key as keyof IndicatorVisibility)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-mono border transition-all rounded-sm",
                    showIndicators[indicator.key as keyof IndicatorVisibility]
                      ? "bg-[#141414] text-[#E4E3E0] border-[#141414]"
                      : "bg-transparent text-[#141414] border-transparent hover:border-[#141414]/20"
                  )}
                >
                  {indicator.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-mono font-bold uppercase opacity-50 mr-2">副圖指標:</span>
            <div className="flex gap-1 bg-white p-1 border border-[#141414]/10 rounded-sm">
              {[
                { key: 'volume', label: '成交量' },
                { key: 'macd', label: 'MACD' },
                { key: 'rsi', label: 'RSI' },
                { key: 'kd', label: 'KDJ' },
              ].map((indicator) => (
                <button
                  key={indicator.key}
                  onClick={() => onToggleIndicator(indicator.key as keyof IndicatorVisibility)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-mono border transition-all rounded-sm",
                    showIndicators[indicator.key as keyof IndicatorVisibility]
                      ? "bg-[#141414] text-[#E4E3E0] border-[#141414]"
                      : "bg-transparent text-[#141414] border-transparent hover:border-[#141414]/20"
                  )}
                >
                  {indicator.label}
                </button>
              ))}
            </div>
          </div>
        </div>

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

      {/* 圖表容器提高總高度，並在 home.tsx 將多出的空間優先分給主 K 線窗格。 */}
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
            <span className="text-[10px] font-mono opacity-50">Data points: {filteredData.length} | Timeframe: {timeframe}</span>
          </div>
        </div>

        <div className="flex-1 w-full relative">
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
          <div className="w-full h-full" ref={chartContainerRef} />
        </div>
      </section>
    </div>
  );
}
