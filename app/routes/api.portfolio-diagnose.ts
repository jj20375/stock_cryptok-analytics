import { type LoaderFunctionArgs } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { getUserId } from "../utils/auth";
import { userPortfolio } from "../db/schema";
import { fetchPriceFromServer } from "../services/stockService";
import { calculatePortfolioAnalytics } from "../services/portfolioAnalyticsService";
import { getPortfolioRebalancingAdvice } from "../services/rebalancingService";

/**
 * 【詳細繁體中文註解】
 * 投資組合風險診斷與 AI 換股建議 API 路由
 * 用途：前端 Portfolio 頁面定期或手動請求此端點，背景載入持有股票與幣種的風險調整回報指標、 Pearson 相關係數，並輸出 AI 汰弱留強操作建議
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const env = (context.cloudflare as any)?.env || process.env;

    // 【安全性檢查】：驗證使用者是否已登入
    const userId = await getUserId(request, env);
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!env || !env.DB) {
      return Response.json({ error: "資料庫尚未就緒" }, { status: 500 });
    }

    const db = drizzle(env.DB);

    // 1. 從 D1 資料庫載入使用者的投資持倉清單
    const portfolioRaw = await db
      .select()
      .from(userPortfolio)
      .where(eq(userPortfolio.userId, userId))
      .all();

    if (portfolioRaw.length === 0) {
      return Response.json({
        empty: true,
        message: "目前投資組合為空，無法進行風險診斷。"
      });
    }

    // 2. 同步獲取每個資產的最新市價
    const portfolio = await Promise.all(
      portfolioRaw.map(async (item) => {
        try {
          const currentPrice = await fetchPriceFromServer(item.symbol);
          return {
            ...item,
            currentPrice: currentPrice || 0,
            avgPrice: item.avgPrice ? parseFloat(item.avgPrice as any) : 0,
            shares: item.shares ? parseFloat(item.shares as any) : 0,
            fees: item.fees ? parseFloat(item.fees as any) : 0,
          };
        } catch (e) {
          return {
            ...item,
            currentPrice: 0,
            avgPrice: item.avgPrice ? parseFloat(item.avgPrice as any) : 0,
            shares: item.shares ? parseFloat(item.shares as any) : 0,
            fees: item.fees ? parseFloat(item.fees as any) : 0,
          };
        }
      })
    );

    // 3. 呼叫服務層計算波動率、夏普值、Pearson 關聯度矩陣與板塊集中度
    const analytics = await calculatePortfolioAnalytics(portfolio);

    // 4. 呼叫服務層對持有資產進行診斷，並請求 Gemini 生成 AI 汰弱留強意見
    const advice = await getPortfolioRebalancingAdvice(portfolio, env);

    // 5. 回傳整合數據，快取設置為 no-store 以確保每次載入或增刪持股時分析能即時更新
    return Response.json(
      {
        empty: false,
        analytics,
        advice,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error: any) {
    console.error("❌ [API Portfolio Diagnose] 執行失敗:", error);
    return Response.json({ error: error.message || "未知錯誤" }, { status: 500 });
  }
}
