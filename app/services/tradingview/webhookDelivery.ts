import { cryptoNewEntriesAllowed } from '../cryptoActivityPolicy';
/** @file 已驗證 TradingView 訊號的背景通知、落地與既有合約交易副作用。 */
import { sendSlackPost } from '../slackService';
import { recordTradingviewSignal } from './signalLog';
import { processCryptoFuturesSignal } from '../cryptoAutoTrading/engine';
import { tradingViewPayloadToAutoSignal } from '../cryptoAutoTrading/signal';
import { isExcludedTradingviewSecurity, resolveTradingviewMarket, tradingviewSlackChannel } from './market';

/** Slack mrkdwn 的三個特殊字元須跳脫；symbol/note 來自外部 TradingView 訊息，不可信任其格式。 */
const escapeMrkdwn = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// 允許的訊號方向(僅供顯示分類用,未列出的值仍會被接受並原樣顯示,不因此拒絕請求)
const ACTION_LABELS: Record<string, string> = {
  BUY: '🟢 買進/做多',
  SELL: '🔴 賣出/做空',
  LONG: '🟢 做多',
  SHORT: '🔴 做空',
  CLOSE: '⚪ 平倉',
  EXIT: '⚪ 出場',
};

/** 背景失敗需留下原始訊號稽核；Webhook 已回覆 200 後不能要求 TradingView 替 Slack 重送。 */
export async function deliverTradingviewWebhook(env: any, payload: Record<string, unknown>, rawBody: string, receivedAt: number) {
  const symbol = typeof payload.symbol === 'string' ? payload.symbol : '未提供代號';
  const actionRaw = typeof payload.action === 'string' ? payload.action.toUpperCase() : null;
  const price = typeof payload.price === 'number' ? payload.price : null;
  const note = typeof payload.note === 'string' ? payload.note : null;
  const actionLabel = actionRaw ? (ACTION_LABELS[actionRaw] ?? `⚠️ ${actionRaw}`) : '⚠️ 未提供方向';
  /** 由明示市場或交易所辨識，未知代號不能猜成虛擬幣；台股使用新台幣。 */
  const market = resolveTradingviewMarket(payload);
  const priceCurrency = market === 'tw_stock' ? 'NT$' : '$';

  // 【詳細繁體中文註解:外部 API 副作用】此處呼叫 Slack chat.postMessage 對外發送訊息,
  // 失敗只記錄 log、不視為整體請求失敗 — 避免 Slack 暫時性問題導致 TradingView 誤判
  // webhook 失敗而重試轟炸。
  const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
  /** 三個市場分開投遞，停用虛擬幣訊號時不會影響台股與美股。 */
  const excludedSecurity = isExcludedTradingviewSecurity(payload);
  const slackChannel = excludedSecurity ? null : tradingviewSlackChannel({ ...process.env, ...env }, market);
  const resolvedMarket = market;
  /** 僅 crypto payload 可轉入 Bitget 合約引擎；台股與格式不完整訊號仍只保留原本通知。 */
  const autoTradeSignal = resolvedMarket === 'crypto'
    ? tradingViewPayloadToAutoSignal(payload, receivedAt)
    : null;
  let slackOk: boolean | null = null;
  if (slackToken && slackChannel) {
    /** 卡片樣式跟其他雷達（潛力幣／波段／永續）對齊，靠 📡 圖示與「TradingView」字樣區分來源。 */
    const title = `📡 ${escapeMrkdwn(symbol)}｜TradingView ${actionLabel}`.slice(0, 150);
    const fallback = `${title}${price != null ? `｜進場參考 ${priceCurrency}${price}` : ''}${note ? `｜${note.slice(0, 100)}` : ''}`;
    const blocks: Array<Record<string, unknown>> = [
      { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*方向*\n${escapeMrkdwn(actionLabel)}` },
        ...(price != null ? [{ type: 'mrkdwn', text: `*進場參考價*\n${priceCurrency}${price}` }] : []),
      ] },
      ...(note ? [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: escapeMrkdwn(note.slice(0, 180)) } }] : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: resolvedMarket === 'crypto' ? '外部虛擬幣策略訊號｜Bitget 合約自動交易須另行開啟' : 'TradingView 股票原始訊號｜Yahoo 雷達另加日線與風控篩選' }] },
    ];
    slackOk = await sendSlackPost(slackToken, slackChannel, { text: fallback, blocks });
    if (!slackOk) console.error('🔥 [TradingView Webhook] Slack 推播失敗,訊號未送達');
  } else {
    console.log('[TradingView Webhook] 訊號已接收；通知停用、未知市場或未設定頻道');
  }

  /** 無論 Slack 成功與否都要落地：績效統計看的是訊號本身，不是通知是否送達。 */
  await recordTradingviewSignal(env, {
    receivedAt, market: resolvedMarket, symbol, action: actionRaw, price, note,
    status: excludedSecurity ? 'EXCLUDED_SECURITY' : resolvedMarket === 'unknown' ? 'UNKNOWN_MARKET'
      : resolvedMarket === 'crypto' && (env.CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED ?? process.env.CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED) !== 'true'
        ? 'NOTIFICATION_DISABLED' : slackToken && slackChannel ? 'ACCEPTED' : 'NO_CHANNEL', slackOk, rawBody,
    error: slackOk === false ? 'Slack 推播失敗' : null,
  });

  /** 保留使用者既有自動交易授權；停訊號通知不等於停用已啟用的交易與停損。 */
  if (autoTradeSignal && (autoTradeSignal.action === 'SELL' || cryptoNewEntriesAllowed(env))) await processCryptoFuturesSignal(env, autoTradeSignal);
}
