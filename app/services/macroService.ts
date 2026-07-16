import { calculateMA } from "./stockService";

/**
 * 【詳細繁體中文註解】
 * 全球總體經濟指標資料結構
 */
export interface MacroIndicators {
  timestamp: number;
  dxy: {
    value: number;
    prevValue: number;
    ma10: number;
    trend: "UP" | "DOWN";
  };
  us10y: {
    value: number;
    prevValue: number;
    ma10: number;
    trend: "UP" | "DOWN";
  };
  us5y: {
    value: number;
    prevValue: number;
    ma10: number;
    trend: "UP" | "DOWN";
  };
  us3m: {
    value: number;
    prevValue: number;
    ma10: number;
    trend: "UP" | "DOWN";
  };
  vix: {
    value: number;
    prevValue: number;
    ma10: number;
    trend: "UP" | "DOWN";
  };
  spreads: {
    yieldSpread10Y3M: number; // 10年期減3個月利差 (低於 0 代表倒掛，預示經濟衰退)
    yieldSpread10Y5Y: number;  // 10年期減5年期利差
  };
  regime: {
    riskState: "RISK_ON" | "RISK_OFF" | "PANIC";
    allowLong: boolean;
    reason: string;
  };
}

/**
 * 【詳細繁體中文註解】
 * 自定義的簡易 Fetch 超時包裝函數，避免 Cloudflare Workers 請求卡死
 */
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 6000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

/**
 * 【詳細繁體中文註解】
 * 從 Yahoo Finance 抓取單一指數/債券殖利率的歷史日線數據
 * @param symbol Yahoo Finance 標的代號 (例如 ^TNX, DX-Y.NYB)
 * @param range 資料範圍，預設為 3 個月 (3mo) 以計算 10 日均線
 */
export const fetchMacroTicker = async (
  symbol: string,
  range = "3mo"
): Promise<{ closes: number[]; timestamps: number[]; latest: number; prev: number; ma10: number } | null> => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });

    if (!res.ok) {
      console.warn(`[MacroService] 抓取 ${symbol} 失敗，狀態碼: ${res.status}`);
      return null;
    }

    const json = await res.json();
    const chart = json.chart?.result?.[0];
    if (!chart) return null;

    const timestamps = chart.timestamp || [];
    const rawCloses = chart.indicators?.quote?.[0]?.close || [];

    // 【詳細繁體中文註解】
    // 由於非交易時段或假日，Yahoo Finance 的最後幾筆數據可能為 null
    // 必須先過濾掉所有的 null 值，確保計算均線與最新值時的數據完整性
    const validPairs = timestamps
      .map((t: number, i: number) => ({ time: t * 1000, val: rawCloses[i] }))
      .filter((p: any) => p.val !== null && p.val !== undefined);

    if (validPairs.length < 15) {
      console.warn(`[MacroService] ${symbol} 有效數據量不足 15 筆，無法進行分析`);
      return null;
    }

    const closes = validPairs.map((p: any) => p.val);
    const times = validPairs.map((p: any) => p.time);

    // 計算 10 日移動平均線 (MA10)
    const ma10List = calculateMA(closes, 10);
    const latest = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const ma10 = ma10List[ma10List.length - 1] || latest;

    return {
      closes,
      timestamps: times,
      latest,
      prev,
      ma10
    };
  } catch (error) {
    console.error(`[MacroService] 抓取 ${symbol} 異常:`, error);
    return null;
  }
};

/**
 * 【詳細繁體中文註解】
 * 獲取全球核心總體經濟與債券參考指標，並判定當前的市場宏觀環境 (Risk-on / Risk-off)
 */
export const getMacroIndicators = async (): Promise<MacroIndicators | null> => {
  try {
    // 【詳細繁體中文註解】：同時拉取美元指數、10年期美債、5年期美債、3個月美債及 VIX 恐慌指數
    const [dxyData, us10yData, us5yData, us3mData, vixData] = await Promise.all([
      fetchMacroTicker("DX-Y.NYB"), // 美元指數 (美元走強通常利空風險資產)
      fetchMacroTicker("^TNX"),     // 10年期美債殖利率 (全球無風險資產定價之錨)
      fetchMacroTicker("^FVX"),     // 5年期美債殖利率
      fetchMacroTicker("^IRX"),     // 3個月美債殖利率 (代表極短期的資金利率)
      fetchMacroTicker("^VIX"),     // CBOE 波動率指數 (市場恐慌風向球)
    ]);

    if (!dxyData || !us10yData || !us3mData || !vixData) {
      console.error("[MacroService] 核心總經指標獲取不完整，無法生成宏觀報告");
      return null;
    }

    const us5yLatest = us5yData?.latest || us10yData.latest; // 容錯 fallback
    const us5yMa10 = us5yData?.ma10 || us10yData.ma10;

    // 1. 計算利差
    // 10年期與3個月美債殖利率利差 (Yield Spread 10Y-3M)
    const yieldSpread10Y3M = us10yData.latest - us3mData.latest;
    const yieldSpread10Y5Y = us10yData.latest - us5yLatest;

    // 2. 判定趨勢 (最新值是否高於 10 日均線)
    const dxyTrend = dxyData.latest > dxyData.ma10 ? "UP" : "DOWN";
    const us10yTrend = us10yData.latest > us10yData.ma10 ? "UP" : "DOWN";
    const us5yTrend = us5yLatest > us5yMa10 ? "UP" : "DOWN";
    const us3mTrend = us3mData.latest > us3mData.ma10 ? "UP" : "DOWN";
    const vixTrend = vixData.latest > vixData.ma10 ? "UP" : "DOWN";

    // 3. 判定市場宏觀環境 (Risk State)
    // 【風控策略門檻】
    // - 若 VIX > 25：代表市場極度恐慌，直接判定為 PANIC 狀態，策略應全面暫停開多。
    // - 若美元指數 (DXY) 與 10 年期美債殖利率 (US10Y) 均處於上升通道 (UP)，代表流動性正在收緊，判定為 RISK_OFF 狀態。
    // - 其餘情況判定為 RISK_ON，代表宏觀環境有利或中性，允許風險資產做多。
    let riskState: "RISK_ON" | "RISK_OFF" | "PANIC" = "RISK_ON";
    let allowLong = true;
    let reason = "全球宏觀環境中性偏多，有利於風險資產表現。";

    if (vixData.latest > 25) {
      riskState = "PANIC";
      allowLong = false;
      reason = `市場極度恐慌 (VIX 指數為 ${vixData.latest.toFixed(2)} > 25)，全域風控啟動，限制虛擬幣與股市建多單。`;
    } else if (dxyTrend === "UP" && us10yTrend === "UP") {
      riskState = "RISK_OFF";
      allowLong = false; // 在美元指數與美債利率雙強下，應啟動保守防禦模式
      reason = `美元指數 (DXY) 與美債 10 年期殖利率雙雙呈現上升趨勢 (高於 10 日均線)，代表全球流動性收緊，環境偏向 RISK_OFF。`;
    } else if (vixData.latest > 20 || dxyTrend === "UP") {
      riskState = "RISK_OFF";
      allowLong = true; // 允許做多但須壓低倉位
      reason = `美元偏強或 VIX 波動上升 (VIX 為 ${vixData.latest.toFixed(2)})，市場防禦情緒增強，建議調降交易倉位。`;
    }

    return {
      timestamp: Date.now(),
      dxy: {
        value: dxyData.latest,
        prevValue: dxyData.prev,
        ma10: dxyData.ma10,
        trend: dxyTrend,
      },
      us10y: {
        value: us10yData.latest,
        prevValue: us10yData.prev,
        ma10: us10yData.ma10,
        trend: us10yTrend,
      },
      us5y: {
        value: us5yLatest,
        prevValue: us5yData?.prev || us5yLatest,
        ma10: us5yMa10,
        trend: us5yTrend,
      },
      us3m: {
        value: us3mData.latest,
        prevValue: us3mData.prev,
        ma10: us3mData.ma10,
        trend: us3mTrend,
      },
      vix: {
        value: vixData.latest,
        prevValue: vixData.prev,
        ma10: vixData.ma10,
        trend: vixTrend,
      },
      spreads: {
        yieldSpread10Y3M,
        yieldSpread10Y5Y,
      },
      regime: {
        riskState,
        allowLong,
        reason,
      },
    };
  } catch (error) {
    console.error("[MacroService] 獲取指標總表發生嚴重錯誤:", error);
    return null;
  }
};
