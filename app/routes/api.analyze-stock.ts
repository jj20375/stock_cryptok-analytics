import { type LoaderFunctionArgs } from "react-router";
import { buildStockDeepAnalysis } from "../services/stockAnalysisService";

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
  try {
    const env = (request as any).context?.cloudflare?.env || process.env;
    const result = await buildStockDeepAnalysis(symbol, market as "TW" | "US", env);
    return Response.json({
      aiAnalysis: result.aiAnalysis,
      raw: result.raw
    });

  } catch (error: any) {
    console.error("❌ [Analysis Error]:", error);
    return Response.json({ 
      error: `分析中斷: ${error.message}`,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    }, { status: 500 });
  }
}
