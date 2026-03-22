import { createRequestHandler } from "react-router";
// @ts-ignore
// 引入由 React Router 在建置時產生的伺服器端進入點
import * as build from "../build/server";

const requestHandler = createRequestHandler(build as any);

// 預設匯出一個符合 Cloudflare Workers 標準的物件
export default {
    // 處理傳入的 Fetch 請求
    fetch(request: Request, env: any, ctx: any) {
        // 將 Cloudflare 的參數 (env, ctx) 注入到由 React Router 處理的 loader/action context 裡
        return requestHandler(request, { cloudflare: { env, ctx } });
    },
};
