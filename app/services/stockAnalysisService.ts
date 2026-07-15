import { Type } from "@google/genai";
import { getAIResponse } from "./aiService";
import { fetchStockFundamentals, fetchStockNews, evaluateVolumeNoPriceRise, fetchStockData, fetchStockPeers, fetchMultipleStockQuotes } from "./stockService";

export interface StockDeepAnalysisResult {
  aiAnalysis: {
    fundamentalsAndNews: string;
    volumeAnalysis: string;
    chipsAnalysis: string;
    score: number;
    conclusion: string;
  };
  raw: {
    fundamentals: any;
    newsHeadlines: string[];
    volumeSignal: any;
    historyData: any[];
    peersData: any[];
  };
}

function normalizeStockSymbol(symbol: string, market: "TW" | "US") {
  if (market === "TW" && !symbol.includes(".") && /^\d{4,6}$/.test(symbol)) {
    return `${symbol}.TW`;
  }
  return symbol;
}

export async function buildStockDeepAnalysis(
  symbol: string,
  market: "TW" | "US" = "TW",
  env: any = {}
): Promise<StockDeepAnalysisResult> {
  const normalizedSymbol = normalizeStockSymbol(symbol, market);
  console.log(`[Analysis] Starting analysis for ${normalizedSymbol} (${market})...`);
  console.time("total_analysis");

  try {
    console.time("fetch_history");
    const { data: historyData } = await fetchStockData(normalizedSymbol, 120, "1d");
    console.timeEnd("fetch_history");

    console.time("fetch_fundamentals");
    const fundamentals = await fetchStockFundamentals(normalizedSymbol);
    const fundamentalsStr = fundamentals
      ? `名稱: ${fundamentals.name}, 市值: ${fundamentals.marketCap || 'N/A'}, 本益比(PE): ${fundamentals.trailingPE || 'N/A'}, 預估本益比: ${fundamentals.forwardPE || 'N/A'}, 殖利率: ${fundamentals.dividendYield || 'N/A'}, 股價淨值比: ${fundamentals.priceToBook || 'N/A'}, 52週最高: ${fundamentals.fiftyTwoWeekHigh || 'N/A'}, 52週最低: ${fundamentals.fiftyTwoWeekLow || 'N/A'}`
      : "無法取得精確基本面數據";
    console.timeEnd("fetch_fundamentals");

    console.time("fetch_news");
    const newsHeadlines = await fetchStockNews(normalizedSymbol);
    const newsStr = newsHeadlines.length > 0 ? newsHeadlines.join(" | ") : "目前無最新新聞";
    console.timeEnd("fetch_news");

    console.time("fetch_volume");
    const volumeSignal = await evaluateVolumeNoPriceRise(normalizedSymbol);
    const volumeStr = `
      - 今日成交量為 5 日均量的 ${volumeSignal.multiple.toFixed(2)} 倍
      - 今日漲跌幅: ${volumeSignal.changePercent.toFixed(2)}%
      - 本週總成交量 (最近 5 日): ${volumeSignal.weeklyComparison.thisWeekVol}
      - 上週總成交量 (前 5 日): ${volumeSignal.weeklyComparison.lastWeekVol}
      - 本週對比上週量能比: ${volumeSignal.weeklyComparison.ratio.toFixed(2)} 倍
      - 觸發狀態: ${volumeSignal.isTriggered ? "觸發異常量能訊號" : "量能尚在正常範圍"}
    `;
    console.timeEnd("fetch_volume");

    console.time("fetch_peers");
    const peerSymbols = await fetchStockPeers(normalizedSymbol);
    const peerQuotes = peerSymbols.length > 0 ? await fetchMultipleStockQuotes(peerSymbols) : [];
    const peersData = peerQuotes.map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.longName,
      price: q.regularMarketPrice,
      changePercent: q.regularMarketChangePercent
    }));
    console.timeEnd("fetch_peers");

    const smartMoneyData = market === "TW"
      ? "請依據最新新聞與大盤環境，推測目前法人與主力的動向。若有跡象顯示融資增加且股價未跌，請標註為起漲訊號。"
      : "請評估華爾街機構近期的持股偏好。";

    const prompt = `
你是一位具備 20 年經驗的全球投資策略分析師。請針對標的 [${normalizedSymbol}] 進行深度且全方位的投資分析。

## 任務目標
請結合以下數據，從「財務體質」、「產業鏈價值」、「量價動能」以及「市場心理」四個維度進行客觀解析。分析時應根據標的自身的特性進行推論，不應侷限於特定產業。

## 已知資訊
- 市場類型：${market}
- 基本面數據：${fundamentalsStr}
- 量價訊號分析：${volumeStr}
- 近期即時新聞摘要：${newsStr}
- 同業表現對比：${peersData.map(p => `${p.name}(${p.symbol}): ${p.changePercent?.toFixed(2)}%`).join(', ')}
- 籌碼面推論方向：${smartMoneyData}

## 分析指令
1. 【價值與成長性分析】：結合 PE/PB 與 52 週高低價位階，判斷該公司目前的估值是否合理，並識別核心成長驅動力。
2. 【題材與環境關聯】：分析新聞標題中反映的市場關注點（如：利率環境、產業週期轉折、技術革命或地緣政治因素等）。
3. 【主力動態推論】：結合週量能比例與單日量價，推斷目前是主力連續吸籌、震盪洗盤還是高檔出貨。
4. 【綜合建議與評分】：給出 1-10 分的潛力評分，並提供具備數據支撐的總結觀點。

請以 JSON 格式回傳，結構如下：
{
  "fundamentalsAndNews": "基本面與新聞題材結合分析文字",
  "volumeAnalysis": "量價訊號解析文字",
  "chipsAnalysis": "籌碼面(融資融券與大戶)分析文字",
  "score": 8,
  "conclusion": "最後總結觀點"
}
`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        fundamentalsAndNews: { type: Type.STRING },
        volumeAnalysis: { type: Type.STRING },
        chipsAnalysis: { type: Type.STRING },
        score: { type: Type.NUMBER },
        conclusion: { type: Type.STRING },
      },
      required: ["fundamentalsAndNews", "volumeAnalysis", "chipsAnalysis", "score", "conclusion"],
    };

    const resultText = await getAIResponse(prompt, {
      responseMimeType: "application/json",
      responseSchema,
    }, env);

    const aiAnalysis = JSON.parse(resultText || "{}");
    console.timeEnd("total_analysis");

    return {
      aiAnalysis,
      raw: { fundamentals, newsHeadlines, volumeSignal, historyData, peersData }
    };
  } catch (error: any) {
    console.error("❌ [Analysis Error]:", error);
    throw new Error(`分析中斷: ${error.message}`);
  }
}
