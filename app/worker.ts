/** @file HTTP 與排程入口；Bitget 合約依獨立憑證、模式與實戰授權執行。 */
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
import { runPotentialBigFish } from "./services/potentialRadar/bigFishJob";
import { runBinancePerpNotificationQueue, runBinancePerpRadar } from "./services/binancePerpRadar/scanner";
import { runUsStockRadar } from "./services/usStockRadar/scanner";
import { runTwStockRadar } from "./services/twStockRadar/scanner";
import { pruneTradingviewData } from "./services/tradingview/signalLog";
import { runCryptoFuturesStopMonitor } from "./services/cryptoAutoTrading/stopMonitor";

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
            case "1,2,3,4,5,7,8,16,17,18,19,20,22,23,31,32,33,34,35,37,38,46,47,48,49,50,52,53 * * * *": {
                const quarterOffset = scheduledMinute % 15;
                if (quarterOffset >= 1 && quarterOffset <= 4) {
                    /**
                     * 永續吃大魚改看 4 小時線：每 15 分鐘仍喚醒四個分片，但同一根 4 小時 K 已成功的分片會直接略過，
                     * 實際行情掃描每 4 小時各一次；失敗的分片則利用之後的 15 分槽位自動重試。
                     */
                    ctx.waitUntil(runBinancePerpRadar(env, quarterOffset - 1));
                } else if (quarterOffset === 5) {
                    /**
                     * 潛力幣 4 小時吃大魚獨立計算，緊接在 :06 的雷達之前；獨立一次執行才有自己的 50 個子請求額度。
                     * 與同分鐘觸發的「每五分鐘」排程是不同 Trigger、不同執行，互不分享額度。只寫觀察結果，絕不下單。
                     */
                    ctx.waitUntil(runPotentialBigFish(env));
                } else if (quarterOffset === 7) {
                    /** 每 15 分鐘輕量檢查 SPY，只在新的 4h／收盤段完成時執行美股全掃描。 */
                    ctx.waitUntil(runUsStockRadar(env));
                } else if (quarterOffset === 8) {
                    /** 台股再錯開一分鐘；先輕量檢查 0050，只在 13:00／13:30 新收盤段執行完整掃描。 */
                    ctx.waitUntil(runTwStockRadar(env));
                }
                break;
            }
            case "6,21,36,51 * * * *":
                /** 永續四批完成後執行現貨潛力幣；合格新候選才由既有 Slack 設定補送。 */
                ctx.waitUntil(runPotentialRadar(env));
                break;
            case "*/5 * * * *":
                /** 每五分鐘僅送一則既有永續通知；不重抓行情，並以共用租約避免和完整掃描重複發送。 */
                ctx.waitUntil(runBinancePerpNotificationQueue(env));
                /** Demo／LIVE 永續進場皆附原生停損；五分鐘再以 Mark Price 備援檢查。 */
                ctx.waitUntil(runCryptoFuturesStopMonitor(env));
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
