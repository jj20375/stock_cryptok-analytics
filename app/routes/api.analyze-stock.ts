import { type LoaderFunctionArgs } from "react-router";
import { buildStockDeepAnalysis } from "../services/stockAnalysisService";
import { getUserId } from "../utils/auth";

/**
 * 【詳細繁體中文註解】：深度分析特定股票的大戶動向、題材新聞、量價訊號與基本面
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context.cloudflare as any)?.env || process.env;

  // 安全審查：加上登入驗證，避免外部任意存取分析介面
  const userId = await getUserId(request, env);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  const market = url.searchParams.get("market") || "TW";

  // 固定格式避免任意文字進入外部行情路徑與 AI；上市櫃尾碼只適用台股。
  if (!['TW', 'US'].includes(market) || !(market === 'TW' ? /^\d{4,6}(?:\.TW|\.TWO)?$/ : /^[A-Z][A-Z0-9.-]{0,14}$/).test(symbol)) {
    return Response.json({ error: "請輸入有效的股票代號與市場。" }, { status: 400 });
  }

  // 統一處理代號正規化 (針對台股)
  try {
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
