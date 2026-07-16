import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { AppLayout } from "../components/AppLayout";
import { init, dispose, Chart } from "klinecharts";
import { Search, TrendingUp, BarChart3, Info, Newspaper, Activity } from "lucide-react";

/**
 * 【詳細繁體中文註解】：重新設計的個股深度分析儀表板
 * 採用與 Portfolio 一致的輕簡、高級感 UI 風格，並整合 klinecharts 圖表。
 */
export default function StockAnalysisDashboard() {
  const [symbol, setSymbol] = useState("2330.TW");
  const fetcher = useFetcher();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  // 【詳細繁體中文註解】
  // 前端個股分析籌碼狀態儲存與載入指示器
  const [chipData, setChipData] = useState<any>(null);
  const [isLoadingChips, setIsLoadingChips] = useState(false);

  const handleAnalyze = () => {
    if (!symbol) return;
    fetcher.submit(
      { symbol, market: symbol.includes(".TW") || /^\d{4,6}$/.test(symbol) ? "TW" : "US" },
      { method: "get", action: "/api/analyze-stock" }
    );
  };

  const isLoading = fetcher.state === "loading" || fetcher.state === "submitting";
  const data = fetcher.data as any;

  // 【詳細繁體中文註解】
  // 當個股分析結果載入後，若是台股，背景異步呼叫個股籌碼 API
  useEffect(() => {
    if (data && symbol && (symbol.includes(".TW") || /^\d{4,6}$/.test(symbol))) {
      setIsLoadingChips(true);
      fetch(`/api/chips?symbol=${encodeURIComponent(symbol)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((res) => {
          if (res && res.chipData) {
            setChipData(res.chipData);
          } else {
            setChipData(null);
          }
          setIsLoadingChips(false);
        })
        .catch((err) => {
          console.error("[StockAnalysis] 獲取籌碼資料失敗:", err);
          setChipData(null);
          setIsLoadingChips(false);
        });
    } else {
      setChipData(null);
    }
  }, [data]);

  // 初始化與更新 K 線圖表
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 如果已經有實例則先銷毀
    if (chartInstance.current) {
      dispose(chartContainerRef.current);
    }

    const chart = init(chartContainerRef.current);
    chartInstance.current = chart;

    // 設定與 Portfolio 一致的極簡配色
    chart.setStyles({
      grid: {
        horizontal: { show: true, color: '#ededed' },
        vertical: { show: false }
      },
      candle: {
        type: 'candle_solid' as any,
        bar: {
          upColor: '#ef4444',
          downColor: '#22c55e',
          noChangeColor: '#888888'
        },
        tooltip: {
          showRule: 'always' as any,
          showType: 'standard' as any
        }
      }
    });

    // 建立量能指標與 MACD
    chart.createIndicator('VOL', false, { id: 'pane_vol' });
    chart.setPaneOptions({ id: 'pane_vol', height: 80 });
    
    chart.createIndicator('MACD', false, { id: 'pane_macd' });
    chart.setPaneOptions({ id: 'pane_macd', height: 100 });

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (chartContainerRef.current) {
        dispose(chartContainerRef.current);
      }
      chartInstance.current = null;
    };
  }, [data]); // 當資料更新時重新初始化（或在資料變化時更新數據）

  // 更新圖表數據
  useEffect(() => {
    if (chartInstance.current && data?.raw?.historyData) {
      const formatted = data.raw.historyData.map((d: any) => ({
        timestamp: d.timestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume
      })).sort((a: any, b: any) => a.timestamp - b.timestamp);
      
      chartInstance.current.applyNewData(formatted);
    }
  }, [data]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] pb-20">
        {/* Header - 搜尋與標題 */}
        <header className="border-b border-[#141414] px-4 md:px-8 py-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#E4E3E0]/80 backdrop-blur-md sticky top-0 z-10">
          <div>
            <h1 className="font-serif italic text-2xl md:text-3xl tracking-tight leading-none">個股深度分析儀表板</h1>
            <p className="text-[10px] uppercase tracking-widest mt-2 opacity-60 font-bold">Deep Stock Analysis & Themes</p>
          </div>
          
          <div className="flex gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="搜尋代號 (如 2330.TW)"
                className="bg-white border border-[#141414] rounded-sm pl-10 pr-4 py-2 text-sm font-mono w-full md:w-64 focus:outline-none focus:ring-1 focus:ring-[#141414] transition-all"
              />
            </div>
            <button
              onClick={handleAnalyze}
              disabled={isLoading}
              className="bg-[#141414] text-[#E4E3E0] px-6 py-2 rounded-sm text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading ? <Activity className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              {isLoading ? "分析中" : "開始分析"}
            </button>
          </div>
        </header>

        <div className="max-w-[1600px] mx-auto p-4 md:p-8 space-y-8">
          
          {/* 分析結果展示 */}
          {data && !isLoading && data.aiAnalysis && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              
              {/* 第一張卡片：分析總覽與評分 */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* 核心評分與總結 */}
                <div className="lg:col-span-2 border border-[#141414] bg-white p-8 relative overflow-hidden group">
                  <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-20 h-20 border-4 border-[#141414] rounded-full flex items-center justify-center bg-[#E4E3E0]">
                        <span className="text-4xl font-black">{data.aiAnalysis.score}</span>
                      </div>
                      <div>
                        <h2 className="text-3xl font-black tracking-tighter">
                          {data.raw.fundamentals?.name || symbol}
                          <span className="text-lg opacity-40 ml-3 font-mono">[{symbol}]</span>
                        </h2>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[10px] px-2 py-0.5 border border-[#141414] font-bold uppercase">AI 評分報告</span>
                          <span className="text-[10px] px-2 py-0.5 border border-[#141414] font-bold uppercase text-emerald-600 bg-emerald-50">投資總結</span>
                        </div>
                      </div>
                    </div>
                    <h3 className="font-serif italic text-xl mb-3 border-b border-[#141414]/10 pb-2">投資總結觀點</h3>
                    <p className="text-sm leading-relaxed opacity-80">
                      {data.aiAnalysis.conclusion}
                    </p>
                  </div>
                </div>

                {/* 快速基本面數據 */}
                <div className="border border-[#141414] bg-white p-8 flex flex-col justify-between">
                  <div className="space-y-6">
                    <h3 className="text-xs font-bold uppercase tracking-widest opacity-40 border-b border-[#141414] pb-2">基本面數據摘要</h3>
                    <div className="grid grid-cols-2 gap-y-6">
                      <div>
                        <p className="text-[10px] uppercase font-bold opacity-50 mb-1">本益比 (PE)</p>
                        <p className="text-xl font-black font-mono">{data.raw.fundamentals?.trailingPE?.toFixed(2) || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold opacity-50 mb-1">殖利率</p>
                        <p className="text-xl font-black font-mono">
                          {data.raw.fundamentals?.dividendYield ? (data.raw.fundamentals.dividendYield * 100).toFixed(2) + '%' : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold opacity-50 mb-1">股價淨值比</p>
                        <p className="text-xl font-black font-mono">{data.raw.fundamentals?.priceToBook?.toFixed(2) || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold opacity-50 mb-1">52 週最高</p>
                        <p className="text-xl font-black font-mono">{data.raw.fundamentals?.fiftyTwoWeekHigh?.toFixed(2) || '---'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold opacity-50 mb-1">52 週最低</p>
                        <p className="text-xl font-black font-mono">{data.raw.fundamentals?.fiftyTwoWeekLow?.toFixed(2) || '---'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-8 pt-4 border-t border-[#141414]/10 text-[10px] font-mono opacity-40">
                    LAST UPDATED: {new Date().toLocaleString()}
                  </div>
                </div>
              </div>

              {/* 第二部分：K 線圖表 */}
              <div className="border border-[#141414] bg-white p-4">
                <div className="flex items-center justify-between mb-4 px-4">
                  <h3 className="font-serif italic text-lg flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    K 線與成交量趨勢圖
                  </h3>
                  <div className="flex gap-2">
                    <span className="text-[10px] border border-[#141414] px-2 py-1 font-bold">1D 日線圖</span>
                    <span className="text-[10px] border border-[#141414] px-2 py-1 font-bold opacity-30 cursor-not-allowed">更多週期預計開放</span>
                  </div>
                </div>
                <div ref={chartContainerRef} className="w-full h-[500px]" />
              </div>

              {/* 第三部分：細項分析 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* 基本面與產業題材 */}
                <div className="border border-[#141414] bg-white p-8 group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300">
                  <div className="flex items-center gap-3 mb-6">
                    <Newspaper className="w-6 h-6" />
                    <h3 className="font-serif italic text-xl">基本面與產業題材</h3>
                  </div>
                  <p className="text-sm leading-relaxed opacity-80 group-hover:opacity-100">
                    {data.aiAnalysis.fundamentalsAndNews}
                  </p>
                  {data.raw.newsHeadlines && data.raw.newsHeadlines.length > 0 && (
                    <div className="mt-6 space-y-2 border-t border-current/20 pt-4">
                      <p className="text-[10px] font-bold uppercase opacity-50 mb-2">相關時事新聞</p>
                      {data.raw.newsHeadlines.slice(0, 3).map((h: string, i: number) => (
                        <div key={i} className="text-xs truncate font-mono flex items-center gap-2">
                          <div className="w-1 h-1 bg-current rounded-full" />
                          {h}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 量價訊號分析 */}
                <div className="border border-[#141414] bg-white p-8 group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300">
                  <div className="flex items-center gap-3 mb-6">
                    <Activity className="w-6 h-6" />
                    <h3 className="font-serif italic text-xl">量價訊號 (量大不漲)</h3>
                  </div>
                  <p className="text-sm leading-relaxed opacity-80 group-hover:opacity-100 mb-6">
                    {data.aiAnalysis.volumeAnalysis}
                  </p>
                  
                  <div className="space-y-4">
                    <div className={`p-4 border border-current font-mono flex justify-between items-center ${data.raw.volumeSignal?.isTriggered ? 'bg-red-500/10' : 'opacity-60'}`}>
                      <div>
                        <span className="text-[10px] block opacity-50 uppercase">今日量能對比 (5日均)</span>
                        <span className="text-xs font-bold">{data.raw.volumeSignal?.isTriggered ? '⚠️ 觸發量能異常' : '目前量能平穩'}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] block opacity-50">倍數</span>
                        <span className="text-xl font-black">{data.raw.volumeSignal?.multiple?.toFixed(1)}x</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 border border-current/20 font-mono">
                        <span className="text-[10px] block opacity-50 uppercase">本週 vs 上週比例</span>
                        <span className="text-lg font-black text-blue-500">
                          {data.raw.volumeSignal?.weeklyComparison?.ratio?.toFixed(2)}x
                        </span>
                      </div>
                      <div className="p-3 border border-current/20 font-mono text-right">
                        <span className="text-[10px] block opacity-50 uppercase">本週總成交量</span>
                        <span className="text-sm font-bold">
                          {(data.raw.volumeSignal?.weeklyComparison?.thisWeekVol / 1000).toFixed(0)}K
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 籌碼面分析 */}
                <div className="md:col-span-2 border border-[#141414] bg-white p-8 group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300">
                  <div className="flex items-center gap-3 mb-6">
                    <Info className="w-6 h-6" />
                    <h3 className="font-serif italic text-xl">大戶籌碼與融資融券動向</h3>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <p className="text-sm leading-relaxed opacity-80 group-hover:opacity-100">
                      {data.aiAnalysis.chipsAnalysis}
                    </p>
                    
                    {/* 【詳細繁體中文註解】：台股個股法人與信用交易籌碼可視化 */}
                    {symbol.includes(".TW") || /^\d{4,6}$/.test(symbol) ? (
                      <div className="border border-current/20 p-4 font-mono text-xs space-y-4">
                        <div className="font-bold border-b border-current/20 pb-2 flex justify-between items-center">
                          <span className="uppercase">📊 證交所籌碼日報 ({chipData?.date || "連線中..."})</span>
                          {isLoadingChips && <span className="animate-pulse">● 更新中...</span>}
                        </div>
                        {chipData ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2 border-b border-current/10 pb-2">
                              <div>
                                <span className="text-[10px] block opacity-50">外資買賣超</span>
                                <span className={`text-sm font-bold ${chipData.foreignBuySell >= 0 ? "text-red-500" : "text-green-500"}`}>
                                  {chipData.foreignBuySell >= 0 ? "+" : ""}{(chipData.foreignBuySell / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 張
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] block opacity-50">投信買賣超</span>
                                <span className={`text-sm font-bold ${chipData.trustBuySell >= 0 ? "text-red-500" : "text-green-500"}`}>
                                  {chipData.trustBuySell >= 0 ? "+" : ""}{(chipData.trustBuySell / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 張
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] block opacity-50">自營商買賣超</span>
                                <span className={`text-sm font-bold ${chipData.dealerBuySell >= 0 ? "text-red-500" : "text-green-500"}`}>
                                  {chipData.dealerBuySell >= 0 ? "+" : ""}{(chipData.dealerBuySell / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 張
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <span className="text-[10px] block opacity-50">融資餘額</span>
                                <span className="text-sm font-bold text-blue-500">
                                  {chipData.marginBalance.toLocaleString()} 張
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] block opacity-50">融券餘額</span>
                                <span className="text-sm font-bold text-purple-500">
                                  {chipData.shortBalance.toLocaleString()} 張
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] block opacity-50">券資比</span>
                                <span className={`text-sm font-bold ${chipData.shortMarginRatio > 20 ? "text-red-500" : "text-gray-500"}`}>
                                  {chipData.shortMarginRatio}%
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="py-4 text-center opacity-40 italic">
                            {isLoadingChips ? "讀取證交所籌碼資料中..." : "暫無最新籌碼數據"}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="border border-current/20 p-4 font-mono text-[10px] space-y-2 opacity-60 group-hover:opacity-100 flex flex-col justify-center">
                        <p className="font-bold border-b border-current/20 pb-2 mb-2 uppercase">美股籌碼說明</p>
                        <p>美股無每日法人申報制度，籌碼分析主要依據 AI 整合季度 13F 機構申報及盤中大宗交易（Block Trades）進行文字判讀。</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 同業表現對比 */}
                <div className="md:col-span-2 border border-[#141414] bg-white p-8 group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <BarChart3 className="w-6 h-6" />
                      <h3 className="font-serif italic text-xl">同業表現與連動對比</h3>
                    </div>
                    <span className="text-[10px] font-bold uppercase opacity-40">Sector Peers Analysis</span>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.raw.peersData && data.raw.peersData.length > 0 ? (
                      data.raw.peersData.map((peer: any) => (
                        <div key={peer.symbol} className="border border-current/20 p-4 flex justify-between items-center group/item hover:border-current transition-colors">
                          <div>
                            <p className="text-xs font-bold truncate max-w-[120px]">{peer.name || peer.symbol}</p>
                            <p className="text-[10px] font-mono opacity-50 uppercase">{peer.symbol}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black font-mono">{peer.price?.toFixed(2)}</p>
                            <p className={`text-[10px] font-bold ${peer.changePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {peer.changePercent >= 0 ? '+' : ''}{peer.changePercent?.toFixed(2)}%
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="col-span-full text-center text-xs opacity-40 py-8 italic">目前無相關同業數據</p>
                    )}
                  </div>
                  <p className="mt-6 text-[10px] opacity-40 leading-relaxed italic border-t border-current/10 pt-4">
                    註：同業名單由系統自動生成。透過觀察同類股的漲跌連動，可以判斷目前是「個股表現」還是「板塊集體發動」。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error / Initial State */}
          {!data && !isLoading && (
            <div className="h-96 border border-[#141414] border-dashed flex flex-col items-center justify-center space-y-4 opacity-30">
              <TrendingUp className="w-16 h-16" />
              <p className="font-serif italic text-xl">請輸入股票代號開始深度分析</p>
            </div>
          )}

          {data?.error && (
            <div className="p-8 border border-red-500 bg-red-50 text-red-700 font-mono text-sm text-center">
              分析錯誤：{data.error}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
