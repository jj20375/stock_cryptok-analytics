import {
  Activity,
  AlertCircle,
  BrainCircuit,
  ChevronRight,
  Newspaper,
  PieChart,
  RefreshCw,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { cn } from '../../../utils/cn';
import type {
  AIStrategy,
  MarketKey,
  PortfolioStock,
  PortfolioSummary,
  ScanResult,
  ScanStrategy,
  StockDataPoint,
  StockOption,
  Timeframe,
} from '../types';

interface LeftSidebarProps {
  market: MarketKey;
  user: unknown;
  currentStocks: StockOption[];
  selectedStock: StockOption;
  scanResults: ScanResult[];
  scanStrategy: ScanStrategy;
  scanTimeframe: Timeframe;
  scanning: boolean;
  isAiAnalyzing: boolean;
  portfolio: PortfolioStock[];
  portfolioSummary: PortfolioSummary;
  isAnalyzingPortfolio: string | null;
  analysisResult: any;
  signal: { signal: 'BUY' | 'SELL' | 'HOLD'; reason: string };
  aiStrategy: AIStrategy | null;
  isGeneratingStrategy: boolean;
  latestRsi?: number;
  latestData: StockDataPoint | null;
  latestEmaShort?: number;
  latestEmaLong?: number;
  onRunScanner: () => void;
  onSelectedStockChange: (stock: StockOption) => void;
  onRemoveFromPortfolio: (symbol: string) => void;
  onAnalyzePortfolioStock: (stock: PortfolioStock) => void;
  onUpdatePortfolioDetails: (symbol: string, avgPrice: string, shares: string) => void;
  onClearAnalysisResult: () => void;
  onGenerateStrategy: () => void;
}

export function LeftSidebar({
  market,
  user,
  currentStocks,
  selectedStock,
  scanResults,
  scanStrategy,
  scanTimeframe,
  scanning,
  isAiAnalyzing,
  portfolio,
  portfolioSummary,
  isAnalyzingPortfolio,
  analysisResult,
  signal,
  aiStrategy,
  isGeneratingStrategy,
  latestRsi,
  latestData,
  latestEmaShort,
  latestEmaLong,
  onRunScanner,
  onSelectedStockChange,
  onRemoveFromPortfolio,
  onAnalyzePortfolioStock,
  onUpdatePortfolioDetails,
  onClearAnalysisResult,
  onGenerateStrategy,
}: LeftSidebarProps) {
  return (
    <div className="lg:col-span-1 flex flex-col gap-8">
      <section className="border border-[#141414] p-6 bg-white/50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif italic text-xs uppercase tracking-widest opacity-50">
            {isAiAnalyzing ? "AI 分析中..." : `Select Asset (${market})`}
          </h2>
          <button
            onClick={onRunScanner}
            disabled={scanning}
            className="text-[9px] bg-[#141414] text-[#E4E3E0] px-2 py-1 rounded-sm hover:bg-opacity-80 disabled:opacity-50 flex items-center gap-1 font-mono"
          >
            <Zap className={cn("w-3 h-3", scanning && "animate-pulse")} />
            {scanning ? 'SCANNING' : 'SCAN OPPORTUNITY'}
          </button>
        </div>

        {scanResults.length > 0 && (
          <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-sm shadow-sm">
            <p className="text-[9px] font-bold text-indigo-800 uppercase mb-2 flex items-center justify-between tracking-tighter">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-indigo-600" /> AI 智能推薦 (TOP 10)
              </span>
              <span className="opacity-50 font-mono text-[8px]">
                {scanStrategy === 'consecutive_volume' ? '連續爆量' : scanStrategy === 'volume_no_break' ? '爆量未過高' : scanStrategy === 'daily_volume_spike' ? '日線量增2倍' : '趨勢追蹤'} ({scanStrategy === 'daily_volume_spike' ? '1d' : scanTimeframe})
              </span>
            </p>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
              {scanResults.slice(0, 10).map((res, idx) => (
                <div
                  key={res.symbol}
                  onClick={() => onSelectedStockChange({ symbol: res.symbol, name: res.name })}
                  className="cursor-pointer hover:bg-white p-2 rounded transition-all border border-indigo-100 hover:border-indigo-300 group bg-white/50"
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono font-bold text-indigo-600 bg-indigo-100 px-1 rounded">#{idx + 1}</span>
                      <span className="text-[11px] font-bold">{res.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {res.trend === 'up' ? (
                        <TrendingUp className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-rose-500" />
                      )}
                      <span className="text-[8px] font-mono opacity-50">{res.score} PTS</span>
                    </div>
                  </div>
                  {res.aiInsight && (
                    <div className="mt-1.5 p-1.5 bg-indigo-600 text-white rounded-sm">
                      <p className="text-[9px] leading-tight flex items-center gap-1">
                        <Activity className="w-2.5 h-2.5" /> {res.aiInsight}
                      </p>
                    </div>
                  )}
                  <p className="text-[8px] text-[#141414]/40 mt-1 truncate">{res.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {!currentStocks.some(stock => stock.symbol === selectedStock.symbol) && (
            <div className="mb-2">
              <p className="text-[9px] uppercase tracking-widest opacity-50 mb-1 font-bold">搜尋結果</p>
              <button
                onClick={() => onSelectedStockChange(selectedStock)}
                className="w-full flex items-center justify-between p-3 transition-all text-left bg-[#141414] text-[#E4E3E0]"
              >
                <div>
                  <div className="font-mono font-bold">{selectedStock.symbol}</div>
                  <div className="text-[10px] opacity-70">{selectedStock.name}</div>
                </div>
                <ChevronRight size={16} />
              </button>
              <div className="h-[1px] bg-[#141414]/10 my-4" />
            </div>
          )}

          {currentStocks.map((stock) => {
            const isRecommended = scanResults.some(result => result.symbol === stock.symbol);
            return (
              <button
                key={stock.symbol}
                onClick={() => onSelectedStockChange(stock)}
                className={cn(
                  "flex items-center justify-between p-3 border border-transparent transition-all text-left group",
                  selectedStock.symbol === stock.symbol
                    ? "bg-[#141414] text-[#E4E3E0]"
                    : "hover:border-[#141414]"
                )}
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <div className="font-mono font-bold">{stock.symbol}</div>
                    {isRecommended && (
                      <span className="text-[7px] bg-indigo-500 text-white px-1 rounded-full animate-pulse">AI 推薦</span>
                    )}
                  </div>
                  <div className="text-[10px] opacity-70">{stock.name}</div>
                </div>
                {selectedStock.symbol === stock.symbol && <ChevronRight size={16} />}
              </button>
            );
          })}
        </div>
      </section>

      {user && (
        <section className="border border-[#141414] p-6 bg-white/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif italic text-xs uppercase tracking-widest opacity-50 flex items-center gap-2">
              <Star size={12} className="text-amber-500" /> My Portfolio
            </h2>
            <span className="text-[9px] font-mono opacity-40">{portfolio.length} ASSETS</span>
          </div>

          {portfolio.length > 0 && portfolioSummary.totalCost > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-6 p-3 bg-[#141414] text-white rounded-sm">
              <div className="flex flex-col">
                <span className="text-[8px] opacity-50 uppercase font-mono">Total P/L</span>
                <span className={cn(
                  "text-xs font-bold font-mono",
                  portfolioSummary.totalPnL >= 0 ? "text-emerald-400" : "text-rose-400"
                )}>
                  {portfolioSummary.totalPnL >= 0 ? "+" : ""}{portfolioSummary.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex flex-col border-l border-white/10 pl-2">
                <span className="text-[8px] opacity-50 uppercase font-mono">ROI</span>
                <span className={cn(
                  "text-xs font-bold font-mono",
                  portfolioSummary.totalROI >= 0 ? "text-emerald-400" : "text-rose-400"
                )}>
                  {portfolioSummary.totalROI.toFixed(2)}%
                </span>
              </div>
              <div className="flex flex-col border-l border-white/10 pl-2">
                <span className="text-[8px] opacity-50 uppercase font-mono">Win Rate</span>
                <span className="text-xs font-bold font-mono text-amber-400">
                  {portfolioSummary.winRate.toFixed(0)}%
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {portfolio.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-[#141414]/20 rounded-sm">
                <p className="text-[10px] opacity-40">尚無持股，點擊 ★ 加入</p>
              </div>
            ) : (
              portfolio.map((stock) => (
                <div key={stock.symbol} className="group">
                  <div className="p-2 hover:bg-[#141414]/5 rounded-sm transition-all border border-transparent hover:border-[#141414]/10">
                    <div className="flex items-center justify-between mb-2">
                      <button
                        onClick={() => onSelectedStockChange({ symbol: stock.symbol, name: stock.name || stock.symbol })}
                        className="flex-1 text-left"
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono font-bold text-xs">{stock.symbol}</span>
                          {stock.currentPrice && (
                            <span className="text-[10px] font-mono opacity-50">${stock.currentPrice.toFixed(2)}</span>
                          )}
                        </div>
                        <div className="text-[9px] opacity-60 truncate">{stock.name}</div>
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onAnalyzePortfolioStock(stock)}
                          disabled={isAnalyzingPortfolio === stock.symbol}
                          className="p-1.5 hover:bg-indigo-100 text-indigo-600 rounded-sm transition-all"
                          title="AI 深度分析"
                        >
                          {isAnalyzingPortfolio === stock.symbol ? (
                            <RefreshCw size={12} className="animate-spin" />
                          ) : (
                            <BrainCircuit size={12} />
                          )}
                        </button>
                        <button
                          onClick={() => onRemoveFromPortfolio(stock.symbol)}
                          className="p-1.5 hover:bg-rose-100 text-rose-500 rounded-sm transition-all opacity-0 group-hover:opacity-100"
                          title="移除持股"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-end justify-between gap-2 mt-1 pt-2 border-t border-dashed border-[#141414]/5">
                      <div className="flex gap-2">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[7px] uppercase opacity-40 font-mono">均價</label>
                          <input
                            type="number"
                            defaultValue={stock.avgPrice || ""}
                            onBlur={(event) => onUpdatePortfolioDetails(stock.symbol, event.target.value, stock.shares || "")}
                            placeholder="0.00"
                            className="w-14 text-[10px] font-mono bg-transparent border-b border-[#141414]/10 focus:border-indigo-500 outline-none"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[7px] uppercase opacity-40 font-mono">股數</label>
                          <input
                            type="number"
                            defaultValue={stock.shares || ""}
                            onBlur={(event) => onUpdatePortfolioDetails(stock.symbol, stock.avgPrice || "", event.target.value)}
                            placeholder="0"
                            className="w-12 text-[10px] font-mono bg-transparent border-b border-[#141414]/10 focus:border-indigo-500 outline-none"
                          />
                        </div>
                      </div>

                      {stock.avgPrice && stock.shares && stock.currentPrice && (
                        <div className="text-right">
                          <div className={cn(
                            "text-[10px] font-bold font-mono leading-none",
                            stock.currentPrice >= parseFloat(stock.avgPrice) ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {((stock.currentPrice - parseFloat(stock.avgPrice)) / parseFloat(stock.avgPrice) * 100).toFixed(1)}%
                          </div>
                          <div className="text-[8px] font-mono opacity-50">
                            {((stock.currentPrice - parseFloat(stock.avgPrice)) * parseFloat(stock.shares)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {isAnalyzingPortfolio === stock.symbol && (
                    <div className="mt-2 p-3 bg-indigo-50 border border-indigo-100 rounded-sm animate-pulse">
                      <div className="flex items-center gap-2 mb-2">
                        <BrainCircuit size={10} className="text-indigo-500" />
                        <span className="text-[9px] font-bold text-indigo-900 uppercase">AI 分析中...</span>
                      </div>
                      <div className="h-2 w-full bg-indigo-200 rounded-full mb-1" />
                      <div className="h-2 w-2/3 bg-indigo-200 rounded-full" />
                    </div>
                  )}

                  {analysisResult && isAnalyzingPortfolio === null && selectedStock.symbol === stock.symbol && (
                    <div className="mt-2 p-3 bg-white border border-indigo-200 rounded-sm shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <BrainCircuit size={10} className="text-indigo-600" />
                          <span className="text-[9px] font-bold text-indigo-900 uppercase">AI 深度洞察</span>
                        </div>
                        <div className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-50 px-1 rounded">
                          題材力道: {analysisResult.score}/10
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <div className="text-[8px] font-mono opacity-50 uppercase flex items-center gap-1">
                            <PieChart size={8} /> 大戶動向
                          </div>
                          <p className="text-[10px] leading-tight text-[#141414] mt-0.5 italic">"{analysisResult.smartMoneyInsight}"</p>
                        </div>
                        <div>
                          <div className="text-[8px] font-mono opacity-50 uppercase flex items-center gap-1">
                            <Newspaper size={8} /> 核心題材
                          </div>
                          <p className="text-[10px] leading-tight text-[#141414] mt-0.5">{analysisResult.themeAnalysis}</p>
                        </div>
                        <button
                          onClick={onClearAnalysisResult}
                          className="w-full text-[8px] font-mono opacity-30 hover:opacity-100 mt-2 uppercase text-center py-1 border-t border-dashed"
                        >
                          收合分析
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <section className={cn(
        "border border-[#141414] p-6 transition-all duration-500",
        signal.signal === 'BUY' ? "bg-emerald-50" :
        signal.signal === 'SELL' ? "bg-rose-50" : "bg-white/50"
      )}>
        <div className="flex justify-between items-start mb-4">
          <h2 className="font-serif italic text-xs uppercase tracking-widest opacity-50">Trading Signal</h2>
          <div className={cn(
            "px-2 py-1 text-[10px] font-mono border border-[#141414]",
            signal.signal === 'BUY' ? "bg-emerald-500 text-white" :
            signal.signal === 'SELL' ? "bg-rose-500 text-white" : "bg-[#141414] text-[#E4E3E0]"
          )}>
            {signal.signal}
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4">
          {signal.signal === 'BUY' ? (
            <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center text-white">
              <TrendingUp size={24} />
            </div>
          ) : signal.signal === 'SELL' ? (
            <div className="w-12 h-12 rounded-full bg-rose-500 flex items-center justify-center text-white">
              <TrendingDown size={24} />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-full bg-[#141414] flex items-center justify-center text-[#E4E3E0]">
              <Activity size={24} />
            </div>
          )}
          <div>
            <div className="text-2xl font-mono font-bold tracking-tighter">
              {signal.signal === 'BUY' ? 'ENTRY' : signal.signal === 'SELL' ? 'EXIT' : 'NEUTRAL'}
            </div>
            <div className="text-[10px] font-mono opacity-50 uppercase tracking-widest">Recommendation</div>
          </div>
        </div>

        <p className="text-sm font-serif leading-relaxed italic opacity-80 border-t border-[#141414]/10 pt-4 mb-4">
          "{signal.reason}"
        </p>

        <div className="border-t border-[#141414]/10 pt-4">
          {aiStrategy ? (
            <div className="bg-indigo-50/50 p-4 rounded-sm border border-indigo-100 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-indigo-500" />
                <h3 className="font-serif italic text-sm text-indigo-900 font-bold">AI 專業短線策略分析</h3>
              </div>

              <div className="bg-white p-3 border border-indigo-100 rounded-sm">
                <div className="text-[10px] font-mono opacity-50 uppercase mb-1">結論</div>
                <div className={cn(
                  "text-base font-bold",
                  aiStrategy.conclusion?.includes('進場') ? "text-emerald-600" :
                  aiStrategy.conclusion?.includes('觀察') ? "text-amber-600" : "text-rose-600"
                )}>
                  {aiStrategy.conclusion || "分析結果格式異常"}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="bg-white p-3 border border-indigo-100 rounded-sm">
                  <div className="text-[10px] font-mono opacity-50 uppercase mb-1">當前市場數據</div>
                  <div className="text-xs text-indigo-900 leading-relaxed">{aiStrategy.marketData}</div>
                </div>
                <div className="bg-white p-3 border border-indigo-100 rounded-sm">
                  <div className="text-[10px] font-mono opacity-50 uppercase mb-1">策略匹配度分析</div>
                  <div className="text-xs text-indigo-900 leading-relaxed">{aiStrategy.matchAnalysis}</div>
                </div>
                <div className="bg-white p-3 border border-indigo-100 rounded-sm">
                  <div className="text-[10px] font-mono opacity-50 uppercase mb-1">操作劇本</div>
                  <div className="text-xs text-indigo-900 leading-relaxed whitespace-pre-line">{aiStrategy.actionPlan}</div>
                </div>
                <div className="bg-rose-50 p-3 border border-rose-100 rounded-sm">
                  <div className="text-[10px] font-mono text-rose-500 uppercase mb-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 風險警告
                  </div>
                  <div className="text-xs text-rose-900 leading-relaxed">{aiStrategy.riskWarning}</div>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={onGenerateStrategy}
              disabled={isGeneratingStrategy}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-sm transition-all disabled:opacity-50"
            >
              {isGeneratingStrategy ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>AI 深度解析中...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>獲取 AI 短線進出策略</span>
                </>
              )}
            </button>
          )}
        </div>
      </section>

      <section className="border border-[#141414] p-6 bg-white/50">
        <h2 className="font-serif italic text-xs uppercase tracking-widest opacity-50 mb-4">Technical Analysis</h2>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex justify-between items-center p-2 border-b border-[#141414]/10">
            <span className="text-[10px] font-mono opacity-60">RSI (14)</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                "font-mono font-bold text-xs",
                latestRsi! > 70 ? "text-rose-500" : latestRsi! < 30 ? "text-emerald-500" : ""
              )}>
                {latestRsi?.toFixed(2)}
              </span>
              <span className="text-[8px] px-1 border border-[#141414] opacity-50">
                {latestRsi! > 70 ? 'OVERBOUGHT' : latestRsi! < 30 ? 'OVERSOLD' : 'NEUTRAL'}
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center p-2 border-b border-[#141414]/10">
            <span className="text-[10px] font-mono opacity-60">KD (9,3,3)</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-xs">
                K:{latestData?.k?.toFixed(1)} D:{latestData?.d?.toFixed(1)}
              </span>
              <span className={cn(
                "text-[8px] px-1 border border-[#141414]",
                latestData?.k! > latestData?.d! ? "text-emerald-600 border-emerald-600" : "text-rose-600 border-rose-600"
              )}>
                {latestData?.k! > latestData?.d! ? 'UP' : 'DOWN'}
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center p-2 border-b border-[#141414]/10">
            <span className="text-[10px] font-mono opacity-60">MACD</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                "font-mono font-bold text-xs",
                latestData?.macdHist! >= 0 ? "text-rose-500" : "text-emerald-500"
              )}>
                {latestData?.macdHist?.toFixed(2)}
              </span>
              <span className="text-[8px] px-1 border border-[#141414] opacity-50">
                {latestData?.macdHist! >= 0 ? 'BULLISH' : 'BEARISH'}
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center p-2 border-b border-[#141414]/10">
            <span className="text-[10px] font-mono opacity-60">EMA (12/26)</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-xs">
                {latestEmaShort?.toFixed(1)} / {latestEmaLong?.toFixed(1)}
              </span>
              <span className={cn(
                "text-[8px] px-1 border border-[#141414]",
                latestEmaShort! > latestEmaLong! ? "text-emerald-600 border-emerald-600" : "text-rose-600 border-rose-600"
              )}>
                {latestEmaShort! > latestEmaLong! ? 'GOLDEN' : 'DEATH'}
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center p-2 border-b border-[#141414]/10">
            <span className="text-[10px] font-mono opacity-60">MA Trend</span>
            <span className={cn(
              "font-mono font-bold uppercase text-[9px] px-2 py-0.5 border border-[#141414]",
              latestData?.close! > latestData?.ma20! ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            )}>
              {latestData?.close! > latestData?.ma20! ? 'Above MA20' : 'Below MA20'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
