/** @file HTTP 與排程入口；Bitget 合約依獨立憑證、模式與實戰授權執行。 */
import { createRequestHandler } from "react-router";
// @ts-ignore
// 引入由 React Router 在建置時產生的伺服器端進入點
import * as build from "../build/server";
import { runStrategyEngine, runStockDailyStrategy } from "./services/strategyEngine";
import { runUsCryptoStockSignals } from "./services/usCryptoSignalService";
import { runStockAutoTrading } from "./services/usStockAutoTrading";
import { runDailyKlineRefresh } from "./services/marketData/klineRefresh";
import { runUsStockRadar } from "./services/usStockRadar/scanner";
import { runTwStockRadar } from "./services/twStockRadar/scanner";
import { pruneTradingviewData } from "./services/tradingview/signalLog";
import { runCryptoFuturesStopMonitor } from "./services/cryptoAutoTrading/stopMonitor";
import { syncRegisteredLedgers } from "./services/bitgetLedger/sync.server";
import { runFuturesAutomation } from "./services/cryptoFutures/automation.server";
import { runTwPreopenMacroSnapshot } from "./services/macro/snapshotStore.server";

import { SCHEDULES, isTwPreopenSnapshotTime, isUsDailyReportTime } from "./services/scheduledJobs";

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
        // 所有日報與交易時段判斷都使用真正排程的 UTC 時間，避免排隊延遲改變工作分類。
        const scheduledAt = controller?.scheduledTime ?? Date.now();
        const scheduledMinute = new Date(scheduledAt).getUTCMinutes();
        switch (cron) {
            case SCHEDULES.twRadar:
                ctx.waitUntil(runTwStockRadar(env));
                break;
            case SCHEDULES.usRadar:
                ctx.waitUntil(runUsStockRadar(env));
                break;
            case SCHEDULES.protection:
                /** 兩種環境各自部署開關與本人授權；舊雷達不因合約自動化開放而啟用。 */
                ctx.waitUntil(runFuturesAutomation(env).catch(() => console.warn('[Futures Auto] 本輪未完成，留待下輪重試')));
                if (isTwPreopenSnapshotTime(scheduledAt)) {
                    // 台北 08:30 寫入羅盤預測快照（D1），只讀公開行情、不發通知；失敗不影響合約保護流程。
                    ctx.waitUntil(runTwPreopenMacroSnapshot(env).catch(() => console.warn('[Macro Snapshot] 開盤前快照未完成')));
                }
                if (scheduledMinute % 5 !== 0) break;
                /** 原生停損之外的備援與成交對帳維持五分鐘，不因關閉自動新倉而停用。 */
                ctx.waitUntil((async () => {
                    // 先檢查持倉保護，歷史分頁同步不能延遲既有停損；兩者失敗各自保留重試。
                    try { await runCryptoFuturesStopMonitor(env); }
                    catch { console.warn('[Bitget Stop] 持倉保護未完成，留待下輪重試'); }
                    try { await syncRegisteredLedgers(env); }
                    catch { console.warn('[Bitget Ledger] 排程對帳暫不可用，留待下輪重試'); }
                })());
                if (scheduledMinute % 15 === 0) {
                    // 現貨引擎於自動掃描停用時只檢查已持有標的，禁止固定幣池掃描及新倉。
                    ctx.waitUntil(runStrategyEngine(env));
                }
                break;
            case SCHEDULES.twDaily:
                if (scheduledMinute === 0) {
                    ctx.waitUntil(runStockDailyStrategy(env, "TW", "market"));
                    ctx.waitUntil(runDailyKlineRefresh(env));
                    ctx.waitUntil(pruneTradingviewData(env));
                } else {
                    ctx.waitUntil(runStockDailyStrategy(env, "TW", "strategy"));
                }
                break;
            case SCHEDULES.usDaily:
                if (!isUsDailyReportTime(scheduledAt)) break;
                if (scheduledMinute === 30) {
                    ctx.waitUntil(runStockDailyStrategy(env, "US", "market"));
                } else {
                    ctx.waitUntil(runStockDailyStrategy(env, "US", "strategy"));
                    // COIN／MSTR 是實際美股，與截圖中的台股權證不同，沿用既有股票日線檢查。
                    ctx.waitUntil(runUsCryptoStockSignals(env));
                    ctx.waitUntil(runStockAutoTrading(env));
                }
                break;
            default:
                console.log('[Scheduler] 非現行排程，略過');
        }
    }
};
