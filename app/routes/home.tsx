/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, dispose, init } from 'klinecharts';
import { useRouteLoaderData } from "react-router";
import { AppLayout } from '../components/AppLayout';
import {
  evaluateConsecutiveVolume,
  evaluateVolumeNoBreakout,
  fetchStockData,
  getStockName,
  getTradingSignal,
} from '../services/stockService';
import type { StockDataPoint, Timeframe } from '../types';
import { buildScannerPrompt, buildStrategyPrompt } from '../features/home/ai-prompts';
import { evaluateDailyVolumeSpike } from '../features/home/scanner-strategies';
import { HomeHeader } from '../features/home/components/HomeHeader';
import { LeftSidebar } from '../features/home/components/LeftSidebar';
import { MainChartPanel } from '../features/home/components/MainChartPanel';
import { MarketHotPicks } from '../features/home/components/MarketHotPicks';
import { STOCKS } from '../features/home/constants/markets';
import {
  STRATEGY_OVERLAY_GROUP_ID,
  buildStrategyLayers,
  filterStrategyLayersByVisibleData,
} from '../features/home/strategy-overlays';
import type {
  AIStrategy,
  IndicatorVisibility,
  MarketKey,
  PortfolioStock,
  ScanResult,
  ScanStrategy,
  StockOption,
  StrategyOverlayId,
  StrategyOverlayLayer,
} from '../features/home/types';

const DEFAULT_INDICATORS: IndicatorVisibility = {
  ma5: true,
  ma10: true,
  ma20: true,
  ma60: true,
  ma120: true,
  ema: true,
  volume: true,
  kd: true,
  macd: true,
  rsi: true,
};

const filterDataByTimeRange = (
  data: StockDataPoint[],
  timeRange: string,
  timeframe: Timeframe
) => {
  if (!data || data.length === 0) return [];

  // 分鐘與 4H 資料通常只抓短期資料，直接完整顯示，避免再被日線 range 裁掉。
  if (timeframe !== '1d') return data;

  const now = new Date();
  let daysToSubtract = 500;

  switch (timeRange) {
    case '1D': daysToSubtract = 1; break;
    case '1W': daysToSubtract = 7; break;
    case '1M': daysToSubtract = 30; break;
    case '3M': daysToSubtract = 90; break;
    case '6M': daysToSubtract = 180; break;
    case '1Y': daysToSubtract = 365; break;
    case '2Y': daysToSubtract = 730; break;
    case '5Y': daysToSubtract = 1825; break;
    default: daysToSubtract = 500;
  }

  const cutoffDate = new Date(now.setDate(now.getDate() - daysToSubtract));
  return data.filter(item => new Date(item.timestamp) >= cutoffDate);
};

export default function App() {
  const [market, setMarket] = useState<MarketKey>('US');
  const [currentStocks, setCurrentStocks] = useState<StockOption[]>(STOCKS.US);
  const [selectedStock, setSelectedStock] = useState<StockOption>(STOCKS.US[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState<StockDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasRunScan, setHasRunScan] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiStrategy, setAiStrategy] = useState<AIStrategy | null>(null);
  const [isGeneratingStrategy, setIsGeneratingStrategy] = useState(false);
  const [scanStrategy, setScanStrategy] = useState<ScanStrategy>('trend');
  const [scanTimeframe, setScanTimeframe] = useState<Timeframe>('1d');
  const [enabledStrategyLayers, setEnabledStrategyLayers] = useState<StrategyOverlayId[]>(['big_fish', 'extreme_reversal']);
  const [portfolio, setPortfolio] = useState<PortfolioStock[]>([]);
  const [isAnalyzingPortfolio, setIsAnalyzingPortfolio] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAddingToPortfolio, setIsAddingToPortfolio] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('3M');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [showIndicators, setShowIndicators] = useState<IndicatorVisibility>(DEFAULT_INDICATORS);

  const hotPicksRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<Chart | null>(null);
  const rootData = useRouteLoaderData<{ user: { id: number, email: string } | null }>("root");
  const user = rootData?.user;

  const fetchPortfolio = async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) {
        const portfolioData = await res.json();
        setPortfolio(portfolioData.portfolio || []);
      }
    } catch (err) {
      console.error("Failed to fetch portfolio:", err);
    }
  };

  useEffect(() => {
    fetchPortfolio();
  }, [user]);

  const addToPortfolio = async (stock: StockOption) => {
    if (!user) {
      alert("請先登入後再加入持股");
      return;
    }
    setIsAddingToPortfolio(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...stock, market })
      });
      if (res.ok) {
        await fetchPortfolio();
        alert(`已將 ${stock.name} 加入持股清單`);
      } else {
        const errData = await res.json();
        alert(`加入失敗: ${errData.error || "未知錯誤"}`);
      }
    } catch (err) {
      console.error("Add failed:", err);
      alert("系統錯誤，請稍後再試");
    } finally {
      setIsAddingToPortfolio(false);
    }
  };

  const removeFromPortfolio = async (symbol: string) => {
    try {
      const res = await fetch("/api/portfolio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      if (res.ok) fetchPortfolio();
    } catch (err) {
      console.error("Remove failed:", err);
    }
  };

  const analyzePortfolioStock = async (stock: PortfolioStock) => {
    setIsAnalyzingPortfolio(stock.symbol);
    setAnalysisResult(null);
    try {
      const res = await fetch(`/api/analyze-stock?symbol=${encodeURIComponent(stock.symbol)}&market=${stock.market}`);
      if (res.ok) {
        const result = await res.json();
        setAnalysisResult(result);
      }
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setIsAnalyzingPortfolio(null);
    }
  };

  const updatePortfolioDetails = async (symbol: string, avgPrice: string, shares: string) => {
    try {
      const res = await fetch("/api/portfolio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, avgPrice, shares })
      });
      if (res.ok) fetchPortfolio();
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  const portfolioSummary = useMemo(() => {
    let totalCost = 0;
    let totalValue = 0;
    let wins = 0;
    let totalWithCost = 0;

    portfolio.forEach(stock => {
      if (stock.avgPrice && stock.shares && stock.currentPrice) {
        const cost = parseFloat(stock.avgPrice) * parseFloat(stock.shares);
        const value = stock.currentPrice * parseFloat(stock.shares);
        totalCost += cost;
        totalValue += value;
        totalWithCost++;
        if (value > cost) wins++;
      }
    });

    return {
      totalPnL: totalValue - totalCost,
      totalROI: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      winRate: totalWithCost > 0 ? (wins / totalWithCost) * 100 : 0,
      totalCost
    };
  }, [portfolio]);

  useEffect(() => {
    const fetchTop50 = async () => {
      try {
        const res = await fetch(`/api/top50?market=${market}`);
        if (res.ok) {
          const top50Data = await res.json();
          if (top50Data.symbols && top50Data.symbols.length > 0) {
            setCurrentStocks(top50Data.symbols);
          }
        }
      } catch (err) {
        console.error(`Failed to fetch top 50 for ${market}:`, err);
      }
    };
    fetchTop50();
  }, [market]);

  useEffect(() => {
    if (scanning && hotPicksRef.current) {
      hotPicksRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [scanning]);

  useEffect(() => {
    setAiStrategy(null);
  }, [selectedStock.symbol]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!searchQuery) return;

    let symbol = searchQuery.toUpperCase();
    if (market === 'TW' && /^\d{4,6}$/.test(symbol)) {
      symbol += '.TW';
    } else if (market === 'CRYPTO' && !symbol.includes('/') && !symbol.includes('-')) {
      symbol += '/USD';
    }

    const existing = currentStocks.find(stock => stock.symbol === symbol);
    if (existing) {
      setSelectedStock(existing);
    } else {
      setSelectedStock({
        symbol,
        name: market === 'TW' ? getStockName(symbol) : symbol
      });
    }
    setSearchQuery('');
  };

  const handleMarketChange = (newMarket: MarketKey) => {
    setMarket(newMarket);
    setCurrentStocks(STOCKS[newMarket]);
    setSelectedStock(STOCKS[newMarket][0]);
    setScanResults([]);
    setHasRunScan(false);
    setScanProgress(0);
    setLastUpdated(null);
    setAiStrategy(null);
  };

  const generateStrategy = async () => {
    if (!data || data.length === 0) return;
    setIsGeneratingStrategy(true);
    try {
      const latestMarketData = data[data.length - 1];
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "strategy",
          prompt: buildStrategyPrompt({ selectedStock, market, latestData: latestMarketData })
        })
      });

      // 【詳細繁體中文註解】：驗證後端 API 響應是否成功，避免 500 錯誤時錯誤將 Error Payload 塞入 Strategy 狀態
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `伺服器回應錯誤 (狀態碼: ${response.status})`);
      }

      const result = await response.json();
      setAiStrategy(result);
    } catch (err: any) {
      console.error("Failed to generate strategy:", err);
      // 【詳細繁體中文註解】：當 API 密鑰失效 (403) 時，正確彈出警告提示，而不是誤導用戶為格式異常
      alert(`AI 分析失敗: ${err.message}`);
    } finally {
      setIsGeneratingStrategy(false);
    }
  };

  const runScanner = async () => {
    setScanning(true);
    setHasRunScan(true);
    setScanProgress(0);

    const results: ScanResult[] = [];
    const currentList = currentStocks;
    const total = currentList.length;

    for (let i = 0; i < currentList.length; i++) {
      const stock = currentList[i];
      setScanProgress(Math.round(((i + 1) / total) * 100));
      try {
        if (scanStrategy === 'consecutive_volume') {
          const res = await evaluateConsecutiveVolume(stock.symbol, scanTimeframe, 1.5);
          if (res.isTriggered) {
            results.push({
              symbol: stock.symbol,
              name: stock.name,
              score: Math.min(100, 50 + res.consecutiveDays * 15),
              reason: res.reasons.join(", "),
              trend: 'up'
            });
          }
        } else if (scanStrategy === 'volume_no_break') {
          const res = await evaluateVolumeNoBreakout(stock.symbol, scanTimeframe, 1.5);
          if (res.isTriggered) {
            results.push({
              symbol: stock.symbol,
              name: stock.name,
              score: 75,
              reason: res.reasons.join(", "),
              trend: 'down'
            });
          }
        } else if (scanStrategy === 'daily_volume_spike') {
          const res = await evaluateDailyVolumeSpike(stock.symbol, 4);
          if (res.isTriggered) {
            results.push({
              symbol: stock.symbol,
              name: stock.name,
              score: Math.min(100, Math.round(60 + res.volumeMultiple * 8)),
              reason: res.reasons.join(", "),
              trend: res.closeTrend
            });
          }
        } else {
          const { data: stockData } = await fetchStockData(stock.symbol, 60, scanTimeframe);
          if (stockData.length < 20) continue;

          const latest = stockData[stockData.length - 1];
          const prev = stockData[stockData.length - 2];
          const trend = latest.ma20! > prev.ma20! ? 'up' : 'down';
          let score = 0;
          const reasons: string[] = [];

          if (market === 'CRYPTO') {
            if (latest.close > latest.emaLong!) {
              score += 30;
              reasons.push("趨勢偏多(站上EMA)");
            }
            if (latest.rsi! < 30) {
              score += 50;
              reasons.push("RSI 極度超賣");
            } else if (latest.rsi! < 45) {
              score += 30;
              reasons.push("RSI 偏低回調");
            }
            if (latest.macdHist! > prev.macdHist!) {
              score += 20;
              reasons.push("MACD 動能轉強");
            }
          } else {
            const isAboveMA20 = latest.close > latest.ma20!;
            const isAboveEMA50 = latest.close > latest.emaLong!;

            if (isAboveMA20 || isAboveEMA50) {
              score += 40;
              reasons.push("中期趨勢向上");
              if (latest.rsi! < 55 && latest.rsi! > 35) {
                score += 30;
                reasons.push("指標健康回調");
              }
              const distToMA20 = Math.abs(latest.close - latest.ma20!) / latest.ma20!;
              if (distToMA20 < 0.03 && latest.close >= latest.ma20!) {
                score += 30;
                reasons.push("回測均線支撐");
              }
            } else if (prev.close <= prev.ma20! && latest.close > latest.ma20!) {
              score += 50;
              reasons.push("強勢站上月線");
            }
          }

          if (score >= 40) {
            results.push({
              symbol: stock.symbol,
              name: stock.name,
              score,
              reason: reasons.join(", ") || "趨勢穩定",
              trend
            });
          }
        }
      } catch (error) {
        console.error(`Error scanning ${stock.symbol}:`, error);
      }
    }

    const topCandidates = results.sort((a, b) => b.score - a.score).slice(0, 15);

    if (topCandidates.length > 0) {
      setScanResults(topCandidates.slice(0, 10));
      setLastUpdated(new Date().toLocaleTimeString());
      setIsAiAnalyzing(true);
      try {
        const response = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "scanner",
            prompt: buildScannerPrompt(topCandidates, scanStrategy, scanTimeframe)
          })
        });

        const aiData = await response.json();
        const recommendations = Array.isArray(aiData) ? aiData : (aiData.recommendations || []);
        const aiMap = new Map(recommendations.map((recommendation: any) => [recommendation.symbol, recommendation.aiInsight]));
        const finalResults = topCandidates.map(result => ({
          ...result,
          aiInsight: aiMap.get(result.symbol) as string || result.reason || "技術面轉強，建議關注"
        })).slice(0, 10);

        setScanResults(finalResults);
      } catch (err) {
        console.error('AI Analysis failed:', err);
        setScanResults(prev => prev.map(result => ({
          ...result,
          aiInsight: result.aiInsight || result.reason || "技術面趨勢形成，建議關注"
        })));
      } finally {
        setIsAiAnalyzing(false);
      }
    } else {
      setScanResults([]);
      setLastUpdated(null);
    }

    setScanning(false);
    setScanProgress(0);
  };

  const toggleIndicator = (key: keyof IndicatorVisibility) => {
    setShowIndicators(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const refreshData = () => {
    setLoading(true);
    fetchStockData(selectedStock.symbol, 500, timeframe).then(({ data: newData, name }) => {
      setData(newData);
      if (name && name !== selectedStock.symbol && selectedStock.name === selectedStock.symbol) {
        setSelectedStock(prev => ({ ...prev, name }));
      }
      setLoading(false);
    });
  };

  useEffect(() => {
    refreshData();
  }, [selectedStock, timeframe]);

  const filteredData = useMemo(
    () => filterDataByTimeRange(data, timeRange, timeframe),
    [data, timeRange, timeframe]
  );
  const allStrategyLayers = useMemo(() => buildStrategyLayers(data), [data]);
  const strategyLayers = useMemo(
    () => filterStrategyLayersByVisibleData(allStrategyLayers, filteredData),
    [allStrategyLayers, filteredData]
  );
  const activeStrategyLayers = useMemo(
    () => strategyLayers.filter(layer => enabledStrategyLayers.includes(layer.strategyId)),
    [strategyLayers, enabledStrategyLayers]
  );
  const activeStrategySignalCount = activeStrategyLayers.reduce((sum, layer) => sum + layer.events.length, 0);
  const totalStrategySignalCount = allStrategyLayers
    .filter(layer => enabledStrategyLayers.includes(layer.strategyId))
    .reduce((sum, layer) => sum + layer.events.length, 0);

  const signal = useMemo(() => getTradingSignal(data), [data]);
  const currentPrice = data.length > 0 ? data[data.length - 1].close : 0;
  const prevPrice = data.length > 1 ? data[data.length - 2].close : 0;
  const priceChange = currentPrice - prevPrice;
  const priceChangePercent = prevPrice !== 0 ? (priceChange / prevPrice) * 100 : 0;
  const latestRsi = data.length > 0 ? data[data.length - 1].rsi : 0;
  const latestEmaShort = data.length > 0 ? data[data.length - 1].emaShort : 0;
  const latestEmaLong = data.length > 0 ? data[data.length - 1].emaLong : 0;
  const latestData = data.length > 0 ? data[data.length - 1] : null;

  const toggleStrategyLayer = (strategyId: StrategyOverlayId) => {
    setEnabledStrategyLayers(prev => {
      if (prev.includes(strategyId)) {
        return prev.filter(id => id !== strategyId);
      }
      return [...prev, strategyId];
    });
  };

  const renderStrategyOverlays = (layers: StrategyOverlayLayer[]) => {
    const chart = chartInstance.current;
    if (!chart) return;

    try {
      chart.removeOverlay({ groupId: STRATEGY_OVERLAY_GROUP_ID });

      const eventOverlays = layers.flatMap(layer => layer.events.map(event => {
        const eventColor = event.color ?? layer.color;

        return {
          name: 'simpleAnnotation',
          groupId: STRATEGY_OVERLAY_GROUP_ID,
          lock: true,
          visible: true,
          zLevel: 20,
          points: [{ timestamp: event.timestamp, value: event.price }],
          extendData: `${event.icon} ${event.label}`,
          styles: {
            line: { color: eventColor, size: 2, style: 'solid' },
            polygon: { color: eventColor, borderColor: eventColor, borderSize: 1, style: 'fill' },
            text: {
              color: '#ffffff',
              size: 10,
              family: 'monospace',
              weight: 700,
              backgroundColor: eventColor,
              borderColor: eventColor,
              borderSize: 1,
              borderRadius: 2,
              paddingLeft: 4,
              paddingRight: 4,
              paddingTop: 2,
              paddingBottom: 2,
            },
          },
        };
      }));

      const lineOverlays = layers.flatMap(layer => layer.lines.map(line => ({
        name: 'segment',
        groupId: STRATEGY_OVERLAY_GROUP_ID,
        lock: true,
        visible: true,
        zLevel: 8,
        points: [
          { timestamp: line.fromTimestamp, value: line.fromPrice },
          { timestamp: line.toTimestamp, value: line.toPrice },
        ],
        styles: {
          line: {
            color: line.color,
            size: line.label === '牛熊生命線' ? 1 : 2,
            style: 'solid',
          },
        },
      })));

      const overlays = [...lineOverlays, ...eventOverlays];
      if (overlays.length > 0) chart.createOverlay(overlays as any, 'main');
    } catch (error) {
      console.error('Error rendering strategy overlays:', error);
    }
  };

  const applyChartData = (chartData: StockDataPoint[]) => {
    const chart = chartInstance.current;
    if (!chart) return;

    if (chartData.length === 0) {
      try {
        if (typeof (chart as any).applyNewData === 'function') {
          (chart as any).applyNewData([]);
        } else if (typeof (chart as any).applyData === 'function') {
          (chart as any).applyData([]);
        }
      } catch (err) {
        console.error('Error clearing chart data:', err);
      }
      return;
    }

    const formattedData = [...chartData]
      .filter(item => item && !isNaN(item.timestamp) && !isNaN(item.close))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(item => ({
        timestamp: item.timestamp,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
        rsi: item.rsi,
        macdHist: item.macdHist,
        k: item.k,
        d: item.d
      }));

    try {
      if (typeof (chart as any).applyNewData === 'function') {
        (chart as any).applyNewData(formattedData);
      } else if (typeof (chart as any).applyData === 'function') {
        (chart as any).applyData(formattedData);
      }
      chart.resize();
    } catch (err) {
      console.error('Error applying chart data:', err);
    }
  };

  const updateIndicators = () => {
    const chart = chartInstance.current;
    if (!chart) return;

    try {
      const maParams: number[] = [];
      if (showIndicators.ma5) maParams.push(5);
      if (showIndicators.ma10) maParams.push(10);
      if (showIndicators.ma20) maParams.push(20);
      if (showIndicators.ma60) maParams.push(60);
      if (showIndicators.ma120) maParams.push(120);

      if (maParams.length > 0) {
        chart.createIndicator({ name: 'MA', calcParams: maParams }, false, { id: 'main' });
      } else {
        chart.removeIndicator('main', 'MA');
      }

      if (showIndicators.ema) {
        chart.createIndicator({ name: 'EMA', calcParams: [12, 26] }, false, { id: 'main' });
      } else {
        chart.removeIndicator('main', 'EMA');
      }

      const manageSubPane = (name: string, show: boolean, paneId: string) => {
        if (show) {
          chart.createIndicator(name, false, { id: paneId });
          chart.setPaneOptions({ id: paneId, height: 100, minHeight: 60 });
        } else {
          chart.removeIndicator(paneId, name);
        }
      };

      manageSubPane('VOL', showIndicators.volume, 'pane_vol');
      manageSubPane('MACD', showIndicators.macd, 'pane_macd');
      manageSubPane('RSI', showIndicators.rsi, 'pane_rsi');
      manageSubPane('KDJ', showIndicators.kd, 'pane_kdj');
      chart.setPaneOptions({ id: 'main', minHeight: 250 });

      setTimeout(() => chart.resize(), 10);
      setTimeout(() => chart.resize(), 100);
      setTimeout(() => chart.resize(), 300);
    } catch (error) {
      console.error('Error updating indicators:', error);
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let rafId: number;
    const chart = init(chartContainerRef.current);
    chartInstance.current = chart;

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
      },
      indicator: {
        tooltip: {
          showRule: 'always' as any,
          showType: 'standard' as any
        }
      }
    });

    if (filteredData.length > 0) {
      applyChartData(filteredData);
      timeoutId = setTimeout(() => {
        if (chartInstance.current) {
          updateIndicators();
          renderStrategyOverlays(activeStrategyLayers);
        }
      }, 50);
    }

    const resizeObserver = new ResizeObserver(() => {
      rafId = window.requestAnimationFrame(() => {
        chartInstance.current?.resize();
      });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      if (chartContainerRef.current) dispose(chartContainerRef.current);
      chartInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartInstance.current && filteredData.length > 0) {
      applyChartData(filteredData);
      updateIndicators();
      renderStrategyOverlays(activeStrategyLayers);
    }
  }, [filteredData]);

  useEffect(() => {
    if (chartInstance.current) updateIndicators();
  }, [showIndicators]);

  useEffect(() => {
    if (chartInstance.current) renderStrategyOverlays(activeStrategyLayers);
  }, [activeStrategyLayers]);

  return (
    <AppLayout>
      <HomeHeader
        market={market}
        currentStocks={currentStocks}
        selectedStock={selectedStock}
        searchQuery={searchQuery}
        data={data}
        loading={loading}
        onSearchQueryChange={setSearchQuery}
        onSelectedStockChange={setSelectedStock}
        onSearch={handleSearch}
        onMarketChange={handleMarketChange}
        onRefreshData={refreshData}
      />

      <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-8 overflow-x-hidden">
        <LeftSidebar
          market={market}
          user={user}
          currentStocks={currentStocks}
          selectedStock={selectedStock}
          scanResults={scanResults}
          scanStrategy={scanStrategy}
          scanTimeframe={scanTimeframe}
          scanning={scanning}
          isAiAnalyzing={isAiAnalyzing}
          portfolio={portfolio}
          portfolioSummary={portfolioSummary}
          isAnalyzingPortfolio={isAnalyzingPortfolio}
          analysisResult={analysisResult}
          signal={signal}
          aiStrategy={aiStrategy}
          isGeneratingStrategy={isGeneratingStrategy}
          latestRsi={latestRsi}
          latestData={latestData}
          latestEmaShort={latestEmaShort}
          latestEmaLong={latestEmaLong}
          onRunScanner={runScanner}
          onSelectedStockChange={setSelectedStock}
          onRemoveFromPortfolio={removeFromPortfolio}
          onAnalyzePortfolioStock={analyzePortfolioStock}
          onUpdatePortfolioDetails={updatePortfolioDetails}
          onClearAnalysisResult={() => setAnalysisResult(null)}
          onGenerateStrategy={generateStrategy}
        />

        <div className="lg:col-span-3 flex flex-col gap-4">
          <MarketHotPicks
            hotPicksRef={hotPicksRef}
            market={market}
            selectedStock={selectedStock}
            scanResults={scanResults}
            scanStrategy={scanStrategy}
            scanTimeframe={scanTimeframe}
            scanning={scanning}
            hasRunScan={hasRunScan}
            scanProgress={scanProgress}
            isAiAnalyzing={isAiAnalyzing}
            lastUpdated={lastUpdated}
            onRunScanner={runScanner}
            onSelectedStockChange={setSelectedStock}
            onScanStrategyChange={setScanStrategy}
            onScanTimeframeChange={setScanTimeframe}
          />
          <MainChartPanel
            selectedStock={selectedStock}
            user={user}
            portfolio={portfolio}
            isAddingToPortfolio={isAddingToPortfolio}
            latestData={latestData}
            currentPrice={currentPrice}
            priceChange={priceChange}
            priceChangePercent={priceChangePercent}
            filteredData={filteredData}
            loading={loading}
            isAiAnalyzing={isAiAnalyzing}
            timeframe={timeframe}
            timeRange={timeRange}
            showIndicators={showIndicators}
            strategyLayers={strategyLayers}
            allStrategyLayers={allStrategyLayers}
            enabledStrategyLayers={enabledStrategyLayers}
            activeStrategySignalCount={activeStrategySignalCount}
            totalStrategySignalCount={totalStrategySignalCount}
            chartContainerRef={chartContainerRef}
            onTimeframeChange={setTimeframe}
            onTimeRangeChange={setTimeRange}
            onToggleIndicator={toggleIndicator}
            onToggleStrategyLayer={toggleStrategyLayer}
            onSetEnabledStrategyLayers={setEnabledStrategyLayers}
            onAddToPortfolio={addToPortfolio}
            onRemoveFromPortfolio={removeFromPortfolio}
          />
        </div>
      </div>

      <footer className="p-4 md:p-8 border-t border-[#141414] bg-[#E4E3E0] flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
        <div className="text-[9px] md:text-[10px] font-mono opacity-40 uppercase tracking-[0.1em] md:tracking-[0.2em]">
          Algorithm: EMA Crossover + RSI Momentum - v1.0.4
        </div>
        <div className="flex flex-wrap justify-center gap-4 md:gap-6">
          <a href="#" className="text-[9px] md:text-[10px] font-mono opacity-40 hover:opacity-100 uppercase tracking-widest transition-opacity">Documentation</a>
          <a href="#" className="text-[9px] md:text-[10px] font-mono opacity-40 hover:opacity-100 uppercase tracking-widest transition-opacity">API Status</a>
          <a href="#" className="text-[9px] md:text-[10px] font-mono opacity-40 hover:opacity-100 uppercase tracking-widest transition-opacity">Disclaimer</a>
        </div>
      </footer>

      {loading && (
        <div className="fixed inset-0 bg-[#E4E3E0]/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-[#141414] border-t-transparent rounded-full animate-spin" />
            <div className="font-serif italic text-sm tracking-widest animate-pulse">Syncing Market Data...</div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
