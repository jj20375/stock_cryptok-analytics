import { RefreshCw, Search } from 'lucide-react';
import type { FormEvent } from 'react';
import { cn } from '../../../utils/cn';
import type { MarketKey, StockDataPoint, StockOption } from '../types';

interface HomeHeaderProps {
  market: MarketKey;
  currentStocks: StockOption[];
  selectedStock: StockOption;
  searchQuery: string;
  data: StockDataPoint[];
  loading: boolean;
  onSearchQueryChange: (value: string) => void;
  onSelectedStockChange: (stock: StockOption) => void;
  onSearch: (event: FormEvent) => void;
  onMarketChange: (market: MarketKey) => void;
  onRefreshData: () => void;
}

export function HomeHeader({
  market,
  currentStocks,
  selectedStock,
  searchQuery,
  data,
  loading,
  onSearchQueryChange,
  onSelectedStockChange,
  onSearch,
  onMarketChange,
  onRefreshData,
}: HomeHeaderProps) {
  const hasMockData = data.some(item => item.isMock);

  return (
    <header className="min-h-16 border-b border-[#141414] flex flex-wrap items-center px-4 md:px-8 justify-between sticky top-0 bg-[#E4E3E0]/80 backdrop-blur-md z-10 py-2 md:py-0">
      <div className="flex flex-wrap items-center gap-2 md:gap-4">
        <h1 className="font-serif italic text-lg md:text-xl tracking-tight">台美股短線系統</h1>
        <div className="h-4 w-[1px] bg-[#141414]/20 mx-1 md:mx-2 hidden xs:block" />

        <form onSubmit={onSearch} className="flex items-center mr-4 relative group">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50" />
            <input
              type="text"
              placeholder="搜尋代號 (如 2330)"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              className="bg-white/50 border border-[#141414] pl-7 pr-3 py-1 text-xs font-mono focus:outline-none focus:bg-white transition-all w-28 xs:w-32 md:w-40 rounded-sm"
            />
          </div>
          {searchQuery && (
            <div className="absolute top-full left-0 w-full bg-white border border-[#141414] mt-1 shadow-lg z-50 max-h-48 overflow-y-auto hidden group-focus-within:block">
              {currentStocks
                .filter(stock => stock.symbol.includes(searchQuery.toUpperCase()) || stock.name.includes(searchQuery))
                .map(stock => (
                  <button
                    key={stock.symbol}
                    type="button"
                    onClick={() => {
                      onSelectedStockChange(stock);
                      onSearchQueryChange('');
                    }}
                    className="w-full text-left px-3 py-2 text-[10px] hover:bg-[#141414] hover:text-[#E4E3E0] font-mono border-b border-[#141414]/5 last:border-0"
                  >
                    <div className="font-bold">{stock.symbol}</div>
                    <div className="opacity-70">{stock.name}</div>
                  </button>
                ))}
            </div>
          )}
        </form>

        <div className="flex items-center gap-1 p-1 bg-white/30 border border-[#141414] rounded-sm">
          {(['US', 'TW', 'CRYPTO'] as MarketKey[]).map(marketKey => (
            <button
              key={marketKey}
              onClick={() => onMarketChange(marketKey)}
              className={cn(
                "px-3 py-1 text-[10px] font-mono transition-all",
                market === marketKey ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/10"
              )}
            >
              {marketKey}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-4 md:gap-6 mt-2 md:mt-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest opacity-50 font-bold">Data Source</span>
          <div className={cn("w-2 h-2 rounded-full", hasMockData ? "bg-amber-500" : "bg-emerald-500 animate-pulse")} />
          <span className="text-xs font-mono">{hasMockData ? 'MOCK' : 'LIVE'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest opacity-50 font-bold">Market Status</span>
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-xs font-mono">OPEN</span>
        </div>
        <button
          onClick={onRefreshData}
          className={cn(
            "p-2 border border-[#141414] rounded-full hover:bg-[#141414] hover:text-[#E4E3E0] transition-all",
            loading && "animate-spin"
          )}
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </header>
  );
}
