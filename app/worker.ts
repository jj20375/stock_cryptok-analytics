import { createRequestHandler } from "react-router";
// @ts-ignore
// 引入由 React Router 在建置時產生的伺服器端進入點
import * as build from "../build/server";
import { runStrategyEngine } from "./services/strategyEngine";

const requestHandler = createRequestHandler(build as any);

// 預設匯出一個符合 Cloudflare Workers 標準的物件
export default {
    // 處理傳入的 Fetch 請求
    fetch(request: Request, env: any, ctx: any) {
        // 將 Cloudflare 的參數 (env, ctx) 注入到由 React Router 處理的 loader/action context 裡
        return requestHandler(request, { cloudflare: { env, ctx } });
    },
    
    // 處理 Cloudflare Cron Triggers 排程任務
    async scheduled(event: any, env: any, ctx: any) {
        // 使用 ctx.waitUntil 確保非同步任務在 Worker 結束前完成
        ctx.waitUntil(runStrategyEngine(env));
    }
};
