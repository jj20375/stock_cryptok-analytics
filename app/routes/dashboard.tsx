import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc } from "drizzle-orm";
import { users, paperTrades } from "../db/schema";
import { getUserId } from "../utils/auth";
import { AppLayout } from "../components/AppLayout";
import { getMacroIndicators } from "../services/macroService";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as any;
  
  // 【安全性檢查與 Lint 修復】：傳入 env 進行 Token/密鑰加解密與使用者驗證
  const userId = await getUserId(request, env);
  if (!userId) {
    return redirect("/login");
  }

  const db = drizzle(env.DB);

  // 取得使用者所有的交易紀錄，依時間新到舊排序
  const trades = await db
    .select()
    .from(paperTrades)
    .where(eq(paperTrades.userId, userId))
    .orderBy(desc(paperTrades.id))
    .all();

  // 計算績效函式
  const calculateStats = (mode: "PAPER" | "LIVE") => {
    const modeTrades = trades.filter(t => t.mode === mode);
    const closedTrades = modeTrades.filter(t => t.status === "CLOSED");
    
    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter(t => parseFloat(t.pnl || "0") > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    
    const totalPnL = closedTrades.reduce((sum, t) => sum + parseFloat(t.pnl || "0"), 0);

    // 計算持倉中的浮動金額 (暫定，實際需拉取當下市價，這裡以目前成本顯示)
    const openTradesCount = modeTrades.filter(t => t.status === "OPEN").length;

    return {
      totalTrades,
      winRate: winRate.toFixed(1),
      totalPnL: totalPnL.toFixed(2),
      openTradesCount
    };
  };

  const paperStats = calculateStats("PAPER");
  const liveStats = calculateStats("LIVE");

  // 【詳細繁體中文註解】：前端頁面同步拉取最新全球總體經濟風向球資料
  const macro = await getMacroIndicators();

  return { trades, paperStats, liveStats, macro };
}

export default function DashboardRoute() {
  const { trades, paperStats, liveStats, macro } = useLoaderData<typeof loader>();

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <header className="border-b border-[#141414] pb-4">
            <h1 className="text-2xl md:text-3xl font-serif italic tracking-tight text-[#141414]">交易績效 Dashboard</h1>
            <p className="text-gray-600 mt-2">即時追蹤您的自動化交易成效與歷史紀錄。</p>
            <Link to="/trade-journal" className="mt-3 inline-block text-sm text-blue-700 underline">Bitget 實際成交、淨績效與倉位復盤 →</Link>
          </header>

          {/* 【詳細繁體中文註解】：全球總經債券參考風向球 UI 元件 */}
          {macro && (
            <div className="bg-white border border-[#E4E3E0] rounded-xl p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4 mb-6">
                <div>
                  <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                    <span>🌍</span> 全球總經與債券風向球
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">即時監控全球流動性關鍵變數，輔助交易策略風控。</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500 font-medium">全域風險狀態：</span>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                    macro.regime.riskState === "RISK_ON" 
                      ? "bg-green-100 text-green-800" 
                      : macro.regime.riskState === "RISK_OFF"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-800"
                  }`}>
                    {macro.regime.riskState === "RISK_ON" ? "● RISK_ON (中性偏多)" : macro.regime.riskState === "RISK_OFF" ? "● RISK_OFF (防禦保守)" : "● PANIC (市場恐慌)"}
                  </span>
                </div>
              </div>

              {/* 核心指標網格 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {/* 10年期美債 */}
                <div className="border-r border-gray-100 last:border-r-0 pr-4">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">美債 10Y 殖利率</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-gray-900">{macro.us10y.value.toFixed(3)}%</span>
                    <span className={`text-xs font-semibold ${macro.us10y.trend === "UP" ? "text-red-500" : "text-green-500"}`}>
                      {macro.us10y.trend === "UP" ? "▲ 上升" : "▼ 下降"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">10MA: {macro.us10y.ma10.toFixed(3)}%</div>
                </div>

                {/* 美元指數 */}
                <div className="border-r border-gray-100 last:border-r-0 pr-4">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">美元指數 (DXY)</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-gray-900">{macro.dxy.value.toFixed(3)}</span>
                    <span className={`text-xs font-semibold ${macro.dxy.trend === "UP" ? "text-red-500" : "text-green-500"}`}>
                      {macro.dxy.trend === "UP" ? "▲ 強勢" : "▼ 轉弱"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">10MA: {macro.dxy.ma10.toFixed(3)}</div>
                </div>

                {/* VIX 恐慌指數 */}
                <div className="border-r border-gray-100 last:border-r-0 pr-4">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">VIX 恐慌指數</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-gray-900">{macro.vix.value.toFixed(2)}</span>
                    <span className={`text-xs font-semibold ${macro.vix.value > 20 ? "text-red-500" : "text-green-500"}`}>
                      {macro.vix.value > 20 ? "⚠️ 偏高" : "✓ 穩定"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">10MA: {macro.vix.ma10.toFixed(2)}</div>
                </div>

                {/* 殖利率利差 */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">美債 10Y - 3M 利差</div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-2xl font-bold ${macro.spreads.yieldSpread10Y3M < 0 ? "text-red-600 font-extrabold" : "text-gray-900"}`}>
                      {macro.spreads.yieldSpread10Y3M.toFixed(3)}%
                    </span>
                    {macro.spreads.yieldSpread10Y3M < 0 && (
                      <span className="text-xs font-semibold text-red-500 animate-pulse">⚠️ 倒掛</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    5Y 殖利率: {macro.us5y.value.toFixed(3)}%
                  </div>
                </div>
              </div>

              {/* 風控說明文字 */}
              <div className="mt-6 bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-600 flex items-start gap-2">
                <span className="text-sm">💡</span>
                <p className="leading-relaxed"><strong className="font-semibold text-gray-800">策略導航評估：</strong>{macro.regime.reason}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 模擬交易統計 */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-indigo-800">
                <span className="text-2xl">🧪</span>
                <h2 className="text-lg font-medium">模擬交易 (Paper)</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-indigo-600/80 mb-1">總淨利 (USDT)</div>
                  <div className={`text-2xl font-bold ${parseFloat(paperStats.totalPnL) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {parseFloat(paperStats.totalPnL) > 0 ? '+' : ''}{paperStats.totalPnL}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-indigo-600/80 mb-1">勝率</div>
                  <div className="text-2xl font-bold text-indigo-900">{paperStats.winRate}%</div>
                </div>
                <div>
                  <div className="text-sm text-indigo-600/80 mb-1">已平倉次數</div>
                  <div className="text-xl font-semibold text-indigo-900">{paperStats.totalTrades} 次</div>
                </div>
                <div>
                  <div className="text-sm text-indigo-600/80 mb-1">持倉中</div>
                  <div className="text-xl font-semibold text-indigo-900">{paperStats.openTradesCount} 筆</div>
                </div>
              </div>
            </div>

            {/* 實戰交易統計 */}
            <div className="bg-red-50 border border-red-100 rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-red-800">
                <span className="text-2xl">🔥</span>
                <h2 className="text-lg font-medium">實戰交易 (Live)</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-red-600/80 mb-1">總淨利 (USDT)</div>
                  <div className={`text-2xl font-bold ${parseFloat(liveStats.totalPnL) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {parseFloat(liveStats.totalPnL) > 0 ? '+' : ''}{liveStats.totalPnL}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-red-600/80 mb-1">勝率</div>
                  <div className="text-2xl font-bold text-red-900">{liveStats.winRate}%</div>
                </div>
                <div>
                  <div className="text-sm text-red-600/80 mb-1">已平倉次數</div>
                  <div className="text-xl font-semibold text-red-900">{liveStats.totalTrades} 次</div>
                </div>
                <div>
                  <div className="text-sm text-red-600/80 mb-1">持倉中</div>
                  <div className="text-xl font-semibold text-red-900">{liveStats.openTradesCount} 筆</div>
                </div>
              </div>
            </div>
          </div>

          {/* 歷史交易列表 */}
          <div className="bg-white border border-[#E4E3E0] rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E4E3E0] bg-gray-50">
              <h2 className="text-lg font-medium text-[#141414]">最近交易紀錄</h2>
            </div>
            
            {trades.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                目前還沒有任何交易紀錄，等待策略觸發中...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-[#E4E3E0] text-sm text-gray-500">
                      <th className="px-6 py-3 font-medium whitespace-nowrap">時間</th>
                      <th className="px-6 py-3 font-medium">模式</th>
                      <th className="px-6 py-3 font-medium">交易對</th>
                      <th className="px-6 py-3 font-medium">狀態</th>
                      <th className="px-6 py-3 font-medium text-right">進場價</th>
                      <th className="px-6 py-3 font-medium text-right">數量</th>
                      <th className="px-6 py-3 font-medium text-right">出場價</th>
                      <th className="px-6 py-3 font-medium text-right">損益 (USDT)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E3E0]">
                    {trades.map((trade) => {
                      const isLive = trade.mode === "LIVE";
                      const pnlNum = trade.pnl ? parseFloat(trade.pnl) : null;
                      
                      return (
                        <tr key={trade.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                            {new Date(trade.createdAt).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${isLive ? 'bg-red-100 text-red-800' : 'bg-indigo-100 text-indigo-800'}`}>
                              {isLive ? 'LIVE' : 'PAPER'}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-medium text-[#141414]">
                            {trade.symbol}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${trade.status === 'OPEN' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                              {trade.status === 'OPEN' ? '持倉中' : '已平倉'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-gray-600">${parseFloat(trade.entryPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-6 py-4 text-right text-gray-600">{trade.amount}</td>
                          <td className="px-6 py-4 text-right text-gray-600">
                            {trade.exitPrice ? `$${parseFloat(trade.exitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                          </td>
                          <td className="px-6 py-4 text-right font-medium">
                            {pnlNum !== null ? (
                              <span className={pnlNum > 0 ? 'text-green-600' : pnlNum < 0 ? 'text-red-600' : 'text-gray-500'}>
                                {pnlNum > 0 ? '+' : ''}{pnlNum.toFixed(2)}
                              </span>
                            ) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
