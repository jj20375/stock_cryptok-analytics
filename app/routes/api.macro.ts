import { type LoaderFunctionArgs } from "react-router";
import { getUserId } from "../utils/auth";
import { getMacroIndicators } from "../services/macroService";

/**
 * 【詳細繁體中文註解】
 * 全球總體經濟與美債參考指標 API 端點
 * 用途：前端 Dashboard 定期發送請求，取得最新的美債殖利率、美元指數、VIX 及宏觀風控狀態
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const env = (context.cloudflare as any)?.env || process.env;

    // 【安全性檢查】：驗證使用者是否已登入
    const userId = await getUserId(request, env);
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 獲取最新總經數據
    const indicators = await getMacroIndicators();
    
    if (!indicators) {
      return Response.json({ error: "Failed to fetch macro indicators" }, { status: 500 });
    }

    // 回傳成功 JSON 響應，快取設置為 no-store 以確保即時性
    return Response.json(
      { indicators },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error: any) {
    console.error("❌ [API Macro] 執行失敗:", error);
    return Response.json({ error: error.message || "未知錯誤" }, { status: 500 });
  }
}
