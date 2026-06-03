import { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { runStrategyEngine } from "../services/strategyEngine";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as any;
  
  // 為了方便測試，手動觸發策略引擎
  // 實際上，這在正式環境是由 Cloudflare Cron Triggers 自動觸發的
  try {
    await runStrategyEngine(env);
    return new Response(JSON.stringify({ success: true, message: "策略引擎已手動觸發執行完成，請查看終端機日誌或 Telegram 通知。" }), { status: 200 });
  } catch (error: any) {
    console.error("Manual Trigger Error:", error);
    return new Response(JSON.stringify({ error: "策略引擎執行失敗", details: error.message }), { status: 500 });
  }
}
