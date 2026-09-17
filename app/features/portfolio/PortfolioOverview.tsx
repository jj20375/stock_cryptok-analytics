/** @file 持股頁的績效摘要與分布圖表；純呈現，不改寫損益或配置計算。 */
import { BarChart3, PieChart as PieChartIcon, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '../../utils/cn';

interface PortfolioStatistics {
  totalPnL: number;
  totalROI: number;
  winRate: number;
  totalValue: number;
  totalFees: number;
}

interface PortfolioOverviewProps {
  stats: PortfolioStatistics;
  pieData: Array<{ name: string; value: number }>;
  barData: Array<{ name: string; pnl: number }>;
}

/** 圖表僅依父層已算好的全持倉資料呈現，切換市場頁籤不會改變整體資產摘要。 */
export function PortfolioOverview({ stats, pieData, barData }: PortfolioOverviewProps) {
  const colors = ['#141414', '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

  return (
    <>
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
              'text-3xl font-mono font-bold tracking-tighter flex items-baseline justify-end gap-2',
              stats.totalPnL >= 0 ? 'text-emerald-600' : 'text-rose-600',
            )}>
              <span>{stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-sm font-bold opacity-80">({stats.totalROI >= 0 ? '+' : ''}{stats.totalROI.toFixed(2)}%)</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-[#141414] p-8 bg-white flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <TrendingUp size={80} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-6">
              <span className="text-xs font-mono uppercase font-bold tracking-widest opacity-40">Portfolio Return</span>
              <span className={cn(
                'text-xs font-mono font-bold px-2 py-0.5 rounded-full',
                stats.totalROI >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
              )}>
                {stats.totalROI >= 0 ? 'PROFIT' : 'LOSS'}
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
                <div className="h-full bg-[#141414] transition-all duration-1000 ease-out" style={{ width: `${Math.min(100, Math.max(0, stats.winRate))}%` }} />
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-dashed border-[#141414]/10 flex justify-between items-center">
              <div className="text-[10px] font-mono opacity-40 uppercase">Total Trading Fees</div>
              <div className="text-sm font-mono font-bold text-rose-500">-${stats.totalFees.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-[#141414] p-6 bg-white flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <span className="text-[10px] font-mono uppercase font-bold tracking-widest opacity-40 flex items-center gap-2"><PieChartIcon size={12} /> 資產佔比配置</span>
            </div>
            <div className="flex-1 min-h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                    {pieData.map((entry, index) => <Cell key={`cell-${entry.name}`} fill={colors[index % colors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#141414', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '10px', fontFamily: 'monospace' }} itemStyle={{ color: '#fff' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="border border-[#141414] p-6 bg-white flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <span className="text-[10px] font-mono uppercase font-bold tracking-widest opacity-40 flex items-center gap-2"><BarChart3 size={12} /> 個股損益分佈</span>
            </div>
            <div className="flex-1 min-h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#14141405" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={60} fontSize={10} font={{ family: 'monospace' }} />
                  <Tooltip cursor={{ fill: '#14141405' }} contentStyle={{ backgroundColor: '#141414', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '10px' }} />
                  <Bar dataKey="pnl" radius={[0, 2, 2, 0]}>
                    {barData.map(entry => <Cell key={`cell-${entry.name}`} fill={entry.pnl >= 0 ? '#10B981' : '#EF4444'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
