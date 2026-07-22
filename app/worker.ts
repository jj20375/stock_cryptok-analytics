import { createRequestHandler } from "react-router";
// @ts-ignore
// 引入由 React Router 在建置時產生的伺服器端進入點
import * as build from "../build/server";
import { runStrategyEngine, runStockDailyStrategy } from "./services/strategyEngine";
import { runUsCryptoStockSignals } from "./services/usCryptoSignalService";
import { runStockAutoTrading } from "./services/usStockAutoTrading";
import { runDailyKlineRefresh } from "./services/marketData/klineRefresh";

const requestHandler = createRequestHandler(build as any);

// 預設匯出一個符合 Cloudflare Workers 標準的物件
export default {
    // 處理傳入的 Fetch 請求
    fetch(request: Request, env: any, ctx: any) {
        // 將 Cloudflare 的參數 (env, ctx) 注入到由 React Router 處理的 loader/action context 裡
        return requestHandler(request, { cloudflare: { env, ctx } });
    },
    
    // 處理 Cloudflare Cron Triggers 排程任務
    async scheduled(controller: any, env: any, ctx: any) {
        const cron = controller?.cron;
        console.log(`🕒 [Scheduler] 觸發 cron: ${cron}`);

        // 使用 ctx.waitUntil 確保非同步任務在 Worker 結束前完成
        switch (cron) {
            case "*/15 * * * *":
                ctx.waitUntil(runStrategyEngine(env));
                break;
            case "0 6 * * *":
                ctx.waitUntil(runStockDailyStrategy(env, "TW", "market"));
                // 回測用 K 線快取每日增量更新(獨立 waitUntil,失敗不影響日報)
                ctx.waitUntil(runDailyKlineRefresh(env));
                break;
            case "15 6 * * *":
                ctx.waitUntil(runStockDailyStrategy(env, "TW", "strategy"));
                break;
            case "30 20 * * *":
                ctx.waitUntil(runStockDailyStrategy(env, "US", "market"));
                break;
            case "45 20 * * *":
                ctx.waitUntil(runStockDailyStrategy(env, "US", "strategy"));
                // 虛擬幣概念美股收盤訊號:與美股策略日報同時段,獨立 waitUntil 隔離失敗影響
                ctx.waitUntil(runUsCryptoStockSignals(env));
                // 美股代幣(Bitget rToken)自動交易:預設關閉,僅開啟 stockAutoTradingEnabled 的使用者會實際下單
                ctx.waitUntil(runStockAutoTrading(env));
                break;
            default:
                console.log(`ℹ️ [Scheduler] 未定義的 cron，略過: ${cron}`);
        }
    }
};
