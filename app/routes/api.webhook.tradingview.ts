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
 * 【目前的整合範圍,刻意保守】
 * 這是外部、未經任何登入驗證的來源送進來的資料 — 除了密鑰比對之外,系統完全無法保證
 * TradingView 那端的策略邏輯是對的、Pine Script 有沒有寫錯、或密鑰有沒有外流。
 * 因此目前只做「驗證後轉發 Slack 通知」,不寫入 paper_trades、不觸發任何自動下單引擎。
 * 若之後要提升(例如記錄成模擬倉位追蹤績效、或串接 Bitget/Binance 自動下單),
 * 請先確認這條路徑已經穩定運作一段時間,再另外評估提升後的風控設計。
 *
 * 【設定方式】
 * 1. 在 Cloudflare 設定機密:wrangler secret put TRADINGVIEW_WEBHOOK_SECRET
 * 2. 到 TradingView 建立警報,Webhook URL 填上面的網址格式
 * 3. 警報訊息(Message)欄位填入合法 JSON,例如:
 *    { "symbol": "{{ticker}}", "action": "{{strategy.order.action}}", "price": {{close}}, "note": "策略說明" }
 *    {{ticker}}/{{close}} 等是 TradingView 的內建佔位符,觸發當下會自動代入實際數值;
 *    {{strategy.order.action}} 只有「策略(strategy)」型腳本才有 buy/sell 值,
 *    純指標(indicator)腳本請把 action 欄位改成寫死的固定文字(例如每個警報條件各自設一個)。
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { sendSlackMessage } from '../services/slackService';

// 允許的訊號方向(僅供顯示分類用,未列出的值仍會被接受並原樣顯示,不因此拒絕請求)
const ACTION_LABELS: Record<string, string> = {
  BUY: '🟢 買進/做多',
  SELL: '🔴 賣出/做空',
  LONG: '🟢 做多',
  SHORT: '🔴 做空',
  CLOSE: '⚪ 平倉',
  EXIT: '⚪ 出場',
};

const jsonResponse = (body: unknown, status: number = 200) => Response.json(body, { status });

// TradingView 只會用 POST 呼叫 webhook;瀏覽器直接訪問這個網址(GET)一律回 405,
// 避免框架預設的伺服器錯誤頁面洩漏堆疊資訊。
export async function loader({ request }: LoaderFunctionArgs) {
  return jsonResponse({ error: '僅支援 POST(這是 TradingView Webhook 接收端點)' }, 405);
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = (context as any).cloudflare.env;

  if (request.method !== 'POST') {
    return jsonResponse({ error: '僅支援 POST' }, 405);
  }

  // 【安全性註解】密鑰比對是這個端點唯一的身分驗證機制(TradingView 不支援自訂
  // Header/簽章),密鑰未設定或不符一律拒絕,且不透露原因細節。
  const configuredSecret = env.TRADINGVIEW_WEBHOOK_SECRET as string | undefined;
  if (!configuredSecret || params.secret !== configuredSecret) {
    console.warn('⚠️ [TradingView Webhook] 密鑰驗證失敗,已拒絕請求');
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // TradingView 只有訊息內容是合法 JSON 時才會用 application/json 送出,否則是純文字,
  // 因此改用 text() 讀原始內容再自行嘗試解析,對兩種情況都能給出清楚的錯誤訊息。
  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error('❌ [TradingView Webhook] 訊息不是合法 JSON,原始內容:', rawBody.slice(0, 200));
    return jsonResponse(
      { error: '訊息內容需為合法 JSON(請檢查 TradingView 警報訊息欄位的引號與逗號)' },
      400
    );
  }

  const symbol = typeof payload.symbol === 'string' ? payload.symbol : '未提供代號';
  const actionRaw = typeof payload.action === 'string' ? payload.action.toUpperCase() : null;
  const price = typeof payload.price === 'number' ? payload.price : null;
  const note = typeof payload.note === 'string' ? payload.note : null;
  const actionLabel = actionRaw ? (ACTION_LABELS[actionRaw] ?? `⚠️ ${actionRaw}`) : '⚠️ 未提供方向';

  // 【詳細繁體中文註解:外部 API 副作用】此處呼叫 Slack chat.postMessage 對外發送訊息,
  // 失敗只記錄 log、不視為整體請求失敗 — 避免 Slack 暫時性問題導致 TradingView 誤判
  // webhook 失敗而重試轟炸。
  const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
  /** TradingView 虛擬幣警報改送獨立即時進場頻道；不 fallback 到一般報表頻道。 */
  const slackChannel = env.CRYPTO_ENTRY_SLACK_CHANNEL_ID || process.env.CRYPTO_ENTRY_SLACK_CHANNEL_ID;
  if (slackToken && slackChannel) {
    const msg = `📡 *${symbol}｜TradingView ${actionLabel}*\n` +
      (price != null ? `進場參考 $${price}\n` : '') +
      (note ? `${note.slice(0, 180)}\n` : '') +
      `外部策略訊號，未自動下單。`;
    const sent = await sendSlackMessage(slackToken, slackChannel, msg);
    if (!sent) console.error('🔥 [TradingView Webhook] Slack 推播失敗,訊號未送達');
  } else {
    console.warn('⚠️ [TradingView Webhook] 未設定 Slack,收到訊號但無處推播');
  }

  return jsonResponse({ success: true });
}
