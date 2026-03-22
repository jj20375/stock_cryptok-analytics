/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { init, dispose, Chart } from 'klinecharts';
import { 
  TrendingUp, TrendingDown, Activity, Info, RefreshCw, 
  ChevronRight, ArrowUpRight, ArrowDownRight, Search, 
  LayoutGrid, List, Settings, Bell, User, Zap, AlertCircle
} from 'lucide-react';
import { fetchStockData, getTradingSignal, getStockName } from '../services/stockService';
import { StockDataPoint, Signal, Timeframe } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const STOCKS = {
  US: [
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'TSLA', name: 'Tesla, Inc.' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.' },
    { symbol: 'AMZN', name: 'Amazon.com' },
    { symbol: 'META', name: 'Meta Platforms' },
    { symbol: 'NFLX', name: 'Netflix, Inc.' },
    { symbol: 'AMD', name: 'AMD' },
    { symbol: 'INTC', name: 'Intel Corp.' },
    { symbol: 'AVGO', name: 'Broadcom' },
    { symbol: 'COIN', name: 'Coinbase' },
    { symbol: 'PLTR', name: 'Palantir' },
    { symbol: 'ARM', name: 'ARM Holdings' },
    { symbol: 'SMCI', name: 'Super Micro' },
    { symbol: 'QCOM', name: 'Qualcomm' },
    { symbol: 'MU', name: 'Micron Technology' },
    { symbol: 'TSM', name: 'TSMC ADR' },
    { symbol: 'ASML', name: 'ASML Holding' },
    { symbol: 'LLY', name: 'Eli Lilly' },
    { symbol: 'NVO', name: 'Novo Nordisk' },
    { symbol: 'V', name: 'Visa Inc.' },
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'WMT', name: 'Walmart' },
    { symbol: 'MA', name: 'Mastercard' },
    { symbol: 'PG', name: 'Procter & Gamble' },
    { symbol: 'JNJ', name: 'Johnson & Johnson' },
    { symbol: 'HD', name: 'Home Depot' },
    { symbol: 'ORCL', name: 'Oracle' },
    { symbol: 'COST', name: 'Costco' },
    { symbol: 'CRM', name: 'Salesforce' },
    { symbol: 'BAC', name: 'Bank of America' },
    { symbol: 'ABBV', name: 'AbbVie' },
    { symbol: 'CVX', name: 'Chevron' },
    { symbol: 'KO', name: 'Coca-Cola' },
    { symbol: 'PEP', name: 'PepsiCo' },
    { symbol: 'MRK', name: 'Merck & Co.' },
    { symbol: 'TMO', name: 'Thermo Fisher' },
    { symbol: 'DIS', name: 'Walt Disney' },
    { symbol: 'ADBE', name: 'Adobe' },
    { symbol: 'CSCO', name: 'Cisco Systems' },
    { symbol: 'MCD', name: 'McDonald\'s' },
    { symbol: 'AXP', name: 'American Express' },
    { symbol: 'ABT', name: 'Abbott Labs' },
    { symbol: 'IBM', name: 'IBM' },
    { symbol: 'CAT', name: 'Caterpillar' },
    { symbol: 'GE', name: 'General Electric' },
    { symbol: 'BA', name: 'Boeing' },
    { symbol: 'MMM', name: '3M Company' },
    { symbol: 'XOM', name: 'Exxon Mobil' }
  ],
  TW: [
    { symbol: '2330.TW', name: '台積電' },
    { symbol: '2317.TW', name: '鴻海' },
    { symbol: '2454.TW', name: '聯發科' },
    { symbol: '2881.TW', name: '富邦金' },
    { symbol: '2303.TW', name: '聯電' },
    { symbol: '2603.TW', name: '長榮' },
    { symbol: '2382.TW', name: '廣達' },
    { symbol: '2308.TW', name: '台達電' },
    { symbol: '3231.TW', name: '緯創' },
    { symbol: '2356.TW', name: '英業達' },
    { symbol: '2376.TW', name: '技嘉' },
    { symbol: '2377.TW', name: '微星' },
    { symbol: '2609.TW', name: '陽明' },
    { symbol: '2615.TW', name: '萬海' },
    { symbol: '2882.TW', name: '國泰金' },
    { symbol: '2886.TW', name: '兆豐金' },
    { symbol: '2891.TW', name: '中信金' },
    { symbol: '2002.TW', name: '中鋼' },
    { symbol: '2412.TW', name: '中華電' },
    { symbol: '2884.TW', name: '玉山金' },
    { symbol: '2892.TW', name: '第一金' },
    { symbol: '2885.TW', name: '元大金' },
    { symbol: '2880.TW', name: '華南金' },
    { symbol: '2883.TW', name: '開發金' },
    { symbol: '2887.TW', name: '台新金' },
    { symbol: '2890.TW', name: '永豐金' },
    { symbol: '5880.TW', name: '合庫金' },
    { symbol: '1101.TW', name: '台泥' },
    { symbol: '1301.TW', name: '台塑' },
    { symbol: '1303.TW', name: '南亞' },
    { symbol: '1326.TW', name: '台化' },
    { symbol: '2301.TW', name: '光寶科' },
    { symbol: '2324.TW', name: '仁寶' },
    { symbol: '2353.TW', name: '宏碁' },
    { symbol: '2357.TW', name: '華碩' },
    { symbol: '2395.TW', name: '研華' },
    { symbol: '2408.TW', name: '南亞科' },
    { symbol: '3008.TW', name: '大立光' },
    { symbol: '3034.TW', name: '聯詠' },
    { symbol: '3045.TW', name: '台灣大' },
    { symbol: '3711.TW', name: '日月光投控' },
    { symbol: '4904.TW', name: '遠傳' },
    { symbol: '4938.TW', name: '和碩' },
    { symbol: '5871.TW', name: '中租-KY' },
    { symbol: '6669.TW', name: '緯穎' },
    { symbol: '9904.TW', name: '寶成' },
    { symbol: '2345.TW', name: '智邦' },
    { symbol: '2383.TW', name: '台光電' },
    { symbol: '3017.TW', name: '奇鋐' },
    { symbol: '3324.TW', name: '雙鴻' }
  ],
  CRYPTO: [
    { symbol: 'BTC/USD', name: 'Bitcoin' },
    { symbol: 'ETH/USD', name: 'Ethereum' },
    { symbol: 'SOL/USD', name: 'Solana' },
    { symbol: 'BNB/USD', name: 'Binance Coin' },
    { symbol: 'DOGE/USD', name: 'Dogecoin' },
    { symbol: 'XRP/USD', name: 'Ripple' },
    { symbol: 'ADA/USD', name: 'Cardano' },
    { symbol: 'AVAX/USD', name: 'Avalanche' },
    { symbol: 'DOT/USD', name: 'Polkadot' },
    { symbol: 'LINK/USD', name: 'Chainlink' },
    { symbol: 'MATIC/USD', name: 'Polygon' },
    { symbol: 'NEAR/USD', name: 'Near Protocol' },
    { symbol: 'APT/USD', name: 'Aptos' },
    { symbol: 'SUI/USD', name: 'Sui' },
    { symbol: 'PEPE/USD', name: 'Pepe' },
    { symbol: 'SHIB/USD', name: 'Shiba Inu' },
    { symbol: 'LTC/USD', name: 'Litecoin' },
    { symbol: 'BCH/USD', name: 'Bitcoin Cash' },
    { symbol: 'UNI/USD', name: 'Uniswap' },
    { symbol: 'ATOM/USD', name: 'Cosmos' },
    { symbol: 'XLM/USD', name: 'Stellar' },
    { symbol: 'ICP/USD', name: 'Internet Computer' },
    { symbol: 'FIL/USD', name: 'Filecoin' },
    { symbol: 'HBAR/USD', name: 'Hedera' },
    { symbol: 'VET/USD', name: 'VeChain' },
    { symbol: 'ARB/USD', name: 'Arbitrum' },
    { symbol: 'OP/USD', name: 'Optimism' },
    { symbol: 'INJ/USD', name: 'Injective' },
    { symbol: 'RNDR/USD', name: 'Render' },
    { symbol: 'GRT/USD', name: 'The Graph' },
    { symbol: 'LDO/USD', name: 'Lido DAO' },
    { symbol: 'MKR/USD', name: 'Maker' },
    { symbol: 'AAVE/USD', name: 'Aave' },
    { symbol: 'SNX/USD', name: 'Synthetix' },
    { symbol: 'CRV/USD', name: 'Curve DAO' },
    { symbol: 'GALA/USD', name: 'Gala' },
    { symbol: 'SAND/USD', name: 'The Sandbox' },
    { symbol: 'MANA/USD', name: 'Decentraland' },
    { symbol: 'AXS/USD', name: 'Axie Infinity' },
    { symbol: 'CHZ/USD', name: 'Chiliz' },
    { symbol: 'ENJ/USD', name: 'Enjin Coin' },
    { symbol: 'THETA/USD', name: 'Theta Network' },
    { symbol: 'EGLD/USD', name: 'MultiversX' },
    { symbol: 'ALGO/USD', name: 'Algorand' },
    { symbol: 'FLOW/USD', name: 'Flow' },
    { symbol: 'QNT/USD', name: 'Quant' },
    { symbol: 'STX/USD', name: 'Stacks' },
    { symbol: 'MINA/USD', name: 'Mina' },
    { symbol: 'IMX/USD', name: 'Immutable' },
    { symbol: 'TIA/USD', name: 'Celestia' }
  ]
};

interface ScanResult {
  symbol: string;
  name: string;
  score: number;
  reason: string;
  aiInsight?: string;
  trend?: 'up' | 'down';
}

interface AIStrategy {
  marketData: string;
  matchAnalysis: string;
  conclusion: string;
  actionPlan: string;
  riskWarning: string;
}

export default function App() {
  const [market, setMarket] = useState<'US' | 'TW' | 'CRYPTO'>('US');
  const [currentStocks, setCurrentStocks] = useState(STOCKS.US);
  const [selectedStock, setSelectedStock] = useState(STOCKS.US[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState<StockDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasRunScan, setHasRunScan] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiStrategy, setAiStrategy] = useState<any>(null); // Use any for now or specific type if known
  const [isGeneratingStrategy, setIsGeneratingStrategy] = useState(false);
  const hotPicksRef = useRef<HTMLDivElement>(null);

  // Fetch top 50 stocks when market changes
  useEffect(() => {
    const fetchTop50 = async () => {
      try {
        const res = await fetch(`/api/top50?market=${market}`);
        if (res.ok) {
          const data = await res.json();
          if (data.symbols && data.symbols.length > 0) {
            setCurrentStocks(data.symbols);
            // If the user hasn't manually selected a stock yet, update the selected stock
            // to the first of the new top 50 list.
            setSelectedStock(prev => {
              // Only update if it's currently the default first item of the hardcoded list
              if (prev.symbol === STOCKS[market][0].symbol) {
                return data.symbols[0];
              }
              return prev;
            });
          }
        }
      } catch (err) {
        console.error(`Failed to fetch top 50 for ${market}:`, err);
      }
    };
    fetchTop50();
  }, [market]);

  // Scroll to hot picks when scan starts
  useEffect(() => {
    if (scanning && hotPicksRef.current) {
      hotPicksRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [scanning]);

  // Reset AI strategy when stock changes
  useEffect(() => {
    setAiStrategy(null);
  }, [selectedStock.symbol]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    
    let symbol = searchQuery.toUpperCase();
    if (market === 'TW' && !symbol.includes('.')) {
      symbol += '.TW';
    } else if (market === 'CRYPTO' && !symbol.includes('/') && !symbol.includes('-')) {
      symbol += '/USD';
    }
    
    // Check if it's already in our list
    const existing = currentStocks.find(s => s.symbol === symbol);
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

  const handleMarketChange = (newMarket: 'US' | 'TW' | 'CRYPTO') => {
    setMarket(newMarket);
    setCurrentStocks(STOCKS[newMarket]);
    setSelectedStock(STOCKS[newMarket][0]);
    setScanResults([]);
    setHasRunScan(false);
    setScanProgress(0);
    setLastUpdated(null);
    setAiStrategy(null);
  };

  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const generateStrategy = async () => {
    if (!data || data.length === 0) return;
    setIsGeneratingStrategy(true);
    try {
      const latestData = data[data.length - 1];
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "strategy",
          prompt: `# Role: 專業短線交易策略分析師
   
## 任務目標
請根據我提供的 [${selectedStock.symbol} (${selectedStock.name})]，進行短線交易機會分析。請嚴格遵守以下兩套不同的策略邏輯進行評估，並給出「進場」、「觀望」或「風險過高」的具體建議。

---

## 策略 A：股票短線波段 (持有期約 1 週)
**適用對象：** 美股 / 台股 / 其他股票市場
**核心邏輯：** 尋找底部反轉或強勢突破的短線買點。

**分析檢查清單：**
1. **底部反轉特徵：**
   - RSI 是否處於低檔區 (例如 < 45) 並開始回升？
   - KD 或 MACD 是否出現黃金交叉或即將轉正？
2. **強勢突破特徵：**
   - 股價是否剛剛站上 MA20 (月線) 或出現 EMA 黃金交叉？
   - 突破時是否有量能配合？
3. **風險回報：**
   - 預期持有一週，目標漲幅應設定在 5%~10% 之間。
   - 止損位是否明確？(例如跌破前低或 MA20)。

---

## 策略 B：虛擬幣極短線動能 (持有期約 1~3 天)
**適用對象：** 比特幣 / 以太幣 / 主流山寨幣
**核心邏輯：** 捕捉超賣反彈或動能轉強的短線機會。

**進場訊號判定標準：**
1. **超賣反彈：**
   - RSI 是否低於 35？若低於 35，是否出現止跌跡象？
2. **動能轉強：**
   - MACD 柱狀圖是否由負轉正？
   - 價格是否重新站回 MA20 或 EMA 短天期均線之上？
3. **持有與出場：**
   - 預期持有 1~3 天左右。
   - 若 RSI 回升至 60 以上或價格觸碰上軌壓力，應分批止盈。

---

## 當前市場數據
標的: ${selectedStock.symbol} (${selectedStock.name})
市場類型: ${market === 'CRYPTO' ? '虛擬幣' : '股票'}
當前價格: ${latestData.close}
RSI(14): ${latestData.rsi?.toFixed(2)}
MACD: ${latestData.macdHist?.toFixed(2)}
KD: K=${latestData.k?.toFixed(2)}, D=${latestData.d?.toFixed(2)}
MA20: ${latestData.ma20?.toFixed(2)}
EMA12: ${latestData.emaShort?.toFixed(2)}
EMA26: ${latestData.emaLong?.toFixed(2)}

## 輸出格式要求
請針對 [${selectedStock.symbol} (${selectedStock.name})] 輸出以下報告，並以 JSON 格式回傳。
請在各項分析文字中（如結論、操作劇本等），自然地帶入標的名稱與代號：
{
  "marketData": "當前市場數據：(包含標的名稱與代號、現價、RSI 數值、MACD、KD 等狀態)",
  "matchAnalysis": "策略匹配度分析：(評估是否符合底部反轉、均線突破或超賣反彈特徵)",
  "conclusion": "結論：[強烈建議進場 / 觀察 / 不建議] (請提及標的名稱與代號)",
  "actionPlan": "操作劇本：建議進場價位區間、止損價位、目標價位。(請提及標的名稱與代號)",
  "riskWarning": "風險警告：(例如：目前是逆勢接刀，風險較大)"
}`
        })
      });
      
      const result = await response.json();
      setAiStrategy(result);
    } catch (err) {
      console.error("Failed to generate strategy:", err);
      alert("AI 分析失敗，請稍後再試。");
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
        const { data: stockData } = await fetchStockData(stock.symbol, 60);
        if (stockData.length < 20) continue;
        
        const latest = stockData[stockData.length - 1];
        const prev = stockData[stockData.length - 2];
        
        // Trend detection via MA20 slope
        const trend = latest.ma20 > prev.ma20 ? 'up' : 'down';
        
        let score = 0;
        let reasons: string[] = [];
        
        if (market === 'CRYPTO') {
          // 策略 B: 虛擬幣極短線反彈 (捕捉 EMA 趨勢下的回調反彈)
          if (latest.close > latest.emaLong) {
            score += 30;
            reasons.push("趨勢偏多(站上EMA)");
          }
          
          if (latest.rsi < 30) {
            score += 50;
            reasons.push("RSI 極度超賣");
          } else if (latest.rsi < 45) {
            score += 30;
            reasons.push("RSI 偏低回調");
          }
          
          if (latest.macdHist > prev.macdHist) {
            score += 20;
            reasons.push("MACD 動能轉強");
          }
        } else {
          // 策略 A: 股票短線波段 (尋找趨勢回調後的波段買點)
          const isAboveMA20 = latest.close > latest.ma20;
          const isAboveEMA50 = latest.close > latest.emaLong; // using emaLong as proxy for mid-term trend
          
          if (isAboveMA20 || isAboveEMA50) {
            score += 40;
            reasons.push("中期趨勢向上");
            
            // 尋找回調買點: RSI 降溫但未破壞趨勢
            if (latest.rsi < 55 && latest.rsi > 35) {
              score += 30;
              reasons.push("指標健康回調");
            }
            
            // 價格靠近 MA20 支撐 (距離小於 3%)
            const distToMA20 = Math.abs(latest.close - latest.ma20) / latest.ma20;
            if (distToMA20 < 0.03 && latest.close >= latest.ma20) {
              score += 30;
              reasons.push("回測均線支撐");
            }
          } else {
            // 跌破均線，如果是剛突破也可以
            if (prev.close <= prev.ma20 && latest.close > latest.ma20) {
              score += 50;
              reasons.push("強勢站上月線");
            }
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
      } catch (e) {
        console.error(`Error scanning ${stock.symbol}:`, e);
      }
    }
    
    // AI Analysis Phase
    const topCandidates = results.sort((a, b) => b.score - a.score).slice(0, 15);
    
    // Set initial technical results immediately so user sees something
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
            prompt: `你是一位資深的量化交易與 AI 策略分析師。請深入分析以下這幾檔股票的技術指標（RSI, EMA, KD, MACD, MA20），並為前 10 名提供極具參考價值的「AI 智能洞察建議」(Traditional Chinese)。
          
          候選名單：
          ${JSON.stringify(topCandidates)}
          
          請執行以下任務：
          1. 根據技術指標的趨勢強度與反轉潛力，對這 15 檔股票進行二次排序，挑選出最強的 10 檔。
          2. 為每檔股票提供 20 字以內的具體建議。建議應包含：
             - 具體的支撐位或壓力位。
             - 當前的型態特徵（如：底背離、突破、回踩）。
             - 具體的進場或出場警示。
          3. 確保每檔股票的建議都是獨一無二的，避免籠統的「趨勢轉強」。
          
          請回傳 JSON 格式，包含一個陣列，每個物件有 symbol 和 aiInsight。`
          })
        });

        const aiData = await response.json();
        const aiMap = new Map(aiData.recommendations.map((r: any) => [r.symbol, r.aiInsight]));
        
        const finalResults = topCandidates.map(res => ({
          ...res,
          aiInsight: aiMap.get(res.symbol) || "技術面轉強，建議關注"
        })).slice(0, 10);
        
        setScanResults(finalResults);
      } catch (err) {
        console.error('AI Analysis failed:', err);
        // Keep technical results if AI fails
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
  const [timeRange, setTimeRange] = useState('3M');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [showIndicators, setShowIndicators] = useState({
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
  });

  const toggleIndicator = (key: keyof typeof showIndicators) => {
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

  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    // For intraday data, we usually want to see all fetched data (e.g. 5 days)
    if (timeframe !== '1d') {
      return data;
    }

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
    return data.filter(d => new Date(d.timestamp) >= cutoffDate);
  }, [data, timeRange, timeframe]);

  const signal = useMemo(() => getTradingSignal(data), [data]);
  const currentPrice = data.length > 0 ? data[data.length - 1].close : 0;
  const prevPrice = data.length > 1 ? data[data.length - 2].close : 0;
  const priceChange = currentPrice - prevPrice;
  const priceChangePercent = (priceChange / prevPrice) * 100;
  const currency = data.length > 0 ? data[0].currency : (market === 'TW' ? 'TWD' : 'USD');
  const currencySymbol = currency === 'TWD' ? 'NT$' : (market === 'CRYPTO' ? '$' : '$');

  const latestRsi = data.length > 0 ? data[data.length - 1].rsi : 0;
  const latestEmaShort = data.length > 0 ? data[data.length - 1].emaShort : 0;
  const latestEmaLong = data.length > 0 ? data[data.length - 1].emaLong : 0;

  const latestData = data.length > 0 ? data[data.length - 1] : null;
  const prevData = data.length > 1 ? data[data.length - 2] : null;

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  // Helper to safely apply data
  const applyChartData = (data: any[]) => {
    const chart = chartInstance.current;
    if (!chart) {
      return;
    }
    
    if (data.length === 0) {
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
    
    // Sort data by timestamp to ensure correct rendering
    const formattedData = [...data]
      .filter(d => d && !isNaN(d.timestamp) && !isNaN(d.close))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(d => ({
        timestamp: d.timestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
        // Include indicator data for tooltip
        rsi: d.rsi,
        macdHist: d.macdHist,
        k: d.k,
        d: d.d
      }));

    if (formattedData.length > 0) {
      try {
        // v9 uses applyNewData
        if (typeof (chart as any).applyNewData === 'function') {
          (chart as any).applyNewData(formattedData);
        } else if (typeof (chart as any).applyData === 'function') {
          (chart as any).applyData(formattedData);
        }
        chart.resize();
      } catch (err) {
        console.error('Error applying chart data:', err);
      }
    }
  };

  const updateIndicators = () => {
    const chart = chartInstance.current;
    if (!chart) return;
    
    try {
      // 1. Main Pane Indicators (MA, EMA)
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

      // 2. Sub Pane Indicators
      const manageSubPane = (name: string, show: boolean, paneId: string) => {
        if (show) {
          // In v9, createIndicator is generally safe to call multiple times with the same ID,
          // but we'll ensure we don't cause layout thrashing.
          chart.createIndicator(name, false, { id: paneId });
          
          // Ensure the pane has a reasonable height ratio if it's a sub-pane
          chart.setPaneOptions({
            id: paneId,
            height: 100,
            minHeight: 60
          });
        } else {
          chart.removeIndicator(paneId, name);
        }
      };

      manageSubPane('VOL', showIndicators.volume, 'pane_vol');
      manageSubPane('MACD', showIndicators.macd, 'pane_macd');
      manageSubPane('RSI', showIndicators.rsi, 'pane_rsi');
      manageSubPane('KDJ', showIndicators.kd, 'pane_kdj');

      // Ensure main pane stays prominent
      chart.setPaneOptions({
        id: 'main',
        minHeight: 250
      });

      // Explicitly resize after updating indicators to ensure layout is correct
      // We use multiple timeouts to handle potential race conditions with DOM rendering
      setTimeout(() => chart.resize(), 10);
      setTimeout(() => chart.resize(), 100);
      setTimeout(() => chart.resize(), 300);

    } catch (e) {
      console.error('Error updating indicators:', e);
    }
  };

  // Initialize Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    let timeoutId: any;
    let rafId: number;

    console.log('Initializing KlineChart...');
    const chart = init(chartContainerRef.current);
    chartInstance.current = chart;

    // Basic styles for better visibility
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

    // Apply data if available
    if (filteredData.length > 0) {
      applyChartData(filteredData);
      timeoutId = setTimeout(() => {
        if (chartInstance.current) updateIndicators();
      }, 50);
    }

    const resizeObserver = new ResizeObserver(() => {
      rafId = window.requestAnimationFrame(() => {
        if (chartInstance.current) {
          chartInstance.current.resize();
        }
      });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      console.log('Disposing KlineChart...');
      if (timeoutId) clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      if (chartContainerRef.current) {
        dispose(chartContainerRef.current);
      }
      chartInstance.current = null;
    };
  }, []);

  // Update Data when filteredData changes
  useEffect(() => {
    if (chartInstance.current && filteredData.length > 0) {
      console.log('Data changed, re-applying to chart...');
      applyChartData(filteredData);
      updateIndicators();
    }
  }, [filteredData]);

  // Update Indicators when toggles change
  useEffect(() => {
    if (chartInstance.current) {
      updateIndicators();
    }
  }, [showIndicators]);

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] pb-16 md:pb-0">
      {/* Sidebar Navigation - Desktop Only */}
      <aside className="fixed left-0 top-0 h-full w-16 border-r border-[#141414] hidden md:flex flex-col items-center py-8 gap-8 bg-[#E4E3E0] z-20">
        <div className="w-10 h-10 bg-[#141414] rounded-sm flex items-center justify-center text-[#E4E3E0]">
          <Activity size={24} />
        </div>
        <nav className="flex flex-col gap-6">
          <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm">
            <LayoutGrid size={20} />
          </button>
          <button className="p-2 bg-[#141414] text-[#E4E3E0] rounded-sm">
            <Activity size={20} />
          </button>
          <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm">
            <List size={20} />
          </button>
          <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm">
            <Bell size={20} />
          </button>
        </nav>
        <div className="mt-auto flex flex-col gap-6 pb-4">
          <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm">
            <Settings size={20} />
          </button>
          <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm">
            <User size={20} />
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 w-full h-16 bg-[#E4E3E0] border-t border-[#141414] flex md:hidden items-center justify-around px-4 z-30">
        <button className="p-2 bg-[#141414] text-[#E4E3E0] rounded-sm">
          <Activity size={20} />
        </button>
        <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm">
          <LayoutGrid size={20} />
        </button>
        <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm">
          <Search size={20} />
        </button>
        <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm">
          <Bell size={20} />
        </button>
        <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm" onClick={() => handleMarketChange(market)}>
          <RefreshCw size={20} />
        </button>
      </nav>

      {/* Main Content */}
      <main className="pl-0 md:pl-16 min-h-screen overflow-x-hidden overflow-y-auto bg-[#E4E3E0]">
        {/* Header */}
        <header className="min-h-16 border-b border-[#141414] flex flex-wrap items-center px-4 md:px-8 justify-between sticky top-0 bg-[#E4E3E0]/80 backdrop-blur-md z-10 py-2 md:py-0">
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            <h1 className="font-serif italic text-lg md:text-xl tracking-tight">台美股短線系統</h1>
            <div className="h-4 w-[1px] bg-[#141414]/20 mx-1 md:mx-2 hidden xs:block" />
            
            <form onSubmit={handleSearch} className="flex items-center mr-4 relative group">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50" />
                <input 
                  type="text" 
                  placeholder="搜尋代號 (如 2330)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-white/50 border border-[#141414] pl-7 pr-3 py-1 text-xs font-mono focus:outline-none focus:bg-white transition-all w-28 xs:w-32 md:w-40 rounded-sm"
                />
              </div>
              {searchQuery && (
                <div className="absolute top-full left-0 w-full bg-white border border-[#141414] mt-1 shadow-lg z-50 max-h-48 overflow-y-auto hidden group-focus-within:block">
                  {currentStocks
                    .filter(s => s.symbol.includes(searchQuery.toUpperCase()) || s.name.includes(searchQuery))
                    .map(s => (
                      <button
                        key={s.symbol}
                        type="button"
                        onClick={() => { setSelectedStock(s); setSearchQuery(''); }}
                        className="w-full text-left px-3 py-2 text-[10px] hover:bg-[#141414] hover:text-[#E4E3E0] font-mono border-b border-[#141414]/5 last:border-0"
                      >
                        <div className="font-bold">{s.symbol}</div>
                        <div className="opacity-70">{s.name}</div>
                      </button>
                    ))}
                </div>
              )}
            </form>

            <div className="flex items-center gap-1 p-1 bg-white/30 border border-[#141414] rounded-sm">
              <button 
                onClick={() => handleMarketChange('US')}
                className={cn(
                  "px-3 py-1 text-[10px] font-mono transition-all",
                  market === 'US' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/10"
                )}
              >
                US
              </button>
              <button 
                onClick={() => handleMarketChange('TW')}
                className={cn(
                  "px-3 py-1 text-[10px] font-mono transition-all",
                  market === 'TW' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/10"
                )}
              >
                TW
              </button>
              <button 
                onClick={() => handleMarketChange('CRYPTO')}
                className={cn(
                  "px-3 py-1 text-[10px] font-mono transition-all",
                  market === 'CRYPTO' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/10"
                )}
              >
                CRYPTO
              </button>
            </div>
          </div>
          
          <div className="hidden sm:flex items-center gap-4 md:gap-6 mt-2 md:mt-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest opacity-50 font-bold">Data Source</span>
              <div className={cn("w-2 h-2 rounded-full", data.some(d => d.isMock) ? "bg-amber-500" : "bg-emerald-500 animate-pulse")} />
              <span className="text-xs font-mono">{data.some(d => d.isMock) ? 'MOCK' : 'LIVE'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest opacity-50 font-bold">Market Status</span>
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs font-mono">OPEN</span>
            </div>
            <button 
              onClick={refreshData}
              className={cn(
                "p-2 border border-[#141414] rounded-full hover:bg-[#141414] hover:text-[#E4E3E0] transition-all",
                loading && "animate-spin"
              )}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-8 overflow-x-hidden">
          
          {/* Left Column: Stock Info & Signals */}
          <div className="lg:col-span-1 flex flex-col gap-8">
            {/* Stock Selector */}
            <section className="border border-[#141414] p-6 bg-white/50">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif italic text-xs uppercase tracking-widest opacity-50">
                  {isAiAnalyzing ? "AI 分析中..." : `Select Asset (${market})`}
                </h2>
                <button 
                  onClick={runScanner}
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
                    <span className="opacity-50 font-mono">AI-RANKED</span>
                  </p>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                    {scanResults.slice(0, 10).map((res, idx) => (
                      <div 
                        key={res.symbol} 
                        onClick={() => setSelectedStock({symbol: res.symbol, name: res.name})}
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
                {/* Search Result if not in list */}
                {!currentStocks.some(s => s.symbol === selectedStock.symbol) && (
                  <div className="mb-2">
                    <p className="text-[9px] uppercase tracking-widest opacity-50 mb-1 font-bold">搜尋結果</p>
                    <button
                      onClick={() => setSelectedStock(selectedStock)}
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
                  const isRecommended = scanResults.some(r => r.symbol === stock.symbol);
                  return (
                    <button
                      key={stock.symbol}
                      onClick={() => setSelectedStock(stock)}
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

            {/* Signal Card */}
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

              {/* AI Strategy Section */}
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
                        aiStrategy.conclusion.includes('進場') ? "text-emerald-600" : 
                        aiStrategy.conclusion.includes('觀察') ? "text-amber-600" : "text-rose-600"
                      )}>
                        {aiStrategy.conclusion}
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
                    onClick={generateStrategy}
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

            {/* Indicator Stats */}
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

          {/* Main Chart Area (TradingView Style) */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            {/* Price Overview */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-[#141414] pb-2 bg-white/80 p-3 md:p-4 rounded-sm gap-3">
              <div className="flex flex-wrap items-center gap-4 md:gap-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono opacity-50 uppercase">Date</span>
                  <span className="text-xs font-mono font-bold">{latestData?.date}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono opacity-50 uppercase">Price</span>
                  <span className={cn("text-lg md:xl font-mono font-bold", priceChange >= 0 ? "text-rose-500" : "text-emerald-500")}>
                    {currentPrice.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono opacity-50 uppercase">Change</span>
                  <span className={cn("text-xs font-mono font-bold", priceChange >= 0 ? "text-rose-500" : "text-emerald-500")}>
                    {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)} ({Math.abs(priceChangePercent).toFixed(2)}%)
                  </span>
                </div>
                <div className="hidden md:flex flex-col">
                  <span className="text-[10px] font-mono opacity-50 uppercase">Open</span>
                  <span className="text-xs font-mono font-bold">{latestData?.open.toFixed(2)}</span>
                </div>
                <div className="hidden md:flex flex-col">
                  <span className="text-[10px] font-mono opacity-50 uppercase">High</span>
                  <span className="text-xs font-mono font-bold">{latestData?.high.toFixed(2)}</span>
                </div>
                <div className="hidden md:flex flex-col">
                  <span className="text-[10px] font-mono opacity-50 uppercase">Low</span>
                  <span className="text-xs font-mono font-bold">{latestData?.low.toFixed(2)}</span>
                </div>
                <div className="hidden md:flex flex-col">
                  <span className="text-[10px] font-mono opacity-50 uppercase">Volume</span>
                  <span className="text-xs font-mono font-bold">{latestData?.volume.toLocaleString()}</span>
                </div>
              </div>
              
            <div className="w-full overflow-x-auto custom-scrollbar md:overflow-visible">
              <div className="flex gap-1 items-center min-w-max md:min-w-0 pb-1 md:pb-0">
                <div className="flex gap-1 border-r border-[#141414]/20 pr-2 mr-2 flex-shrink-0">
                  {(['15m', '60m', '4h', '1d'] as Timeframe[]).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={cn(
                        "px-2 py-1 text-[10px] font-mono border border-[#141414] transition-all rounded-sm flex-shrink-0",
                        timeframe === tf ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                      )}
                    >
                      {tf === '1d' ? '1D' : tf === '60m' ? '60M' : tf === '4h' ? '4H' : tf.toUpperCase()}
                    </button>
                  ))}
                </div>
                {timeframe === '1d' && (
                  <div className="flex gap-1 flex-shrink-0">
                    {['1M', '3M', '6M', '1Y', '2Y', '5Y'].map((range) => (
                      <button
                        key={range}
                        onClick={() => setTimeRange(range)}
                        className={cn(
                          "px-2 py-1 text-[10px] font-mono border border-[#141414] transition-all rounded-sm flex-shrink-0",
                          timeRange === range ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                        )}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            </div>

            {/* Indicator Toggles & Legend */}
            <div className="flex flex-col gap-4 p-4 bg-white/50 border border-[#141414] rounded-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-[10px] font-mono font-bold uppercase opacity-50 mr-2">主圖指標:</span>
                  <div className="flex gap-1 bg-white p-1 border border-[#141414]/10 rounded-sm">
                    {[
                      { key: 'ma5', label: 'MA5' },
                      { key: 'ma10', label: 'MA10' },
                      { key: 'ma20', label: 'MA20' },
                      { key: 'ma60', label: 'MA60' },
                      { key: 'ma120', label: 'MA120' },
                      { key: 'ema', label: 'EMA' },
                    ].map((ind) => (
                      <button
                        key={ind.key}
                        onClick={() => toggleIndicator(ind.key as any)}
                        className={cn(
                          "px-2 py-1 text-[10px] font-mono border transition-all rounded-sm",
                          showIndicators[ind.key as keyof typeof showIndicators] 
                            ? "bg-[#141414] text-[#E4E3E0] border-[#141414]" 
                            : "bg-transparent text-[#141414] border-transparent hover:border-[#141414]/20"
                        )}
                      >
                        {ind.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-[10px] font-mono font-bold uppercase opacity-50 mr-2">副圖指標:</span>
                  <div className="flex gap-1 bg-white p-1 border border-[#141414]/10 rounded-sm">
                    {[
                      { key: 'volume', label: '成交量' },
                      { key: 'macd', label: 'MACD' },
                      { key: 'rsi', label: 'RSI' },
                      { key: 'kd', label: 'KDJ' },
                    ].map((ind) => (
                      <button
                        key={ind.key}
                        onClick={() => toggleIndicator(ind.key as any)}
                        className={cn(
                          "px-2 py-1 text-[10px] font-mono border transition-all rounded-sm",
                          showIndicators[ind.key as keyof typeof showIndicators] 
                            ? "bg-[#141414] text-[#E4E3E0] border-[#141414]" 
                            : "bg-transparent text-[#141414] border-transparent hover:border-[#141414]/20"
                        )}
                      >
                        {ind.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Market Hot Picks (Top 10) */}
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
                <div className="flex items-center gap-4">
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
              
              {scanResults.length > 0 ? (
                <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
                  {scanResults.slice(0, 10).map((res, idx) => (
                    <button
                      key={res.symbol}
                      onClick={() => setSelectedStock({symbol: res.symbol, name: res.name})}
                      className={cn(
                        "p-3 md:p-4 border transition-all text-left relative overflow-hidden group min-h-[140px] md:min-h-[160px] flex flex-col",
                        selectedStock.symbol === res.symbol 
                          ? "bg-emerald-500 border-emerald-600 text-[#141414]" 
                          : "bg-white/5 border-[#E4E3E0]/10 hover:border-emerald-500/50"
                      )}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className={cn(
                          "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                          selectedStock.symbol === res.symbol ? "bg-[#141414]/20" : "bg-emerald-500/20 text-emerald-400"
                        )}>
                          RANK #{idx + 1}
                        </span>
                        <div className="flex items-center gap-1">
                          {res.trend === 'up' ? (
                            <TrendingUp className={cn("w-4 h-4", selectedStock.symbol === res.symbol ? "text-[#141414]" : "text-emerald-400")} />
                          ) : (
                            <TrendingDown className={cn("w-4 h-4", selectedStock.symbol === res.symbol ? "text-[#141414]" : "text-rose-400")} />
                          )}
                        </div>
                      </div>
                      
                      <div className="font-bold text-lg truncate mb-0.5">{res.symbol}</div>
                      <div className={cn("text-[10px] truncate mb-3 opacity-60", selectedStock.symbol === res.symbol ? "text-[#141414]" : "text-[#E4E3E0]")}>
                        {res.name}
                      </div>

                      <div className={cn(
                        "mb-3 p-2 rounded-sm text-[11px] leading-tight italic font-serif flex-grow",
                        selectedStock.symbol === res.symbol ? "bg-[#141414]/10" : "bg-indigo-500/20 text-indigo-200 border border-indigo-500/30"
                      )}>
                        {res.aiInsight ? `"${res.aiInsight}"` : "AI 正在評估最佳進場時機..."}
                      </div>

                      <div className="mt-auto">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[9px] font-mono opacity-50 uppercase tracking-tighter">Strength Score</div>
                          <div className="text-xs font-mono font-bold">{res.score}</div>
                        </div>
                        <div className="h-1 w-full bg-black/10 rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full transition-all duration-1000", selectedStock.symbol === res.symbol ? "bg-[#141414]" : "bg-emerald-500")} 
                            style={{ width: `${Math.min(res.score, 100)}%` }} 
                          />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : scanning ? (
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
              ) : hasRunScan ? (
                <div className="flex flex-col items-center justify-center py-16 bg-white/5 border border-dashed border-rose-500/20 rounded-sm">
                  <div className="w-16 h-16 bg-rose-500/5 rounded-full flex items-center justify-center mb-6">
                    <Activity className="w-8 h-8 text-rose-500/30" />
                  </div>
                  <h3 className="text-xl font-serif italic mb-3">掃描完成：目前市場趨勢平穩</h3>
                  <p className="text-sm opacity-40 mb-8 max-w-md text-center leading-relaxed">
                    本次掃描未發現符合「強勢轉強」條件的標的。建議稍後再試，或切換至其他市場（US/Crypto）尋找機會。
                  </p>
                  <button 
                    onClick={runScanner}
                    className="flex items-center gap-3 bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-8 rounded-sm transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                    重新掃描
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 bg-white/5 border border-dashed border-[#E4E3E0]/20 rounded-sm">
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-6">
                    <Search className="w-8 h-8 opacity-20" />
                  </div>
                  <h3 className="text-xl font-serif italic mb-3">發現下一個交易機會</h3>
                  <p className="text-sm opacity-40 mb-8 max-w-md text-center leading-relaxed">
                    點擊下方按鈕啟動 AI 智能掃描，系統將自動分析 RSI、MACD、KD 等多重技術指標，為您挑選當前市場最強勢的 10 檔標的。
                  </p>
                  <button 
                    onClick={runScanner}
                    disabled={scanning}
                    className="group relative flex items-center gap-3 bg-emerald-500 hover:bg-emerald-600 text-[#141414] font-bold py-4 px-10 rounded-sm transition-all active:scale-95 disabled:opacity-50 overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500" />
                    <Zap className={cn("w-5 h-5", scanning && "animate-pulse")} />
                    <span className="tracking-widest">START MARKET SCAN</span>
                  </button>
                </div>
              )}
            </section>

            {/* Main Price Chart */}
            <section className="border border-[#141414] p-3 md:p-4 bg-white min-h-[400px] md:min-h-[700px] h-[60vh] md:h-[85vh] max-h-[1000px] rounded-sm relative flex flex-col overflow-hidden">
              {isAiAnalyzing && (
                <div className="absolute inset-0 z-50 bg-[#141414]/80 backdrop-blur-sm flex flex-col items-center justify-center text-white p-8 text-center">
                  <div className="relative mb-6">
                    <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                    <Activity className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-indigo-400 animate-pulse" />
                  </div>
                  <h3 className="text-lg font-serif italic mb-2 tracking-widest uppercase">AI 智能深度分析中...</h3>
                  <p className="text-xs opacity-60 max-w-xs leading-relaxed">
                    正在利用 Gemini AI 分析技術指標趨勢、支撐壓力位與 K 線型態，為您挑選最具潛力的交易標的。
                  </p>
                  <div className="mt-8 flex gap-1">
                    <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" />
                  </div>
                </div>
              )}
              <div className="flex justify-between items-start mb-2">
                <div className="flex flex-col">
                  <h2 className="text-lg font-bold font-serif leading-none">{selectedStock.name}({selectedStock.symbol})</h2>
                  <span className="text-[10px] font-mono opacity-50">Data points: {filteredData.length} | Timeframe: {timeframe}</span>
                </div>
              </div>
              
              <div className="flex-1 w-full relative">
                {filteredData.length === 0 && !loading && !isAiAnalyzing && (
                  <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                    <Search className="w-12 h-12 text-[#141414]/20 mb-4" />
                    <h3 className="text-xl font-serif italic text-[#141414]/60 mb-2">查無資料 (No Data Found)</h3>
                    <p className="text-sm text-[#141414]/40 font-mono text-center max-w-md">
                      無法取得 {selectedStock.symbol} 的歷史數據。<br/>
                      請確認代號是否正確，或嘗試切換時間週期。
                    </p>
                  </div>
                )}
                <div className="w-full h-full" ref={chartContainerRef} />
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="pl-0 md:pl-16 p-4 md:p-8 border-t border-[#141414] bg-[#E4E3E0] flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
        <div className="text-[9px] md:text-[10px] font-mono opacity-40 uppercase tracking-[0.1em] md:tracking-[0.2em]">
          Algorithm: EMA Crossover + RSI Momentum • v1.0.4
        </div>
        <div className="flex flex-wrap justify-center gap-4 md:gap-6">
          <a href="#" className="text-[9px] md:text-[10px] font-mono opacity-40 hover:opacity-100 uppercase tracking-widest transition-opacity">Documentation</a>
          <a href="#" className="text-[9px] md:text-[10px] font-mono opacity-40 hover:opacity-100 uppercase tracking-widest transition-opacity">API Status</a>
          <a href="#" className="text-[9px] md:text-[10px] font-mono opacity-40 hover:opacity-100 uppercase tracking-widest transition-opacity">Disclaimer</a>
        </div>
      </footer>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-[#E4E3E0]/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-[#141414] border-t-transparent rounded-full animate-spin" />
            <div className="font-serif italic text-sm tracking-widest animate-pulse">Syncing Market Data...</div>
          </div>
        </div>
      )}
    </div>
  );
}
