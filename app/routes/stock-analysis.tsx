import { useState, useEffect, useRef } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { AppLayout } from "../components/AppLayout";
import { init, dispose, Chart } from "klinecharts";
import { TrendingUp, BarChart3 } from "lucide-react";
import { FinancialEvidenceCard, ProgramEvidenceList } from '../features/stockResearch/EvidencePanel';
import { StockAnalysisDetails } from '../features/stockResearch/StockAnalysisDetails';
import { StockAnalysisHeader } from '../features/stockResearch/StockAnalysisHeader';
import type { PublicResearch } from '../services/stockResearch/types';

/**
 * 【詳細繁體中文註解】：重新設計的個股深度分析儀表板
 * 採用與 Portfolio 一致的輕簡、高級感 UI 風格，並整合 klinecharts 圖表。
 */
export default function StockAnalysisDashboard() {
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState(() => searchParams.get('symbol')?.trim().toUpperCase() || '2330.TW');
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
      { symbol, market: /\.TW(?:O)?$/.test(symbol) || /^\d{4,6}$/.test(symbol) ? "TW" : "US" },
      { method: "get", action: "/api/analyze-stock" }
    );
  };

  const isLoading = fetcher.state === "loading" || fetcher.state === "submitting";
  const data = fetcher.data as any;
  const publicResearch = data?.raw?.publicResearch as PublicResearch | undefined;

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
        <StockAnalysisHeader symbol={symbol} isLoading={isLoading} onSymbolChange={setSymbol} onAnalyze={handleAnalyze} />

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
              {publicResearch?.financials && <FinancialEvidenceCard financials={publicResearch.financials} />}
              {publicResearch && <section className="space-y-4">
                <h3 className="text-xl font-bold">公開節目標題提及</h3>
                <ProgramEvidenceList programs={publicResearch.programs.filter(program => program.stocks.some(stock => stock.code === publicResearch.financials?.code))} />
              </section>}
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

              <StockAnalysisDetails data={data} symbol={symbol} chipData={chipData} isLoadingChips={isLoadingChips} />
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
