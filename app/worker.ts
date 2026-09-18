/** @file HTTP 與各獨立排程入口；行情雷達只產生公開市場觀察與使用者授權的 Slack 通知，絕不下單。 */
import { createRequestHandler } from "react-router";
// @ts-ignore
// 引入由 React Router 在建置時產生的伺服器端進入點
import * as build from "../build/server";
import { runStrategyEngine, runStockDailyStrategy } from "./services/strategyEngine";
import { runUsCryptoStockSignals } from "./services/usCryptoSignalService";
import { runStockAutoTrading } from "./services/usStockAutoTrading";
import { runDailyKlineRefresh } from "./services/marketData/klineRefresh";
import { runWaveRadar } from "./services/waveRadar/scanner";
import { runPotentialRadar } from "./services/potentialRadar/scanner";
import { runBinancePerpNotificationQueue, runBinancePerpRadar } from "./services/binancePerpRadar/scanner";
import { runUsStockRadar } from "./services/usStockRadar/scanner";
import { runTwStockRadar } from "./services/twStockRadar/scanner";
import { pruneTradingviewData } from "./services/tradingview/signalLog";

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
        /** 合併 Cron 以符合免費帳號上限；scheduledTime 仍保留真正觸發分鐘，不能靠執行時間猜測。 */
        const scheduledMinute = new Date(controller?.scheduledTime ?? Date.now()).getUTCMinutes();
        console.log(`🕒 [Scheduler] 觸發 cron: ${cron}`);

        // 使用 ctx.waitUntil 確保非同步任務在 Worker 結束前完成
        switch (cron) {
            case "1,3,4,16,18,19,31,33,34,46,48,49 * * * *":
                if (scheduledMinute % 15 === 1) {
                    /** 每根 15 分收盤後一分鐘掃描 Gate；與美股錯開，避免共用同次 Worker 請求額度。 */
                    ctx.waitUntil(runBinancePerpRadar(env));
                } else if (scheduledMinute % 15 === 3) {
                    /** 每 15 分鐘輕量檢查 SPY，只在新的 4h／收盤段完成時執行美股全掃描。 */
                    ctx.waitUntil(runUsStockRadar(env));
                } else if (scheduledMinute % 15 === 4) {
                    /** 台股再錯開一分鐘；先輕量檢查 0050，只在 13:00／13:30 新收盤段執行完整掃描。 */
                    ctx.waitUntil(runTwStockRadar(env));
                }
                break;
            case "2,17,32,47 * * * *":
                /** 收盤後兩分鐘獨立執行；合格新候選入列後才由既有 Slack 設定補送，絕不呼叫下單服務。 */
                ctx.waitUntil(runPotentialRadar(env));
                break;
            case "*/5 * * * *":
                /** 每五分鐘僅送一則既有 Gate 通知；不重抓行情，並以共用租約避免和完整掃描重複發送。 */
                ctx.waitUntil(runBinancePerpNotificationQueue(env));
                if (scheduledMinute % 15 === 0) {
                    ctx.waitUntil(runStrategyEngine(env));
                    // 波段雷達仍每 15 分鐘執行，不因通知佇列加速而增加行情請求。
                    ctx.waitUntil(runWaveRadar(env));
                }
                break;
            case "0,15 6 * * *":
                if (scheduledMinute === 0) {
                    ctx.waitUntil(runStockDailyStrategy(env, "TW", "market"));
                    // 回測用 K 線快取每日增量更新，失敗不影響市場日報。
                    ctx.waitUntil(runDailyKlineRefresh(env));
                    // TradingView 原始訊號 log 每日清理逾期資料，避免 D1 被 payload 撐大。
                    ctx.waitUntil(pruneTradingviewData(env));
                } else if (scheduledMinute === 15) {
                    ctx.waitUntil(runStockDailyStrategy(env, "TW", "strategy"));
                }
                break;
            case "30,45 20 * * *":
                if (scheduledMinute === 30) {
                    ctx.waitUntil(runStockDailyStrategy(env, "US", "market"));
                } else if (scheduledMinute === 45) {
                    ctx.waitUntil(runStockDailyStrategy(env, "US", "strategy"));
                    // 虛擬幣概念美股收盤訊號與美股策略日報同時段，獨立 waitUntil 隔離失敗影響。
                    ctx.waitUntil(runUsCryptoStockSignals(env));
                    // 美股代幣自動交易預設關閉，僅已啟用的使用者會實際下單。
                    ctx.waitUntil(runStockAutoTrading(env));
                }
                break;
            default:
                console.log(`ℹ️ [Scheduler] 未定義的 cron，略過: ${cron}`);
        }
    }
};
