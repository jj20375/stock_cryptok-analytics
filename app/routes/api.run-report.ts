import { type LoaderFunctionArgs } from "react-router";
import { runStockDailyStrategy } from "../services/strategyEngine";
import { runUsCryptoStockSignals } from "../services/usCryptoSignalService";
import { runStockAutoTrading } from "../services/usStockAutoTrading";
import { runUsStockRadar } from "../services/usStockRadar/scanner";
import { getUserId } from "../utils/auth";

/**
 * 【詳細繁體中文註解】：手動觸發日報發送接口
 * 訪問此路由將會立即強制執行一次策略檢查與台股日報發送邏輯
 * 繞過時間限制 (僅供開發測試使用)
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  try {
    const env = (context.cloudflare as any)?.env || process.env;

    // 安全審查：加上權限驗證
    const userId = await getUserId(request, env);
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const market = searchParams.get("market") === "US" ? "US" : "TW";
    const type = searchParams.get("phase") || searchParams.get("type") || "market";
    
    console.log(`🛠️ [Manual Trigger] 正在手動觸發日報發送 (${market} / ${type})...`);
    
    if (!env.DB) {
      return Response.json({ 
        error: "資料庫未綁定", 
        message: "env.DB 為空" 
      }, { status: 500 });
    }

    // 手動觸發「美股代幣自動交易」檢查(?phase=stock-auto-trading),供上線前測試
    if (type === "stock-auto-trading") {
      await runStockAutoTrading(env);
      return Response.json({
        success: true,
        message: "美股代幣自動交易檢查已執行,僅對已開啟 stockAutoTradingEnabled 的使用者生效。",
        timestamp: new Date().toISOString(),
      });
    }

    // 手動觸發「虛擬幣概念美股收盤訊號」掃描(?phase=us-signals),供上線前測試 Slack 推播
    if (type === "us-signals") {
      await runUsCryptoStockSignals(env);
      return Response.json({
        success: true,
        message: "虛擬幣概念美股訊號掃描已執行,有訊號時會推播 Slack。",
        timestamp: new Date().toISOString(),
      });
    }

    // 手動觸發美股 15 分潛力雷達；仍只處理已收盤行情，且只會送往獨立美股頻道。
    if (type === "us-stock-radar") {
      await runUsStockRadar(env);
      return Response.json({
        success: true,
        message: "美股潛力雷達已執行；休市時會安全略過，有新候選且獨立頻道已設定時才推播 Slack。",
        timestamp: new Date().toISOString(),
      });
    }

    const normalizedPhase = type === "strategy" || type === "surge" ? "strategy" : "market";
    await runStockDailyStrategy(env, market, normalizedPhase);

    const reportLabel = normalizedPhase === 'market'
      ? "市場摘要"
      : "AI 三模式策略批次分析";

    return Response.json({ 
      success: true, 
      message: `${market === "TW" ? "台股" : "美股"} ${reportLabel}任務已成功執行！`,
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
