import { cryptoNewEntriesAllowed } from '../services/cryptoActivityPolicy';
/**
 * 【詳細繁體中文註解】：TradingView Webhook 接收端點 — 外部訊號通知(僅推播 Slack,不下單)
 *
 * 背景:TradingView 的「警報 Webhook URL」功能會在 Pine Script 策略/警報條件觸發時,
 * 對你設定的網址發送一次 POST(方案需求:Essential 以上 + 帳號開啟 2FA)。
 * TradingView 官方限制:
 *   1. 不支援自訂 HTTP Header,也不會替請求簽章 — 完全沒有原生驗證機制
 *   2. 只有當警報訊息本身是合法 JSON 時才會用 application/json 送出,否則是 text/plain
 *
 * 因此本端點的身分驗證改用「網址路徑帶密鑰」:網址格式為
 *   https://<你的網域>/api/webhook/tradingview/<TRADINGVIEW_WEBHOOK_SECRET>
 * 只有密鑰跟 env.TRADINGVIEW_WEBHOOK_SECRET 完全相符才會處理,其餘一律回 401 且不留下
 * 「密鑰是否存在」之類的線索,避免被暴力猜測。
 *
 * 【交易整合範圍】
 * 通知行為維持相容；只有使用者另行開啟 TradingView 合約訊號時，才會把白名單方向與
 * 有效價格交給 Bitget Demo／LIVE 永續多單引擎。LIVE 還須專用憑證、LIVE 模式與總實戰
 * 授權同時成立；Cloudflare 重試則由包含執行環境的事件鍵去重。
 *
 * 【設定方式】
 * 1. 在 Cloudflare 設定機密:wrangler secret put TRADINGVIEW_WEBHOOK_SECRET
 * 2. 到 TradingView 建立警報,Webhook URL 填上面的網址格式
 * 3. 警報訊息(Message)欄位填入合法 JSON,例如:
 *    { "symbol": "{{ticker}}", "action": "{{strategy.order.action}}", "price": {{close}}, "note": "策略說明" }
 *    {{ticker}}/{{close}} 等是 TradingView 的內建佔位符,觸發當下會自動代入實際數值;
 *    {{strategy.order.action}} 只有「策略(strategy)」型腳本才有 buy/sell 值,
 *    純指標(indicator)腳本請把 action 欄位改成寫死的固定文字(例如每個警報條件各自設一個)。
 * 4. 選用欄位 "market":"tw_stock" 可將訊號改送台股頻道(TW_STOCK_SLACK_CHANNEL_ID),
 *    美股使用 "market":"us_stock"；也可帶 "exchange":"{{exchange}}" 判斷市場。
 *    無法辨識的市場只保留稽核，虛擬幣訊號通知預設停用。
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { recordTradingviewSignal, shouldLogRejection } from '../services/tradingview/signalLog';
import { deliverTradingviewWebhook } from '../services/tradingview/webhookDelivery';
import { resolveTradingviewMarket } from '../services/tradingview/market';
import { tradingViewPayloadToAutoSignal } from '../services/cryptoAutoTrading/signal';

const jsonResponse = (body: unknown, status: number = 200) => Response.json(body, { status });

// TradingView 只會用 POST 呼叫 webhook;瀏覽器直接訪問這個網址(GET)一律回 405,
// 避免框架預設的伺服器錯誤頁面洩漏堆疊資訊。
export async function loader({ request }: LoaderFunctionArgs) {
  return jsonResponse({ error: '僅支援 POST(這是 TradingView Webhook 接收端點)' }, 405);
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = (context as any).cloudflare.env;
  // 已停止 TradingView 訂閱與外部警報；在讀取 payload、D1 或通知副作用前直接退出。
  if (env.TRADINGVIEW_WEBHOOK_ENABLED !== 'true') {
    return jsonResponse({ error: 'TradingView Webhook 已停用；股票訊號由系統自行計算' }, 410);
  }
  /** 以進站時間為準，避免 Slack 或資料庫耗時影響交易配對的時間序。 */
  const receivedAt = Date.now();

  if (request.method !== 'POST') {
    return jsonResponse({ error: '僅支援 POST' }, 405);
  }

  // 【安全性註解】密鑰比對是這個端點唯一的身分驗證機制(TradingView 不支援自訂
  // Header/簽章),密鑰未設定或不符一律拒絕,且不透露原因細節。
  const configuredSecret = env.TRADINGVIEW_WEBHOOK_SECRET as string | undefined;
  if (!configuredSecret || params.secret !== configuredSecret) {
    console.warn('⚠️ [TradingView Webhook] 密鑰驗證失敗,已拒絕請求');
    /** 記下被拒絕的請求（節流後）才能分辨「TradingView 沒送」與「送了但密鑰不符」。 */
    if (shouldLogRejection(receivedAt)) {
      await recordTradingviewSignal(env, {
        receivedAt, market: 'unknown', symbol: '未知', action: null, price: null, note: null,
        status: 'REJECTED_AUTH', slackOk: null, rawBody: '', error: '密鑰不符或未設定',
      });
    }
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // TradingView 只有訊息內容是合法 JSON 時才會用 application/json 送出,否則是純文字,
  // 因此改用 text() 讀原始內容再自行嘗試解析,對兩種情況都能給出清楚的錯誤訊息。
  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('訊息需為 JSON 物件');
  } catch {
    console.error('[TradingView Webhook] 訊息不是合法 JSON 物件');
    await recordTradingviewSignal(env, {
      receivedAt, market: 'unknown', symbol: '未知', action: null, price: null, note: null,
      status: 'REJECTED_JSON', slackOk: null, rawBody, error: '訊息內容不是合法 JSON',
    });
    return jsonResponse(
      { error: '訊息內容需為合法 JSON(請檢查 TradingView 警報訊息欄位的引號與逗號)' },
      400
    );
  }

  const autoSignal = resolveTradingviewMarket(payload) === 'crypto' ? tradingViewPayloadToAutoSignal(payload, receivedAt) : null;
  const futuresQueued = Boolean(autoSignal && (autoSignal.action === 'SELL' || cryptoNewEntriesAllowed(env)));
  /** TradingView 三秒即中止慢請求；將 Slack、D1 與既有合約處理放入 waitUntil 後立即回覆。 */
  const task = deliverTradingviewWebhook(env, payload, rawBody, receivedAt).catch(error => {
    console.error('[TradingView Webhook] 背景處理失敗:', error instanceof Error ? error.message : '未知錯誤');
  });
  const executionContext = (context as any).cloudflare.ctx as { waitUntil?: (promise: Promise<unknown>) => void } | undefined;
  if (executionContext?.waitUntil) executionContext.waitUntil(task);
  else await task;
  return jsonResponse({ success: true, notificationQueued: true, futuresQueued });
}
