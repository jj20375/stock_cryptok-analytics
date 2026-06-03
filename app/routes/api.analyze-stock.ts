import { type LoaderFunctionArgs } from "react-router";
import { getAIResponse } from "../services/aiService";
import { Type } from "@google/genai";
import { fetchStockFundamentals, fetchStockNews, evaluateVolumeNoPriceRise, fetchStockData, fetchStockPeers, fetchMultipleStockQuotes } from "../services/stockService";

/**
 * 【詳細繁體中文註解】：深度分析特定股票的大戶動向、題材新聞、量價訊號與基本面
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  let symbol = url.searchParams.get("symbol") || "";
  const market = url.searchParams.get("market") || "TW";

  if (!symbol) {
    return Response.json({ error: "Missing symbol" }, { status: 400 });
  }

  // 統一處理代號正規化 (針對台股)
  if (!symbol.includes('.') && /^\d{4,6}$/.test(symbol)) {
    symbol = `${symbol}.TW`;
  }

  try {
    console.log(`[Analysis] Starting analysis for ${symbol} (${market})...`);
    console.time("total_analysis");
    
    const env = (request as any).context?.cloudflare?.env || process.env;
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key not configured");

    // 1. 抓取 K 線歷史數據
    console.time("fetch_history");
    const { data: historyData } = await fetchStockData(symbol, 120, "1d");
    console.timeEnd("fetch_history");

    // 2. 抓取基本面資料
    console.time("fetch_fundamentals");
    const fundamentals = await fetchStockFundamentals(symbol);
    const fundamentalsStr = fundamentals 
      ? `名稱: ${fundamentals.name}, 市值: ${fundamentals.marketCap || 'N/A'}, 本益比(PE): ${fundamentals.trailingPE || 'N/A'}, 預估本益比: ${fundamentals.forwardPE || 'N/A'}, 殖利率: ${fundamentals.dividendYield || 'N/A'}, 股價淨值比: ${fundamentals.priceToBook || 'N/A'}, 52週最高: ${fundamentals.fiftyTwoWeekHigh || 'N/A'}, 52週最低: ${fundamentals.fiftyTwoWeekLow || 'N/A'}`
      : "無法取得精確基本面數據";
    console.timeEnd("fetch_fundamentals");

    // 2. 抓取即時新聞
    console.time("fetch_news");
    const newsHeadlines = await fetchStockNews(symbol);
    const newsStr = newsHeadlines.length > 0 
      ? newsHeadlines.join(" | ")
      : "目前無最新新聞";
    console.timeEnd("fetch_news");

    // 3. 抓取量價訊號
    console.time("fetch_volume");
    const volumeSignal = await evaluateVolumeNoPriceRise(symbol);
    const volumeStr = `
      - 今日成交量為 5 日均量的 ${volumeSignal.multiple.toFixed(2)} 倍
      - 今日漲跌幅: ${volumeSignal.changePercent.toFixed(2)}%
      - 本週總成交量 (最近 5 日): ${volumeSignal.weeklyComparison.thisWeekVol}
      - 上週總成交量 (前 5 日): ${volumeSignal.weeklyComparison.lastWeekVol}
      - 本週對比上週量能比: ${volumeSignal.weeklyComparison.ratio.toFixed(2)} 倍
      - 觸發狀態: ${volumeSignal.isTriggered ? "觸發異常量能訊號" : "量能尚在正常範圍"}
    `;
    console.timeEnd("fetch_volume");

    // 4. 抓取同業名單
    console.time("fetch_peers");
    const peerSymbols = await fetchStockPeers(symbol);
    const peerQuotes = peerSymbols.length > 0 ? await fetchMultipleStockQuotes(peerSymbols) : [];
    const peersData = peerQuotes.map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.longName,
      price: q.regularMarketPrice,
      changePercent: q.regularMarketChangePercent
    }));
    console.timeEnd("fetch_peers");

    // 5. AI 分析
    console.time("ai_processing");
    const smartMoneyData = market === "TW" 
      ? "請依據最新新聞與大盤環境，推測目前法人與主力的動向。若有跡象顯示融資增加且股價未跌，請標註為起漲訊號。"
      : "請評估華爾街機構近期的持股偏好。";

    const prompt = `
你是一位具備 20 年經驗的全球投資策略分析師。請針對標的 [${symbol}] 進行深度且全方位的投資分析。

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
      responseSchema: responseSchema,
    }, env);

    const result = JSON.parse(resultText || "{}");
    console.timeEnd("ai_processing");
    console.timeEnd("total_analysis");
    
    return Response.json({
      aiAnalysis: result,
      raw: { fundamentals, newsHeadlines, volumeSignal, historyData, peersData }
    });

  } catch (error: any) {
    console.error("❌ [Analysis Error]:", error);
    return Response.json({ 
      error: `分析中斷: ${error.message}`,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    }, { status: 500 });
  }
}
