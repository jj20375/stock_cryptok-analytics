import { type LoaderFunctionArgs } from "react-router";
import { runStrategyEngine } from "../services/strategyEngine";

/**
 * 【詳細繁體中文註解】：手動觸發日報發送接口
 * 訪問此路由將會立即強制執行一次策略檢查與台股日報發送邏輯
 * 繞過時間限制 (僅供開發測試使用)
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  try {
    const env = (context.cloudflare as any)?.env || process.env;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "all";
    
    console.log(`🛠️ [Manual Trigger] 正在手動觸發日報發送 (${type})...`);
    
    const { runStockDailyStrategy } = await import('../services/strategyEngine');
    
    if (!env.DB) {
      return Response.json({ 
        error: "資料庫未綁定", 
        message: "env.DB 為空" 
      }, { status: 500 });
    }

    await runStockDailyStrategy(env, type);

    return Response.json({ 
      success: true, 
      message: `${type === 'market' ? '市場摘要' : (type === 'strategy' ? '策略分析' : '完整日報')}任務已成功執行！`,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    return Response.json({ 
      error: "執行過程中發生錯誤", 
      message: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}
