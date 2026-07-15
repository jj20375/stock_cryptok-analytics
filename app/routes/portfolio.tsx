import React, { useState, useMemo, useEffect } from "react";
import { type LoaderFunctionArgs, useLoaderData, useNavigate } from "react-router";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  PieChart as PieChartIcon, 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  Save, 
  X,
  ArrowUpRight,
  ChevronRight,
  BarChart3,
  List,
  Filter,
  Globe,
  Bitcoin,
  LayoutGrid,
  Check
} from "lucide-react";
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis,
  CartesianGrid
} from "recharts";
import { AppLayout } from "../components/AppLayout";
import { getSession } from "../utils/auth";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { userPortfolio, users } from "../db/schema";
import { fetchPriceFromServer, getStockName } from "../services/stockService";
import { cn } from "../utils/cn";

// 【詳細繁體中文註解】：載入持股資料與即時價格，包含手續費
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const env = (context.cloudflare as any)?.env || (process as any).env;
    const session = await getSession(request, env);
    const userId = session.get("userId");

    if (!userId) {
      throw new Response("Unauthorized", { status: 401 });
    }

    if (!env || !env.DB) {
      return { error: "資料庫連線未就緒，請檢查 Cloudflare D1 設定。", portfolio: [], userEmail: "" };
    }

    const db = drizzle(env.DB);

    // 獲取使用者 Email 用於權限控管
    const user = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();
    const userEmail = user?.email || "";

    const portfolioRaw = await db
      .select()
      .from(userPortfolio)
      .where(eq(userPortfolio.userId, userId))
      .all();

    const portfolio = await Promise.all(portfolioRaw.map(async (item) => {
      try {
        const currentPrice = await fetchPriceFromServer(item.symbol);
        return { 
          ...item, 
          currentPrice: currentPrice || 0,
          avgPrice: item.avgPrice ? parseFloat(item.avgPrice as any) : 0,
          shares: item.shares ? parseFloat(item.shares as any) : 0,
          fees: item.fees ? parseFloat(item.fees as any) : 0,
        };
      } catch (e) {
        return { 
          ...item, 
          currentPrice: 0,
          avgPrice: item.avgPrice ? parseFloat(item.avgPrice as any) : 0,
          shares: item.shares ? parseFloat(item.shares as any) : 0,
          fees: item.fees ? parseFloat(item.fees as any) : 0,
        };
      }
    }));

    return { portfolio, userEmail };
  } catch (error: any) {
    console.error("Loader Error:", error);
    return { 
      error: `載入失敗: ${error.message || "未知錯誤"}。請確認資料庫遷移 (Migration) 是否已執行。`, 
      portfolio: [], 
      userEmail: "" 
    };
  }
}

export default function PortfolioPage() {
  const data = useLoaderData<typeof loader>();
  
  // 如果 Loader 返回錯誤，顯示錯誤提示
  if ('error' in data && data.error && (!data.portfolio || data.portfolio.length === 0)) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh] p-4">
          <div className="bg-red-50 border border-red-200 p-6 rounded-sm max-w-md text-center">
            <h3 className="text-red-800 font-bold mb-2">載入發生錯誤</h3>
            <p className="text-red-600 text-sm">{data.error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-red-600 text-white text-xs rounded-sm hover:bg-red-700"
            >
              重新整理
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const { portfolio: initialPortfolio, userEmail } = data as { portfolio: any[], userEmail: string };
  const [portfolio, setPortfolio] = useState(initialPortfolio);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ avgPrice: "", shares: "", fees: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [activeMarket, setActiveMarket] = useState<'ALL' | 'TW' | 'US' | 'CRYPTO'>('ALL');
  
  // 管理員 Email
  const ADMIN_EMAIL = "desiginerice5908@gmail.com";
  const isAdmin = userEmail === ADMIN_EMAIL;
  
  // 新增持股表單狀態
  const [isAdding, setIsAdding] = useState(false);
  const [newAsset, setNewAsset] = useState({
    symbol: "",
    market: "TW" as "TW" | "US" | "CRYPTO",
    avgPrice: "",
    shares: "",
    fees: "0"
  });

  // 【詳細繁體中文註解】：計算績效摘要 (修復 NaN 並支援過濾)
  const stats = useMemo(() => {
    let totalCostBasis = 0; 
    let totalFees = 0;      
    let totalValue = 0;     
    let wins = 0;
    let totalItems = 0;

    portfolio.forEach(p => {
      // 統計數據基於所有資產，不受當前 Tab 過濾影響，以顯示整體總資產
      if (p.avgPrice && p.shares) {
        const cost = p.avgPrice * p.shares;
        const value = p.currentPrice * p.shares;
        totalCostBasis += cost;
        totalFees += (p.fees || 0);
        totalValue += value;
        totalItems++;
        
        const netPnL = value - cost - (p.fees || 0);
        if (netPnL > 0) wins++;
      }
    });

    const totalPnL = totalValue - totalCostBasis - totalFees;
    const totalROI = (totalCostBasis + totalFees) > 0 
      ? (totalPnL / (totalCostBasis + totalFees)) * 100 
      : 0;
    const winRate = totalItems > 0 ? (wins / totalItems) * 100 : 0;

    return { totalPnL, totalROI, winRate, totalValue, totalCostBasis, totalFees };
  }, [portfolio]);

  // 過濾後的持股清單
  const filteredPortfolio = useMemo(() => {
    if (activeMarket === 'ALL') return portfolio;
    return portfolio.filter(p => p.market === activeMarket);
  }, [portfolio, activeMarket]);

  // 圖表資料 (始終顯示全局)
  const pieData = useMemo(() => {
    return portfolio
      .filter(p => p.shares > 0)
      .map(p => ({ name: p.symbol, value: p.currentPrice * p.shares }))
      .sort((a, b) => b.value - a.value);
  }, [portfolio]);

  const barData = useMemo(() => {
    return portfolio
      .filter(p => p.avgPrice > 0 && p.shares > 0)
      .map(p => ({
        name: p.symbol,
        pnl: (p.currentPrice - p.avgPrice) * p.shares - (p.fees || 0)
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [portfolio]);

  const COLORS = ['#141414', '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      let symbol = newAsset.symbol.toUpperCase();
      if (newAsset.market === 'TW' && !symbol.includes('.')) symbol += '.TW';
      if (newAsset.market === 'CRYPTO' && !symbol.includes('/')) symbol += '/USD';

      const name = newAsset.market === 'TW' ? getStockName(symbol) : symbol;

      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          ...newAsset, 
          symbol, 
          name 
        })
      });

      if (res.ok) {
        // 簡單起見，重新整理頁面或手動更新 state
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (id: number, symbol: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          symbol, 
          avgPrice: editValues.avgPrice, 
          shares: editValues.shares,
          fees: editValues.fees
        })
      });
      if (res.ok) {
        const updated = portfolio.map(p => 
          p.id === id 
            ? { 
                ...p, 
                avgPrice: parseFloat(editValues.avgPrice), 
                shares: parseFloat(editValues.shares),
                fees: parseFloat(editValues.fees || "0")
              }
            : p
        );
        setPortfolio(updated);
        setEditingId(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (symbol: string) => {
    if (!confirm(`確定要移除 ${symbol} 嗎？`)) return;
    try {
      const res = await fetch("/api/portfolio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      if (res.ok) {
        setPortfolio(portfolio.filter(p => p.symbol !== symbol));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 【詳細繁體中文註解】：手動重抓日報 (市場摘要 + AI 三模式批次分析)
  const handleRunReport = async () => {
    if (isReporting) return;
    setIsReporting(true);
    try {
      // 第一階段：市場摘要
      const res1 = await fetch("/api/run-report?market=TW&phase=market");
      const data1 = await res1.json();
      if (!data1.success) throw new Error(`第一階段 (市場摘要) 失敗: ${data1.message}`);

      // 第二階段：AI 三模式策略批次
      await new Promise(r => setTimeout(r, 1500)); // 緩衝
      const res2 = await fetch("/api/run-report?market=TW&phase=strategy");
      const data2 = await res2.json();
      if (data2.success) {
        alert("✅ 完整雙階段報表已發送！\n1. 市場摘要\n2. AI 三模式策略批次分析");
      } else {
        throw new Error(`第二階段 (AI 三模式策略批次) 失敗: ${data2.message}`);
      }
    } catch (err: any) {
      alert(`❌ 報表發送中斷: ${err.message}`);
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8 pb-20">
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-[#141414] pb-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
               <div className="px-2 py-0.5 bg-[#141414] text-white text-[9px] font-mono tracking-tighter uppercase rounded-sm">Asset Management</div>
            </div>
            <h1 className="font-serif italic text-4xl md:text-6xl tracking-tight">持股績效總覽</h1>
          </div>
          <div className="flex gap-8">
             <div className="text-right group">
                <div className="text-[10px] font-mono uppercase opacity-40 group-hover:opacity-100 transition-opacity">Total Net Value</div>
                <div className="text-3xl font-mono font-bold tracking-tighter">
                  ${stats.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
             </div>
             <div className="h-12 w-px bg-[#141414]/10" />
             <div className="text-right group">
                <div className="text-[10px] font-mono uppercase opacity-40 group-hover:opacity-100 transition-opacity">Overall P/L</div>
                <div className={cn(
                  "text-3xl font-mono font-bold tracking-tighter flex items-baseline justify-end gap-2",
                  stats.totalPnL >= 0 ? "text-emerald-600" : "text-rose-600"
                )}>
                  <span>{stats.totalPnL >= 0 ? "+" : ""}{stats.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  <span className="text-sm font-bold opacity-80">({stats.totalROI >= 0 ? "+" : ""}{stats.totalROI.toFixed(2)}%)</span>
                </div>
             </div>
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Performance Stats Card */}
          <div className="border border-[#141414] p-8 bg-white flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
               <TrendingUp size={80} />
            </div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs font-mono uppercase font-bold tracking-widest opacity-40">Portfolio Return</span>
                <span className={cn(
                  "text-xs font-mono font-bold px-2 py-0.5 rounded-full",
                  stats.totalROI >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                )}>
                  {stats.totalROI >= 0 ? "PROFIT" : "LOSS"}
                </span>
              </div>
              <div className="text-6xl font-mono font-bold tracking-tighter mb-4">
                {stats.totalROI.toFixed(2)}<span className="text-2xl ml-1">%</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[10px] font-mono">
                   <span className="opacity-40 uppercase">Win Rate Probability</span>
                   <span className="font-bold">{stats.winRate.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full bg-[#141414]/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[#141414] transition-all duration-1000 ease-out" 
                    style={{ width: `${Math.min(100, Math.max(0, stats.winRate))}%` }} 
                  />
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-dashed border-[#141414]/10 flex justify-between items-center">
                 <div className="text-[10px] font-mono opacity-40 uppercase">Total Trading Fees</div>
                 <div className="text-sm font-mono font-bold text-rose-500">-${stats.totalFees.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Allocation & Distribution in Tabs Style */}
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
             <div className="border border-[#141414] p-6 bg-white flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-[10px] font-mono uppercase font-bold tracking-widest opacity-40 flex items-center gap-2">
                    <PieChartIcon size={12} /> 資產佔比配置
                  </span>
                </div>
                <div className="flex-1 min-h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#141414', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '10px', fontFamily: 'monospace' }}
                        itemStyle={{ color: '#fff' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
             </div>

             <div className="border border-[#141414] p-6 bg-white flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-[10px] font-mono uppercase font-bold tracking-widest opacity-40 flex items-center gap-2">
                    <BarChart3 size={12} /> 個股損益分佈
                  </span>
                </div>
                <div className="flex-1 min-h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#14141405" />
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" width={60} fontSize={10} font={{family: 'monospace'}} />
                      <Tooltip 
                        cursor={{ fill: '#14141405' }}
                        contentStyle={{ backgroundColor: '#141414', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '10px' }}
                      />
                      <Bar dataKey="pnl" radius={[0, 2, 2, 0]}>
                        {barData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10B981' : '#EF4444'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
             </div>
          </div>
        </div>

        {/* Assets Management Section */}
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Market Tabs */}
            <div className="flex p-1 bg-[#141414]/5 rounded-md border border-[#141414]/5">
               {[
                 { id: 'ALL', label: '全部資產', icon: LayoutGrid },
                 { id: 'TW', label: '台灣股市', icon: Globe },
                 { id: 'US', label: '美國股市', icon: DollarSign },
                 { id: 'CRYPTO', label: '加密貨幣', icon: Bitcoin },
               ].map((tab) => (
                 <button
                   key={tab.id}
                   onClick={() => setActiveMarket(tab.id as any)}
                   className={cn(
                     "flex items-center gap-2 px-4 py-2 text-[11px] font-mono font-bold transition-all rounded-sm",
                     activeMarket === tab.id 
                       ? "bg-[#141414] text-[#E4E3E0] shadow-sm" 
                       : "hover:bg-[#141414]/5 opacity-50 hover:opacity-100"
                   )}
                 >
                   <tab.icon size={12} />
                   {tab.label}
                 </button>
               ))}
            </div>

            <div className="flex gap-2 w-full md:w-auto">
              {/* 管理員專屬按鈕 */}
              {isAdmin && (
                <button
                  onClick={handleRunReport}
                  disabled={isReporting}
                  className={cn(
                    "flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-sm border border-amber-800 transition-all shadow-[3px_3px_0px_0px_rgba(20,20,20,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50",
                    isReporting && "animate-pulse"
                  )}
                >
                  <BarChart3 className={cn("w-4 h-4", isReporting && "animate-spin")} />
                  {isReporting ? "日報抓取中..." : "重抓今日日報"}
                </button>
              )}

              <button 
                onClick={() => setIsAdding(!isAdding)}
                className={cn(
                  "flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-2 bg-[#141414] text-white text-xs font-bold rounded-sm hover:opacity-90 transition-all shadow-[3px_3px_0px_0px_rgba(20,20,20,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5",
                  isAdding && "bg-rose-500"
                )}
              >
                {isAdding ? <X size={14} /> : <Plus size={14} />}
                {isAdding ? "取消新增" : "手動新增持股"}
              </button>
            </div>
          </div>

          {/* Quick Add Form */}
          {isAdding && (
            <div className="border border-[#141414] bg-white p-6 animate-in slide-in-from-top duration-300">
               <h3 className="text-xs font-mono font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                 <Plus size={14} /> 新增持股資產
               </h3>
               <form onSubmit={handleAddAsset} className="grid grid-cols-1 md:grid-cols-6 gap-4">
                  <div className="md:col-span-1">
                    <label className="text-[10px] font-mono uppercase opacity-50 block mb-2">市場類型</label>
                    <select 
                      value={newAsset.market}
                      onChange={(e) => setNewAsset({...newAsset, market: e.target.value as any})}
                      className="w-full bg-[#141414]/5 border border-[#141414]/10 p-2 text-xs font-mono focus:outline-none focus:border-[#141414]"
                    >
                      <option value="TW">TW 台灣</option>
                      <option value="US">US 美國</option>
                      <option value="CRYPTO">CRYPTO</option>
                    </select>
                  </div>
                  <div className="md:col-span-1">
                    <label className="text-[10px] font-mono uppercase opacity-50 block mb-2">代號 (Symbol)</label>
                    <input 
                      type="text"
                      required
                      placeholder={newAsset.market === 'TW' ? "如 2330" : "如 AAPL"}
                      value={newAsset.symbol}
                      onChange={(e) => setNewAsset({...newAsset, symbol: e.target.value})}
                      className="w-full bg-[#141414]/5 border border-[#141414]/10 p-2 text-xs font-mono focus:outline-none focus:border-[#141414]"
                    />
                  </div>
                  <div className="md:col-span-1">
                    <label className="text-[10px] font-mono uppercase opacity-50 block mb-2">購買均價</label>
                    <input 
                      type="number"
                      step="any"
                      required
                      value={newAsset.avgPrice}
                      onChange={(e) => setNewAsset({...newAsset, avgPrice: e.target.value})}
                      className="w-full bg-[#141414]/5 border border-[#141414]/10 p-2 text-xs font-mono focus:outline-none focus:border-[#141414]"
                    />
                  </div>
                  <div className="md:col-span-1">
                    <label className="text-[10px] font-mono uppercase opacity-50 block mb-2">持股數量</label>
                    <input 
                      type="number"
                      step="any"
                      required
                      value={newAsset.shares}
                      onChange={(e) => setNewAsset({...newAsset, shares: e.target.value})}
                      className="w-full bg-[#141414]/5 border border-[#141414]/10 p-2 text-xs font-mono focus:outline-none focus:border-[#141414]"
                    />
                  </div>
                  <div className="md:col-span-1">
                    <label className="text-[10px] font-mono uppercase opacity-50 block mb-2">交易手續費</label>
                    <input 
                      type="number"
                      step="any"
                      value={newAsset.fees}
                      onChange={(e) => setNewAsset({...newAsset, fees: e.target.value})}
                      className="w-full bg-[#141414]/5 border border-[#141414]/10 p-2 text-xs font-mono focus:outline-none focus:border-[#141414]"
                    />
                  </div>
                  <div className="md:col-span-1 flex items-end">
                    <button 
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-10 bg-[#141414] text-white text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {isLoading ? <RefreshCw className="animate-spin" size={14} /> : <Check size={14} />}
                      確認新增
                    </button>
                  </div>
               </form>
            </div>
          )}

          {/* Asset Table */}
          <div className="border border-[#141414] bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#141414] bg-[#141414]/2">
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50">市場</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50">資產資訊</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50 text-right">目前市價</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50 text-right">平均成本</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50 text-right">持股數量</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50 text-right text-rose-500">交易稅費</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50 text-right">資產市值</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50 text-right">損益率</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50 text-right">淨損益</th>
                    <th className="p-5 text-[10px] font-mono uppercase font-bold opacity-50 text-center">操作選項</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/5">
                  {filteredPortfolio.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-20 text-center">
                        <div className="flex flex-col items-center gap-2 opacity-20">
                           <Search size={40} />
                           <span className="text-sm font-serif italic">No matching assets found in this category.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredPortfolio.map((p) => {
                      const isEditing = editingId === p.id;
                      const fees = p.fees || 0;
                      const pnlAmount = (p.currentPrice - p.avgPrice) * p.shares - fees;
                      const totalCost = (p.avgPrice * p.shares) + fees;
                      const pnlPercent = totalCost > 0 ? (pnlAmount / totalCost) * 100 : 0;
                      
                      return (
                        <tr key={p.id} className="hover:bg-[#141414]/2 transition-colors group">
                          <td className="p-5">
                             <div className={cn(
                               "w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono",
                               p.market === 'TW' ? "bg-blue-50 text-blue-600" :
                               p.market === 'US' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                             )}>
                               {p.market === 'TW' ? '台' : p.market === 'US' ? '美' : '幣'}
                             </div>
                          </td>
                          <td className="p-5">
                            <div className="font-bold text-sm tracking-tight">{p.name || '未命名資產'}</div>
                            <div className="text-[10px] opacity-40 font-mono truncate max-w-[120px]">{p.symbol}</div>
                          </td>
                          <td className="p-5 font-mono text-sm font-bold text-right">
                            ${p.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-5 text-right">
                            {isEditing ? (
                              <input 
                                type="number"
                                className="w-24 bg-white border border-[#141414] p-2 text-xs font-mono outline-none focus:ring-1 ring-[#141414]"
                                value={editValues.avgPrice}
                                onChange={(e) => setEditValues({ ...editValues, avgPrice: e.target.value })}
                              />
                            ) : (
                              <span className="font-mono text-sm opacity-60">${p.avgPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            )}
                          </td>
                          <td className="p-5 text-right">
                            {isEditing ? (
                              <input 
                                type="number"
                                className="w-20 bg-white border border-[#141414] p-2 text-xs font-mono outline-none focus:ring-1 ring-[#141414]"
                                value={editValues.shares}
                                onChange={(e) => setEditValues({ ...editValues, shares: e.target.value })}
                              />
                            ) : (
                              <span className="font-mono text-sm opacity-60">{p.shares.toLocaleString()}</span>
                            )}
                          </td>
                          <td className="p-5 text-right">
                            {isEditing ? (
                              <input 
                                type="number"
                                className="w-20 bg-white border border-[#141414] p-2 text-xs font-mono outline-none focus:ring-1 ring-[#141414]"
                                value={editValues.fees}
                                onChange={(e) => setEditValues({ ...editValues, fees: e.target.value })}
                              />
                            ) : (
                              <span className="font-mono text-sm text-rose-400">-${fees.toLocaleString()}</span>
                            )}
                          </td>
                          <td className="p-5 font-mono text-sm font-bold text-right">
                            ${(p.currentPrice * p.shares).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className={cn(
                            "p-5 font-mono text-sm font-bold text-right",
                            pnlPercent >= 0 ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {p.avgPrice > 0 ? (
                              <div className="flex items-center justify-end gap-1">
                                {pnlPercent >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                {pnlPercent.toFixed(2)}%
                              </div>
                            ) : '--'}
                          </td>
                          <td className={cn(
                            "p-5 font-mono text-sm font-bold text-right",
                            pnlAmount >= 0 ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {p.avgPrice > 0 ? `${pnlAmount >= 0 ? '+' : ''}${pnlAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '--'}
                          </td>
                          <td className="p-5">
                            <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                              {isEditing ? (
                                <>
                                  <button 
                                    onClick={() => handleUpdate(p.id, p.symbol)}
                                    className="p-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-sm transition-all"
                                    disabled={isLoading}
                                  >
                                    <Save size={14} />
                                  </button>
                                  <button 
                                    onClick={() => setEditingId(null)}
                                    className="p-2 bg-rose-50 text-rose-500 hover:bg-rose-100 rounded-sm transition-all"
                                  >
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button 
                                    onClick={() => {
                                      setEditingId(p.id);
                                      setEditValues({ 
                                        avgPrice: p.avgPrice.toString(), 
                                        shares: p.shares.toString(),
                                        fees: (p.fees || 0).toString()
                                      });
                                    }}
                                    className="p-2 hover:bg-[#141414] hover:text-white rounded-sm transition-all"
                                    title="編輯持股"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  <button 
                                    onClick={() => handleDelete(p.symbol)}
                                    className="p-2 text-rose-500 hover:bg-rose-50 rounded-sm transition-all"
                                    title="刪除資產"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 opacity-40 hover:opacity-100 transition-opacity">
           <div className="border border-dashed border-[#141414]/20 p-8 rounded-sm bg-white/50">
              <h3 className="text-[11px] font-mono uppercase font-bold mb-3 tracking-widest flex items-center gap-2">
                <Info className="w-3 h-3" /> 投資配置說明
              </h3>
              <p className="text-xs italic leading-relaxed font-serif">
                本系統採「淨損益」計算邏輯，已為您自動扣除所有輸入的交易手續費。
                資產配置建議保持分散，單一標的建議不超過總資產的 20%，以降低市場系統性風險。
              </p>
           </div>
           <div className="border border-dashed border-[#141414]/20 p-8 rounded-sm bg-white/50">
              <h3 className="text-[11px] font-mono uppercase font-bold mb-3 tracking-widest flex items-center gap-2">
                <RefreshCw className="w-3 h-3" /> 自動同步機制
              </h3>
              <p className="text-xs italic leading-relaxed font-serif">
                價格數據每 15 分鐘透過伺服器代理從全球金融市場獲取即時報價。
                如果您發現數據異常，請嘗試手動重新載入頁面或檢查網路連接。
              </p>
           </div>
        </div>
      </div>
    </AppLayout>
  );
}

// 補上遺漏的圖示
function RefreshCw({ className, size }: { className?: string; size?: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>;
}

function Info({ className, size }: { className?: string; size?: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>;
}
