/** @component 掃描結果卡；點選後同步切換 K 線及基本面消息參考區。 */
import { Activity, BrainCircuit, FlaskConical, Search, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import type { RefObject } from 'react';
import { Link } from 'react-router';
import { cn } from '../../../utils/cn';
import type { MarketKey, ScanResult, ScanStrategy, StockOption, Timeframe } from '../types';

interface MarketHotPicksProps {
  hotPicksRef: RefObject<HTMLDivElement>;
  /** 目前選定的市場(US/TW/CRYPTO)— 用來組出「跳轉回測」連結的 market 參數 */
  market: MarketKey;
  selectedStock: StockOption;
  scanResults: ScanResult[];
  scanStrategy: ScanStrategy;
  scanTimeframe: Timeframe;
  scanning: boolean;
  hasRunScan: boolean;
  scanProgress: number;
  isAiAnalyzing: boolean;
  lastUpdated: string | null;
  onRunScanner: () => void;
  onSelectedStockChange: (stock: StockOption) => void;
  onScanStrategyChange: (strategy: ScanStrategy) => void;
  onScanTimeframeChange: (timeframe: Timeframe) => void;
}

/**
 * 【詳細繁體中文註解】：把首頁掃描器的策略代號對應到回測系統 registry 的 strategyId,
 * 兩邊命名不同是歷史因素(掃描器較早存在),此處集中做一次轉換,供「跳轉回測」連結使用。
 */
const SCAN_STRATEGY_TO_BACKTEST_ID: Record<ScanStrategy, string> = {
  trend: 'trend_momentum',
  consecutive_volume: 'consecutive_volume_breakout',
  volume_no_break: 'volume_no_breakout_fade',
  daily_volume_spike: 'daily_volume_spike',
  big_fish_pro: 'big_fish_pro',
};

const scanStrategyLabel = (strategy: ScanStrategy) => {
  if (strategy === 'big_fish_pro') return '吃大魚 Pro · 勝利方程式';
  if (strategy === 'consecutive_volume') return '量能連續兩期放大';
  if (strategy === 'volume_no_break') return '量增但未突破前高';
  if (strategy === 'daily_volume_spike') return '日線量增 2 倍';
  return '多空趨勢強勢追蹤';
};

const timeframeLabel = (timeframe: Timeframe) => {
  if (timeframe === '1d') return '日線';
  if (timeframe === '4h') return '4小時線';
  if (timeframe === '60m') return '1小時線';
  return '15分鐘線';
};

export function MarketHotPicks({
  hotPicksRef,
  market,
  selectedStock,
  scanResults,
  scanStrategy,
  scanTimeframe,
  scanning,
  hasRunScan,
  scanProgress,
  isAiAnalyzing,
  lastUpdated,
  onRunScanner,
  onSelectedStockChange,
  onScanStrategyChange,
  onScanTimeframeChange,
}: MarketHotPicksProps) {
  return (
    <section ref={hotPicksRef} className="mb-4 bg-[#141414] text-[#E4E3E0] p-4 rounded-sm overflow-hidden relative group">
      <div className="flex items-center justify-between mb-3 border-b border-[#E4E3E0]/10 pb-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-400 animate-pulse" />
          <h2 className="font-serif italic text-sm tracking-widest uppercase">Market Hot Picks (Top 10)</h2>
          {isAiAnalyzing && (
            <span className="text-[8px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full animate-pulse flex items-center gap-1">
              <Activity className="w-2 h-2" /> AI 分析中...
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/stock-analysis"
            className="text-[10px] font-mono border border-emerald-500/50 text-emerald-400 px-2 py-1 rounded-sm hover:bg-emerald-500 hover:text-[#141414] transition-all"
          >
            手動分析
          </Link>
          {lastUpdated && !scanning && (
            <span className="text-[9px] font-mono opacity-40">更新於: {lastUpdated}</span>
          )}
          {scanning && (
            <div className="flex items-center gap-2">
              <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${scanProgress}%` }} />
              </div>
              <span className="text-[9px] font-mono opacity-50">{scanProgress}%</span>
            </div>
          )}
          <div className="text-[10px] font-mono opacity-50 uppercase tracking-widest">
            AI-Enhanced Technical Scoring
          </div>
        </div>
      </div>

      <div className="mb-6 bg-white/5 border border-white/10 rounded-sm p-4 backdrop-blur-md">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#E4E3E0] opacity-50 font-bold font-mono">
              選擇量化分析策略 (Strategy Mechanism)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
              <button
                type="button"
                onClick={() => onScanStrategyChange('trend')}
                className={cn(
                  "text-left p-2.5 rounded-sm border text-[11px] transition-all relative active:scale-[0.98]",
                  scanStrategy === 'trend'
                    ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-bold"
                    : "bg-black/40 border-white/5 text-[#E4E3E0]/70 hover:border-white/10"
                )}
              >
                <div className="font-bold flex items-center gap-1">
                  <BrainCircuit size={12} className={cn(scanStrategy === 'trend' ? "text-emerald-400" : "text-[#E4E3E0]/40")} />
                  多空趨勢強勢追蹤
                </div>
                <div className="text-[9px] opacity-50 mt-1 leading-normal">
                  結合 RSI、MACD 及 KD，篩選趨勢偏多且適度回調的標的。
                </div>
              </button>

              <button
                type="button"
                onClick={() => onScanStrategyChange('big_fish_pro')}
                className={cn(
                  "text-left p-2.5 rounded-sm border text-[11px] transition-all relative active:scale-[0.98]",
                  scanStrategy === 'big_fish_pro'
                    ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-bold"
                    : "bg-black/40 border-white/5 text-[#E4E3E0]/70 hover:border-white/10"
                )}
              >
                <div className="font-bold flex items-center gap-1">
                  <TrendingUp size={12} className={cn(scanStrategy === 'big_fish_pro' ? "text-emerald-400" : "text-[#E4E3E0]/40")} />
                  吃大魚 Pro · 勝利方程式
                </div>
                <div className="text-[9px] opacity-50 mt-1 leading-normal">
                  過濾紅線假金叉，鎖定洗盤翻綠或綠線站穩 EMA200＋江恩目標。
                </div>
              </button>

              <button
                type="button"
                onClick={() => onScanStrategyChange('consecutive_volume')}
                className={cn(
                  "text-left p-2.5 rounded-sm border text-[11px] transition-all relative active:scale-[0.98]",
                  scanStrategy === 'consecutive_volume'
                    ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-bold"
                    : "bg-black/40 border-white/5 text-[#E4E3E0]/70 hover:border-white/10"
                )}
              >
                <div className="font-bold flex items-center gap-1">
                  <Activity size={12} className={cn(scanStrategy === 'consecutive_volume' ? "text-emerald-400" : "text-[#E4E3E0]/40")} />
                  量能連續兩期以上放大
                </div>
                <div className="text-[9px] opacity-50 mt-1 leading-normal">
                  成交量連續大於 5 期均量 1.5 倍，尋找主力連續吸籌信號。
                </div>
              </button>

              <button
                type="button"
                onClick={() => onScanStrategyChange('volume_no_break')}
                className={cn(
                  "text-left p-2.5 rounded-sm border text-[11px] transition-all relative active:scale-[0.98]",
                  scanStrategy === 'volume_no_break'
                    ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-bold"
                    : "bg-black/40 border-white/5 text-[#E4E3E0]/70 hover:border-white/10"
                )}
              >
                <div className="font-bold flex items-center gap-1">
                  <TrendingDown size={12} className={cn(scanStrategy === 'volume_no_break' ? "text-emerald-400" : "text-[#E4E3E0]/40")} />
                  量增但未突破前高
                </div>
                <div className="text-[9px] opacity-50 mt-1 leading-normal">
                  成交量放大但最高價受制於前高，暗示有洗盤吸籌或出貨壓力。
                </div>
              </button>

              <button
                type="button"
                onClick={() => onScanStrategyChange('daily_volume_spike')}
                className={cn(
                  "text-left p-2.5 rounded-sm border text-[11px] transition-all relative active:scale-[0.98]",
                  scanStrategy === 'daily_volume_spike'
                    ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-bold"
                    : "bg-black/40 border-white/5 text-[#E4E3E0]/70 hover:border-white/10"
                )}
              >
                <div className="font-bold flex items-center gap-1">
                  <Zap size={12} className={cn(scanStrategy === 'daily_volume_spike' ? "text-emerald-400" : "text-[#E4E3E0]/40")} />
                  日線量增 2 倍
                </div>
                <div className="text-[9px] opacity-50 mt-1 leading-normal">
                  固定日線，今日成交量達前一交易日 2 倍以上，捕捉異常資金流。
                </div>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 justify-between">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-[#E4E3E0] opacity-50 font-bold font-mono">
                掃描時間週期 (Timeframe)
              </span>
              <div className="grid grid-cols-4 gap-1">
                {(['1d', '4h', '60m', '15m'] as const).map((timeframe) => (
                  <button
                    key={timeframe}
                    type="button"
                    onClick={() => onScanTimeframeChange(timeframe)}
                    className={cn(
                      "py-1.5 text-[10px] rounded-sm border text-center transition-all font-mono font-bold active:scale-[0.95]",
                      scanTimeframe === timeframe
                        ? "bg-emerald-500 text-[#141414] border-emerald-500"
                        : "bg-black/40 border-white/5 text-[#E4E3E0]/70 hover:border-white/10"
                    )}
                  >
                    {timeframeLabel(timeframe)}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={onRunScanner}
              disabled={scanning}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-[#141414] font-bold text-xs rounded-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98] font-mono tracking-widest"
            >
              <Zap size={14} className={cn(scanning && "animate-pulse")} />
              {scanning ? 'SCANNING...' : 'START SCAN'}
            </button>
          </div>
        </div>
      </div>

      {scanning ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white/5 border border-dashed border-[#E4E3E0]/20 rounded-sm">
          <div className="relative mb-6">
            <div className="w-16 h-16 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
            <Zap className="w-6 h-6 text-emerald-500 absolute inset-0 m-auto animate-pulse" />
          </div>
          <h3 className="text-lg font-serif italic mb-2">AI 智能市場掃描中...</h3>
          <p className="text-xs opacity-40 mb-6 font-mono">正在分析全市場技術指標與 K 線型態</p>
          <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${scanProgress}%` }} />
          </div>
          <div className="mt-2 text-[10px] font-mono opacity-50">{scanProgress}% COMPLETE</div>
        </div>
      ) : scanResults.length > 0 ? (
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
          {scanResults.slice(0, 10).map((res, idx) => {
            const isSelected = selectedStock.symbol === res.symbol;
            // 原有 4 種掃描策略支援台股/美股回測；吃大魚 Pro 額外支援加密貨幣全市場回測
            const backtestStrategyId = SCAN_STRATEGY_TO_BACKTEST_ID[scanStrategy];
            const backtestHref = `/backtest?market=${market}&symbol=${encodeURIComponent(res.symbol)}&strategyId=${backtestStrategyId}`;

            return (
            <div
              key={res.symbol}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedStockChange({ symbol: res.symbol, name: res.name })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectedStockChange({ symbol: res.symbol, name: res.name });
              }}
              className={cn(
                "p-3 md:p-4 border transition-all text-left relative overflow-hidden group min-h-[140px] md:min-h-[160px] flex flex-col cursor-pointer",
                isSelected
                  ? "bg-emerald-500 border-emerald-600 text-[#141414]"
                  : "bg-white/5 border-[#E4E3E0]/10 hover:border-emerald-500/50"
              )}
            >
              <div className="flex justify-between items-start mb-2">
                <span className={cn(
                  "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                  isSelected ? "bg-[#141414]/20" : "bg-emerald-500/20 text-emerald-400"
                )}>
                  RANK #{idx + 1}
                </span>
                <div className="flex items-center gap-1.5">
                  {(market !== 'CRYPTO' || scanStrategy === 'big_fish_pro') && (
                    <Link
                      to={backtestHref}
                      onClick={(e) => e.stopPropagation()}
                      title="用此策略回測此標的"
                      className={cn(
                        "p-1 rounded-sm border transition-colors",
                        isSelected
                          ? "border-[#141414]/30 hover:bg-[#141414]/10"
                          : "border-white/10 hover:border-emerald-500/50 hover:bg-emerald-500/10"
                      )}
                    >
                      <FlaskConical className={cn("w-3 h-3", isSelected ? "text-[#141414]" : "text-emerald-400")} />
                    </Link>
                  )}
                  {res.trend === 'up' ? (
                    <TrendingUp className={cn("w-4 h-4", isSelected ? "text-[#141414]" : "text-emerald-400")} />
                  ) : (
                    <TrendingDown className={cn("w-4 h-4", isSelected ? "text-[#141414]" : "text-rose-400")} />
                  )}
                </div>
              </div>

              <div className="font-bold text-lg truncate mb-0.5">{res.symbol}</div>
              <div className={cn("text-[10px] truncate mb-3 opacity-60", isSelected ? "text-[#141414]" : "text-[#E4E3E0]")}>
                {res.name}
              </div>

              <div className={cn(
                "mb-3 p-2 rounded-sm text-[11px] leading-tight italic font-serif flex-grow",
                isSelected ? "bg-[#141414]/10" : "bg-indigo-500/20 text-indigo-200 border border-indigo-500/30"
              )}>
                {res.aiInsight ? `"${res.aiInsight}"` : "AI 正在評估最佳進場時機..."}
              </div>

              <div className="mt-auto">
                {market !== 'CRYPTO' && <p className="mb-2 text-[11px] opacity-80">點選查看 K 線・基本面與消息 →</p>}
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] font-mono opacity-50 uppercase tracking-tighter">Strength Score</div>
                  <div className="text-xs font-mono font-bold">{res.score}</div>
                </div>
                <div className="h-1 w-full bg-black/10 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full transition-all duration-1000", isSelected ? "bg-[#141414]" : "bg-emerald-500")}
                    style={{ width: `${Math.min(res.score, 100)}%` }}
                  />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      ) : hasRunScan ? (
        <div className="flex flex-col items-center justify-center py-12 bg-white/5 border border-dashed border-rose-500/20 rounded-sm">
          <div className="w-12 h-12 bg-rose-500/5 rounded-full flex items-center justify-center mb-4">
            <Activity className="w-6 h-6 text-rose-500/30" />
          </div>
          <h3 className="text-md font-serif italic mb-2 text-[#E4E3E0]">無符合策略之標的</h3>
          <p className="text-xs opacity-40 mb-4 max-w-md text-center leading-relaxed">
            本次以【{scanStrategyLabel(scanStrategy)}】策略及【{timeframeLabel(scanTimeframe)}】週期掃描，未發現符合條件之標的。您可以調整上方控制面板的策略或週期，然後重新嘗試。
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 bg-white/5 border border-dashed border-[#E4E3E0]/20 rounded-sm">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
            <Search className="w-8 h-8 opacity-20" />
          </div>
          <h3 className="text-xl font-serif italic mb-3">發現下一個交易機會</h3>
          <p className="text-xs opacity-40 mb-2 max-w-md text-center leading-relaxed">
            請於上方控制面板選擇量化分析策略與時間週期，點擊「START SCAN」啟動 AI 智能多指標掃描，為您即時篩選當前市場最符合該特性的前 10 檔標的。
          </p>
        </div>
      )}
    </section>
  );
}
