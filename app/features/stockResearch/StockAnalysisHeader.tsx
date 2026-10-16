/** @file 個股分析搜尋列與題材財報入口；查詢按鈕才觸發既有 AI 分析。 */
import { Link } from 'react-router';
import { Activity, Search, TrendingUp } from 'lucide-react';

export function StockAnalysisHeader({ symbol, isLoading, onSymbolChange, onAnalyze }: {
  symbol: string; isLoading: boolean; onSymbolChange: (value: string) => void; onAnalyze: () => void;
}) {
  return <header className="border-b border-[#141414] px-4 md:px-8 py-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#E4E3E0]/80 backdrop-blur-md sticky top-0 z-10">
          <div>
            <h1 className="font-serif italic text-2xl md:text-3xl tracking-tight leading-none">個股深度分析儀表板</h1>
            <p className="text-[10px] uppercase tracking-widest mt-2 opacity-60 font-bold">Deep Stock Analysis & Themes</p>
            <Link to="/stock-themes" className="mt-2 inline-block text-sm underline">查看題材與官方財報 →</Link>
          </div>
          
          <div className="flex gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
              <input
                type="text"
                value={symbol}
                onChange={(e) => onSymbolChange(e.target.value.toUpperCase())}
                placeholder="搜尋代號 (如 2330.TW)"
                className="bg-white border border-[#141414] rounded-sm pl-10 pr-4 py-2 text-sm font-mono w-full md:w-64 focus:outline-none focus:ring-1 focus:ring-[#141414] transition-all"
              />
            </div>
            <button
              onClick={onAnalyze}
              disabled={isLoading}
              className="bg-[#141414] text-[#E4E3E0] px-6 py-2 rounded-sm text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading ? <Activity className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              {isLoading ? "分析中" : "開始分析"}
            </button>
          </div>
        </header>;
}
