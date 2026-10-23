import { calculateMA } from "./stockService";
import type {
  MacroIndicators,
  MacroMarketOutlook,
  MacroPillarAnalysis,
  MacroQuote,
  MacroRawInput,
  MacroSignalDirection,
  MacroSourceKey,
  MacroTargetMarket,
  MarketSpecificMacroView,
} from "./macro/types";
import {
  buildBondVixPillar,
  buildFuturesPillar,
  buildFxPillar,
  describeNqMove,
  formatSignalLabel,
} from "./macro/pillars";

/** 型別已拆到 macro/types.ts；此處轉出讓既有 import 路徑（前端元件、其他服務）不需更動 */
export type {
  MacroDataStatus,
  MacroIndicators,
  MacroMarketOutlook,
  MacroPillarAnalysis,
  MacroQuote,
  MacroRawInput,
  MacroSignalDirection,
  MacroSourceKey,
  MacroTargetMarket,
  MarketSpecificMacroView,
} from "./macro/types";

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
 * 從 Yahoo Finance 抓取單一指數/債券殖利率/匯率/期貨的歷史日線數據
 */
export const fetchMacroTicker = async (
  symbol: string,
  range = "3mo"
): Promise<{ closes: number[]; timestamps: number[]; latest: number; prev: number; ma10: number; quoteTime: number } | null> => {
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

    const validPairs = timestamps
      .map((t: number, i: number) => ({ time: t * 1000, val: rawCloses[i] }))
      .filter((p: any) => p.val !== null && p.val !== undefined && Number.isFinite(p.val));

    if (validPairs.length < 15) {
      console.warn(`[MacroService] ${symbol} 有效數據量不足 15 筆，無法進行分析`);
      return null;
    }

    const closes = validPairs.map((p: any) => p.val);
    const times = validPairs.map((p: any) => p.time);

    const ma10List = calculateMA(closes, 10);
    const latest = closes[closes.length - 1];
    const prev = closes[closes.length - 2] ?? latest;
    const ma10 = ma10List[ma10List.length - 1] || latest;
    // 日K時間戳是「該根K棒的開盤日」，無法看出報價有多新；改用 Yahoo meta 的最後成交時間，
    // 讓羅盤能標示 VIX、10Y 這類只在美股時段更新的數據，在台股盤中其實停在前一晚。
    const regularMarketTime = Number(chart.meta?.regularMarketTime);
    const quoteTime = Number.isFinite(regularMarketTime) && regularMarketTime > 0
      ? regularMarketTime * 1000
      : times[times.length - 1];

    return {
      closes,
      timestamps: times,
      latest,
      prev,
      ma10,
      quoteTime,
    };
  } catch (error) {
    console.error(`[MacroService] 抓取 ${symbol} 異常:`, error);
    return null;
  }
};

/** 計算百分比漲跌幅的輔助函式 */
const calcChangePct = (latest: number, prev: number): number => {
  if (!prev || prev === 0) return 0;
  return ((latest - prev) / prev) * 100;
};

/**
 * 把抓到的日線摘要轉成羅盤用的報價結構；抓取失敗時回傳 null，絕不以假值代入。
 * @param trendInclusive 期貨沿用「等於 10MA 也算站上」的舊定義（>=），其餘報價以嚴格大於判定 UP
 */
function toMacroQuote(
  data: { latest: number; prev: number; ma10: number } | null,
  trendInclusive = false
): MacroQuote | null {
  if (!data) return null;
  const isAboveMa = trendInclusive ? data.latest >= data.ma10 : data.latest > data.ma10;
  return {
    value: data.latest,
    prevValue: data.prev,
    changePct: calcChangePct(data.latest, data.prev),
    ma10: data.ma10,
    trend: isAboveMa ? "UP" : "DOWN",
  };
}


/**
 * 【詳細繁體中文註解】
 * 為指定市場（US 美股 / TW 台股 / CRYPTO 幣圈）建立專屬的四大維度分析與漲跌研判
 * 解決問題：
 * 1. 美股頁面專注分析「美股是否會漲」（匯率只看美元 DXY 對美股跨國企業影響，不混入新台幣）。
 * 2. 美股期貨（NQ / ES）在美股模式擁有最高權重，當 NQ 大跌時絕不誤判為「期貨維持多頭」。
 * 3. 美債 10Y 殖利率同時考量絕對水位（>= 4.5% 高利率警戒）與 10MA 趨勢。
 * 4. VIX 恐慌指數只要站上 10MA 或單日跳升，即使仍處低檔也不再標為看漲（見 macro/pillars.ts）。
 * 5. 報價抓取失敗的維度標為「資料暫缺」且不計分，不以預設值產生假訊號。
 */
export function buildMarketSpecificView(
  params: MacroRawInput,
  market: MacroTargetMarket
): MarketSpecificMacroView {
  const { dxy, usdTwd, us10y, us5y, vix, nq, es, yieldSpread10Y3M } = params;
  const marketName = market === "US" ? "美股" : market === "TW" ? "台股" : "幣圈";

  // ============================================================================
  // 1. 【美債維度】10Y 美債殖利率 (同時檢查 10MA 方向與 4.5% 高息門檻)
  // ============================================================================
  const us10yDiff = us10y.value - us10y.prevValue;
  const isHighYieldLevel = us10y.value >= 4.5;
  let treasurySignal: MacroSignalDirection = "NEUTRAL";
  let treasuryExplanation = "";

  if (us10y.trend === "UP" && (us10y.value >= 4.35 || us10yDiff >= 0.04)) {
    treasurySignal = "BEARISH";
    treasuryExplanation = `10Y 殖利率攀升至 ${us10y.value.toFixed(2)}% 且高於 10MA (${us10y.ma10.toFixed(2)}%)，無風險利率上升壓抑${marketName}科技與 AI 成長股估值。`;
  } else if (us10y.trend === "DOWN" && !isHighYieldLevel) {
    treasurySignal = "BULLISH";
    treasuryExplanation = `10Y 殖利率回落至 ${us10y.value.toFixed(2)}%（低於 10MA ${us10y.ma10.toFixed(2)}%），借貸與折現壓力減輕，有利推升${marketName}上漲估值。`;
  } else if (us10y.trend === "DOWN" && isHighYieldLevel) {
    // 絕對殖利率 >= 4.5% 高檔區：除非單日顯著回落 <= -0.05，否則僅視為高檔趨緩（中性）
    if (us10yDiff <= -0.05) {
      treasurySignal = "BULLISH";
      treasuryExplanation = `10Y 殖利率雖處 ${us10y.value.toFixed(2)}% 高檔，但單日明顯回落 ${us10yDiff.toFixed(3)} 且低於 10MA，短線有助${marketName}科技股喘息反彈。`;
    } else {
      treasurySignal = "NEUTRAL";
      treasuryExplanation = `10Y 殖利率雖略低於 10MA (${us10y.ma10.toFixed(2)}%)，但絕對水位達 ${us10y.value.toFixed(2)}% 仍處高息區間，對${marketName}估值支撐偏向中性。`;
    }
  } else if (us10y.trend === "UP") {
    treasurySignal = "BEARISH";
    treasuryExplanation = `10Y 殖利率站上 10MA (${us10y.ma10.toFixed(2)}%) 呈上升趨勢，資金排擠效應使${marketName}高本益比股面臨修正壓力。`;
  }

  const treasuryPillar: MacroPillarAnalysis = {
    key: "treasury",
    title: market === "US" ? "美債殖利率 (10Y 美股估值錨)" : "美債殖利率 (10Y 定價之錨)",
    signal: treasurySignal,
    signalLabel: formatSignalLabel(treasurySignal, marketName),
    primaryMetric: `${us10y.value.toFixed(3)}% (${us10yDiff >= 0 ? "+" : ""}${us10yDiff.toFixed(3)})`,
    secondaryMetric: `10MA: ${us10y.ma10.toFixed(2)}% ｜ 5Y: ${us5y.value.toFixed(2)}%`,
    explanation: treasuryExplanation,
  };

  // ============================================================================
  // 2～4. 【匯率】【期貨】【債券利差 & VIX】判讀規則見 macro/pillars.ts（各維度獨立純函式，缺資料時回傳不計分卡片）
  // ============================================================================
  const fxPillar = buildFxPillar(market, marketName, dxy, usdTwd);
  const futuresPillar = buildFuturesPillar(market, marketName, nq, es);
  const bondSpreadAndVixPillar = buildBondVixPillar(market, marketName, vix, yieldSpread10Y3M);

  // ============================================================================
  // 5. 依市場權重計算「是否會漲」綜合分數與動態不矛盾總結
  // ============================================================================
  const pillarList = [treasuryPillar, fxPillar, futuresPillar, bondSpreadAndVixPillar];
  const bullishPillars = pillarList.filter((p) => p.signal === "BULLISH");
  // 資料暫缺的維度固定為 NEUTRAL，但不能算進「中性」計數，否則使用者會誤以為四項都有判讀
  const unavailablePillars = pillarList.filter((p) => p.dataUnavailable);
  const neutralPillars = pillarList.filter((p) => p.signal === "NEUTRAL" && !p.dataUnavailable);
  const bearishPillars = pillarList.filter((p) => p.signal === "BEARISH");

  const signalToNum = (s: MacroSignalDirection) => (s === "BULLISH" ? 1 : s === "BEARISH" ? -1 : 0);

  // 美股模式：美股期貨 (35分) + 美債殖利率 (25分) + 債券利差與VIX (25分) + 美元匯率 (15分) = 滿分 100
  // 台股模式：美股期貨連動 (30分) + 美債殖利率 (20分) + 債券利差與VIX (20分) + 新台幣與美元匯率 (10分) = 滿分 80
  //   匯率原為 30 分；2026-10 回測（231 個台股交易日、08:30 判讀對照當日收盤）匯率維度單獨命中率約 50%，
  //   等同隨機卻主導評分，降為 10 分後整體方向命中率由 62.3% 升至約 67%。其餘權重與 ±20/25 方向門檻刻意不動，
  //   維持與回測驗證時相同的條件；滿分因此變為 80（另有 NQ ±1.2% 與 VIX > 25 的加減分）。
  const weights =
    market === "US"
      ? { treasury: 25, fx: 15, futures: 35, bondVix: 25 }
      : market === "TW"
      ? { treasury: 20, fx: 10, futures: 30, bondVix: 20 }
      : { treasury: 25, fx: 25, futures: 30, bondVix: 20 };

  let rawScore =
    signalToNum(treasuryPillar.signal) * weights.treasury +
    signalToNum(fxPillar.signal) * weights.fx +
    signalToNum(futuresPillar.signal) * weights.futures +
    signalToNum(bondSpreadAndVixPillar.signal) * weights.bondVix;

  // 若那指期貨單日重挫 <= -1.2%，直接觸發短線空方扣分保護，避免被弱勢美元掩蓋跌勢（NQ 缺資料時不加減分）
  if (nq && nq.changePct <= -1.2) {
    rawScore -= 20;
  } else if (nq && nq.changePct >= 1.2) {
    rawScore += 15;
  }
  if (vix.value > 25) {
    rawScore -= 30;
  }

  const score = Math.max(-100, Math.min(100, Math.round(rawScore)));

  let direction: MacroSignalDirection = "NEUTRAL";
  let label = `${marketName}多空震盪 (選股不選市)`;

  if (vix.value > 25 || score <= -20) {
    direction = "BEARISH";
    label = `${marketName}偏空看跌 (提防回檔壓力)`;
  } else if (score >= 25 && !(market === "US" && futuresPillar.signal === "BEARISH" && nq !== null && nq.changePct <= -1.0)) {
    direction = "BULLISH";
    label = `${marketName}偏多看漲 (上漲動能佔優)`;
  }

  // 動態組合與下方卡片 100% 一致的白話原因
  const shortName = (p: MacroPillarAnalysis) => p.title.split(" ")[0];
  const bullishNames = bullishPillars.map(shortName).join("、");
  const bearishNames = bearishPillars.map(shortName).join("、");

  let summary = "";
  let actionHint = "";

  if (direction === "BULLISH") {
    summary = `目前${marketName}看漲訊號佔優（看漲：${bullishNames || "無"}${bearishNames ? `；逆風：${bearishNames}` : "；無看跌警訊"}）。${
      futuresPillar.signal === "BULLISH" && nq
        ? `${describeNqMove(nq)}，`
        : ""
    }整體宏觀資金環境支持${marketName}往上續攻。`;
    actionHint =
      market === "US"
        ? "美股上漲機率高，可順勢聚焦 AI 晶片、雲端巨頭與強勢突破股偏多操作。"
        : market === "TW"
        ? "台股偏多看漲，外資匯率與美股期貨環境友善，有利台積電供應鏈與主流題材股表現。"
        : "宏觀流動性偏多，有利主流加密貨幣順勢偏多操作。";
  } else if (direction === "BEARISH") {
    summary = `目前${marketName}面臨看跌修正壓力（看跌警訊：${bearishNames || "期貨與恐慌指標轉弱"}${
      bullishNames ? `；僅${bullishNames}提供局部支撐` : ""
    }）。${
      futuresPillar.signal === "BEARISH" && nq
        ? `尤其${describeNqMove(nq)}，短線賣壓明顯，`
        : ""
    }建議暫緩追高。`;
    actionHint =
      market === "US"
        ? "美股短線偏空看跌，期貨賣壓或殖利率/避險情緒尚未解除前，不宜盲目追買，建議拉高現金水位或等待回測支撐止穩。"
        : market === "TW"
        ? "台股面臨外資提款或美股期貨連動回檔壓力，大型權值股易受壓抑，建議嚴控持股水位並做好停損保護。"
        : "宏觀避險情緒升溫，風險資產易出現連帶回撤，建議降低槓桿與多單部位。";
  } else {
    summary = `目前${marketName}處於多空拉鋸震盪（${
      bullishNames ? `看漲支撐：${bullishNames}` : "無明顯看漲主軸"
    }；${bearishNames ? `看跌逆風：${bearishNames}` : "部分指標高檔整理"}）。${
      futuresPillar.signal === "BEARISH" && nq
        ? `雖然${bullishNames || "部分宏觀指標"}偏多，但${describeNqMove(nq)}，壓抑指數空間，易呈現指數震盪、個股各自表現。`
        : `各大指標尚未形成單邊共振，指數易於區間震盪整理。`
    }`;
    actionHint =
      market === "US"
        ? "美股指數預計呈震盪分歧格局（不易全面大漲大跌），建議「選股不選市」，避開破線股、僅在強勢 AI 與財報績優股回踩支撐時分批佈局。"
        : market === "TW"
        ? "台股大盤受國際多空訊號交錯影響易高檔震盪，建議買黑不買紅，鎖定具量能突破的中小型題材股。"
        : "市場多空分歧，建議維持輕倉區間操作，等待期貨與美元方向突破。";
  }

  if (unavailablePillars.length > 0) {
    // 缺資料時評分只反映其餘維度，必須在總結明講，避免使用者把不完整的分數當成完整判讀
    summary += `（⚠️ ${unavailablePillars.map(shortName).join("、")}報價暫缺，未納入評分）`;
  }

  return {
    market,
    compassTitle:
      market === "US"
        ? "🇺🇸 美股漲跌走勢羅盤 · 美債 / 美元 / 美股期貨 / 債券與 VIX"
        : market === "TW"
        ? "🇹🇼 台股漲跌走勢羅盤 · 美債 / 新台幣匯率 / 期貨夜盤連動 / 恐慌利差"
        : "🪙 幣圈宏觀走勢羅盤 · 美債 / 美元 DXY / 那指期貨連動 / 恐慌情緒",
    pillars: {
      treasury: treasuryPillar,
      fx: fxPillar,
      futures: futuresPillar,
      bondSpreadAndVix: bondSpreadAndVixPillar,
    },
    outlook: {
      direction,
      label,
      score,
      bullishCount: bullishPillars.length,
      neutralCount: neutralPillars.length,
      bearishCount: bearishPillars.length,
      unavailableCount: unavailablePillars.length,
      summary,
      actionHint,
      usMarketHint: actionHint,
      twMarketHint: actionHint,
    },
  };
}

/**
 * 【詳細繁體中文註解】
 * 根據美債、匯率、期貨與債券利差四大維度，產生美股、台股、幣圈三種市場的專屬分析
 */
export function buildMacroPillarsAndOutlook(params: MacroRawInput): {
  pillars: MacroIndicators["pillars"];
  marketOutlook: MacroMarketOutlook;
  marketViews: Record<MacroTargetMarket, MarketSpecificMacroView>;
} {
  const usView = buildMarketSpecificView(params, "US");
  const twView = buildMarketSpecificView(params, "TW");
  const cryptoView = buildMarketSpecificView(params, "CRYPTO");

  // 讓預設 outlook 同時保留美股與台股提示供既有呼叫端參考
  const defaultOutlook: MacroMarketOutlook = {
    ...usView.outlook,
    usMarketHint: usView.outlook.actionHint,
    twMarketHint: twView.outlook.actionHint,
  };

  return {
    pillars: usView.pillars,
    marketOutlook: defaultOutlook,
    marketViews: {
      US: usView,
      TW: twView,
      CRYPTO: cryptoView,
    },
  };
}

/**
 * 【詳細繁體中文註解】
 * 獲取全球核心總體經濟、美債、匯率與期貨指標，並判定當前的市場宏觀環境與多空走向
 */
export const getMacroIndicators = async (): Promise<MacroIndicators | null> => {
  try {
    const [dxyData, us10yData, us5yData, us3mData, vixData, usdTwdData, nqData, esData] = await Promise.all([
      fetchMacroTicker("DX-Y.NYB"), // 美元指數 (美元走強通常利空風險資產)
      fetchMacroTicker("^TNX"),     // 10年期美債殖利率 (全球無風險資產定價之錨)
      fetchMacroTicker("^FVX"),     // 5年期美債殖利率
      fetchMacroTicker("^IRX"),     // 3個月美債殖利率 (代表極短期的資金利率)
      fetchMacroTicker("^VIX"),     // CBOE 波動率指數 (市場恐慌風向球)
      fetchMacroTicker("TWD=X"),    // 美元兌新台幣匯率 (外資熱錢流向台股關鍵指標)
      fetchMacroTicker("NQ=F"),     // 那斯達克 100 期貨 (科技與 AI 股 24H 先行指標)
      fetchMacroTicker("ES=F"),     // 標普 500 期貨 (美股大盤 24H 先行指標)
    ]);

    if (!dxyData || !us10yData || !us3mData || !vixData) {
      console.error("[MacroService] 核心總經指標獲取不完整，無法生成宏觀報告");
      return null;
    }

    // 非核心來源（台幣、那指、標普）抓取失敗時一律回傳 null，交由判讀函式標成「資料暫缺」。
    // 舊版曾以 32.0 / 20000 / 5800 代入，NQ 失敗時會得到「漲跌 0%、站上 10MA」而被判成期貨看漲（+30 分），屬於假訊號。
    const usdTwdObj = toMacroQuote(usdTwdData);
    const nqObj = toMacroQuote(nqData, true);
    const esObj = toMacroQuote(esData, true);

    // 5Y 只用於顯示與 10Y-5Y 利差，不參與多空評分；缺資料時沿用 10Y 讓版面不中斷，並在 dataStatus 標記缺漏
    const us5yLatest = us5yData?.latest || us10yData.latest;
    const us5yMa10 = us5yData?.ma10 || us10yData.ma10;

    const yieldSpread10Y3M = us10yData.latest - us3mData.latest;
    const yieldSpread10Y5Y = us10yData.latest - us5yLatest;

    const dxyTrend = dxyData.latest > dxyData.ma10 ? "UP" : "DOWN";
    const us10yTrend = us10yData.latest > us10yData.ma10 ? "UP" : "DOWN";
    const us5yTrend = us5yLatest > us5yMa10 ? "UP" : "DOWN";
    const us3mTrend = us3mData.latest > us3mData.ma10 ? "UP" : "DOWN";

    const sourceData: Record<MacroSourceKey, { quoteTime: number } | null> = {
      dxy: dxyData, us10y: us10yData, us5y: us5yData, us3m: us3mData,
      vix: vixData, usdTwd: usdTwdData, nq: nqData, es: esData,
    };
    const dataStatus = {
      missing: (Object.keys(sourceData) as MacroSourceKey[]).filter((key) => !sourceData[key]),
      quoteTimes: Object.fromEntries(
        (Object.keys(sourceData) as MacroSourceKey[])
          .filter((key) => sourceData[key])
          .map((key) => [key, sourceData[key]!.quoteTime])
      ) as Partial<Record<MacroSourceKey, number>>,
    };
    if (dataStatus.missing.length > 0) {
      console.warn(`[MacroService] 以下報價抓取失敗，不納入判讀：${dataStatus.missing.join(", ")}`);
    }

    let riskState: "RISK_ON" | "RISK_OFF" | "PANIC" = "RISK_ON";
    let allowLong = true;
    let reason = "全球宏觀環境中性偏多，有利於風險資產表現。";

    if (vixData.latest > 25) {
      riskState = "PANIC";
      allowLong = false;
      reason = `市場極度恐慌 (VIX 指數為 ${vixData.latest.toFixed(2)} > 25)，全域風控啟動，限制虛擬幣與股市建多單。`;
    } else if (dxyTrend === "UP" && us10yTrend === "UP") {
      riskState = "RISK_OFF";
      allowLong = false;
      reason = `美元指數 (DXY) 與美債 10 年期殖利率雙雙呈現上升趨勢 (高於 10 日均線)，代表全球流動性收緊，環境偏向 RISK_OFF。`;
    } else if (vixData.latest > 20 || dxyTrend === "UP") {
      riskState = "RISK_OFF";
      allowLong = true;
      reason = `美元偏強或 VIX 波動上升 (VIX 為 ${vixData.latest.toFixed(2)})，市場防禦情緒增強，建議調降交易倉位。`;
    }

    const dxyObj: MacroQuote = { ...toMacroQuote(dxyData)!, trend: dxyTrend };
    const us10yObj: MacroQuote = { ...toMacroQuote(us10yData)!, trend: us10yTrend };

    const us5yObj = {
      value: us5yLatest,
      prevValue: us5yData?.prev || us5yLatest,
      ma10: us5yMa10,
      trend: us5yTrend as "UP" | "DOWN",
    };

    const vixObj: MacroQuote = toMacroQuote(vixData)!;

    const { pillars, marketOutlook, marketViews } = buildMacroPillarsAndOutlook({
      dxy: dxyObj,
      usdTwd: usdTwdObj,
      us10y: us10yObj,
      us5y: us5yObj,
      vix: vixObj,
      nq: nqObj,
      es: esObj,
      yieldSpread10Y3M,
    });

    return {
      timestamp: Date.now(),
      dxy: dxyObj,
      usdTwd: usdTwdObj,
      us10y: us10yObj,
      us5y: us5yObj,
      us3m: {
        value: us3mData.latest,
        prevValue: us3mData.prev,
        ma10: us3mData.ma10,
        trend: us3mTrend,
      },
      vix: vixObj,
      futures: {
        nq: nqObj,
        es: esObj,
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
      pillars,
      marketOutlook,
      marketViews,
      dataStatus,
    };
  } catch (error) {
    console.error("[MacroService] 獲取指標總表發生嚴重錯誤:", error);
    return null;
  }
};
