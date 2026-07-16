import { type LoaderFunctionArgs } from "react-router";
import { getUserId } from "../utils/auth";
import { getTWStockChips } from "../services/chipService";

/**
 * 【詳細繁體中文註解】
 * 個股法人與信用籌碼 API 端點
 * 用途：前端個股分析頁面輸入台股代碼後，異步請求此 API 取得外資/投信/融資融券籌碼數據進行 Recharts 圖表繪製
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const env = (context.cloudflare as any)?.env || process.env;

    // 【安全性檢查】：驗證使用者是否已登入
    const userId = await getUserId(request, env);
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 取得查詢參數中的股票代號
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol");

    if (!symbol) {
      return Response.json({ error: "Missing symbol parameter" }, { status: 400 });
    }

    // 呼叫籌碼服務取得上市籌碼數據
    const chipData = await getTWStockChips(symbol);
    
    if (!chipData) {
      return Response.json({ error: `Failed to fetch chip data for ${symbol}` }, { status: 404 });
    }

    // 回傳成功 JSON 響應
    return Response.json(
      { chipData },
      {
        headers: {
          "Cache-Control": "max-age=7200, stale-while-revalidate=3600", // 快取 2 小時，後台背景更新
        },
      }
    );
  } catch (error: any) {
    console.error("❌ [API Chips] 執行失敗:", error);
    return Response.json({ error: error.message || "未知錯誤" }, { status: 500 });
  }
}
