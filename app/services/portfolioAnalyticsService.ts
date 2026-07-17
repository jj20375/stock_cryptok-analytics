import { fetchStockData } from "./stockService";
import { getMacroIndicators } from "./macroService";

/**
 * 【詳細繁體中文註解】
 * 資產分析結果結構
 */
export interface AssetAnalysisResult {
  symbol: string;
  name: string;
  weight: number;         // 市值權重 (0.0 到 1.0)
  currentValue: number;   // 當前總市值 (TWD 或 USD)
  dailyReturns: number[];  // 30 天每日收益率
  volatility: number;     // 年化波動度
}

export interface PortfolioAnalytics {
  portfolioVolatility: number; // 組合年化波動率
  sharpeRatio: number;         // 組合年化夏普比率
  riskFreeRate: number;        // 當前無風險利率 (3M 美債殖利率)
  expectedAnnualReturn: number;// 估算年化報酬率 (基於過去30天均值)
  correlationMatrix: {
    labels: string[];
    matrix: number[][];        // 二維 Pearson 相關係數陣列
  };
  sectorDistribution: {
    sector: string;
    value: number;             // 該板塊的總市值
    percentage: number;        // 板塊比例 (%)
  }[];
  assets: AssetAnalysisResult[];
}

/**
 * 【詳細繁體中文註解】
 * 本地常用台股與美股的行業板塊映射 (如果 API 無法直接拉取則作為 Fallback)
 */
const SECTOR_MAPPING: Record<string, string> = {
  // 台股
  "2330": "半導體業",
  "2454": "半導體業",
  "2303": "半導體業",
  "2317": "其他電子業",
  "2382": "電腦及週邊設備業",
  "3231": "電腦及週邊設備業",
  "2603": "航運業",
  "2609": "航運業",
  "2615": "航運業",
  "2881": "金融保險業",
  "2882": "金融保險業",
  "2891": "金融保險業",
  // 美股
  "AAPL": "科技 (Technology)",
  "MSFT": "科技 (Technology)",
  "NVDA": "半導體 (Semiconductors)",
  "GOOGL": "通訊服務 (Communication)",
  "AMZN": "消費耐久財 (Consumer Discretionary)",
  "TSLA": "汽車製造 (Automotive)",
};

/**
 * 自動判斷個股的行業分類
 */
function getAssetSector(symbol: string): string {
  const cleanSym = symbol.replace(".TW", "").replace(".TWO", "").trim();
  if (symbol.includes("/") || symbol.includes("-USD") || ["BTC", "ETH", "SOL", "ADA", "DOGE"].some(c => cleanSym.startsWith(c))) {
    return "加密貨幣 (Crypto)";
  }
  return SECTOR_MAPPING[cleanSym] || "其他 (Others)";
}

/**
 * 【詳細繁體中文註解】
 * 計算一組數值的標準差 (Standard Deviation)
 */
function calculateStandardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * 【詳細繁體中文註解】
 * 計算兩組收益率數值之間的 Pearson 相關係數
 */
function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n <= 1) return 0;
  
  const meanX = x.reduce((sum, v) => sum + v, 0) / n;
  const meanY = y.reduce((sum, v) => sum + v, 0) / n;
  
  let num = 0;
  let denX = 0;
  let denY = 0;
  
  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    num += diffX * diffY;
    denX += Math.pow(diffX, 2);
    denY += Math.pow(diffY, 2);
  }
  
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

/**
 * 【詳細繁體中文註解】
 * 分析使用者的持倉組合，計算波動率、夏普比率、 Pearson 相關性與板塊比例
 * @param portfolioList 使用者持倉清單 (包含 symbol, avgPrice, shares, currentPrice)
 */
export const calculatePortfolioAnalytics = async (
  portfolioList: any[]
): Promise<PortfolioAnalytics | null> => {
  if (!portfolioList || portfolioList.length === 0) return null;

  try {
    // 1. 同步拉取所有持股過去 30 天日K收盤價數據，並進行數據轉換
    const assetHistories = await Promise.all(
      portfolioList.map(async (item) => {
        let normalizedSymbol = item.symbol;
        // 將加密貨幣（例如 BTC/USDT 轉換成 BTC-USD）以符合 Yahoo Finance 格式
        if (item.symbol.includes("/")) {
          normalizedSymbol = item.symbol.replace("/", "-").replace("USDT", "USD");
        }
        
        try {
          const { data } = await fetchStockData(normalizedSymbol, 40, "1d");
          return {
            symbol: item.symbol,
            name: item.name || item.symbol,
            shares: item.shares,
            currentPrice: item.currentPrice || 0,
            currentValue: (item.shares || 0) * (item.currentPrice || 0),
            history: data,
          };
        } catch (err) {
          console.error(`[PortfolioAnalytics] 拉取 ${item.symbol} 歷史數據失敗:`, err);
          return {
            symbol: item.symbol,
            name: item.name || item.symbol,
            shares: item.shares,
            currentPrice: item.currentPrice || 0,
            currentValue: (item.shares || 0) * (item.currentPrice || 0),
            history: [],
          };
        }
      })
    );

    // 2. 計算每日收益率（要求至少有 15 個有效日收益率）
    const analyzedAssets: AssetAnalysisResult[] = [];
    const minReturnsLength = 15;
    
    for (const asset of assetHistories) {
      if (asset.history.length < 2) continue;
      
      const closes = asset.history.map(h => h.close);
      const returns: number[] = [];
      
      for (let i = 1; i < closes.length; i++) {
        const prev = closes[i - 1];
        if (prev > 0) {
          returns.push((closes[i] - prev) / prev);
        }
      }

      if (returns.length >= minReturnsLength) {
        const dailyStd = calculateStandardDeviation(returns);
        analyzedAssets.push({
          symbol: asset.symbol,
          name: asset.name,
          weight: 0, // 後續加權
          currentValue: asset.currentValue,
          dailyReturns: returns,
          volatility: dailyStd * Math.sqrt(252), // 年化波動度
        });
      }
    }

    if (analyzedAssets.length === 0) {
      console.warn("[PortfolioAnalytics] 無足夠日K數據的資產進行相關性與波動率計算");
      return null;
    }

    // 3. 計算持倉總市值與權重
    const totalPortfolioValue = analyzedAssets.reduce((sum, a) => sum + a.currentValue, 0);
    analyzedAssets.forEach(asset => {
      asset.weight = totalPortfolioValue > 0 ? asset.currentValue / totalPortfolioValue : 0;
    });

    // 4. 計算組合的每日加權收益率，並算出組合年化波動率與報酬率
    const minLength = Math.min(...analyzedAssets.map(a => a.dailyReturns.length));
    const portfolioDailyReturns: number[] = [];

    for (let t = 0; t < minLength; t++) {
      let weightedReturn = 0;
      for (const asset of analyzedAssets) {
        // 從後往前取相同時間軸的收益率
        const idx = asset.dailyReturns.length - minLength + t;
        weightedReturn += asset.dailyReturns[idx] * asset.weight;
      }
      portfolioDailyReturns.push(weightedReturn);
    }

    const portfolioDailyStd = calculateStandardDeviation(portfolioDailyReturns);
    const portfolioVolatility = portfolioDailyStd * Math.sqrt(252);

    // 估算年化收益率 (以日平均報酬乘 252 日年化)
    const avgDailyReturn = portfolioDailyReturns.reduce((sum, r) => sum + r, 0) / portfolioDailyReturns.length;
    const expectedAnnualReturn = Math.pow(1 + avgDailyReturn, 252) - 1;

    // 5. 獲取無風險利率並計算夏普比率 (無風險年化利率轉小數)
    const macro = await getMacroIndicators();
    const riskFreeRate = macro ? macro.us3m.value / 100 : 0.04; // 預設 4%
    const sharpeRatio = portfolioVolatility > 0 
      ? (expectedAnnualReturn - riskFreeRate) / portfolioVolatility 
      : 0;

    // 6. 計算相關性矩陣
    const labels = analyzedAssets.map(a => a.name);
    const matrix: number[][] = [];

    for (let i = 0; i < analyzedAssets.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < analyzedAssets.length; j++) {
        if (i === j) {
          row.push(1.0); // 自身相關性必然是 1.0
        } else {
          // 對齊兩資產的每日收益率長度
          const x = analyzedAssets[i].dailyReturns;
          const y = analyzedAssets[j].dailyReturns;
          const len = Math.min(x.length, y.length);
          const alignedX = x.slice(x.length - len);
          const alignedY = y.slice(y.length - len);
          row.push(parseFloat(calculatePearsonCorrelation(alignedX, alignedY).toFixed(3)));
        }
      }
      matrix.push(row);
    }

    // 7. 計算板塊集中度分佈
    const sectorMap: Record<string, number> = {};
    analyzedAssets.forEach(asset => {
      const sector = getAssetSector(asset.symbol);
      sectorMap[sector] = (sectorMap[sector] || 0) + asset.currentValue;
    });

    const sectorDistribution = Object.keys(sectorMap).map(sector => ({
      sector,
      value: sectorMap[sector],
      percentage: totalPortfolioValue > 0 ? parseFloat(((sectorMap[sector] / totalPortfolioValue) * 100).toFixed(2)) : 0,
    })).sort((a, b) => b.value - a.value);

    return {
      portfolioVolatility,
      sharpeRatio,
      riskFreeRate,
      expectedAnnualReturn,
      correlationMatrix: {
        labels,
        matrix,
      },
      sectorDistribution,
      assets: analyzedAssets,
    };
  } catch (error) {
    console.error("[PortfolioAnalytics] 計算投資組合風險健康度失敗:", error);
    return null;
  }
};
