/** @file 合約訊號通知佇列；正式與模擬清楚標記，通知重試不重新下單。 */
import { and, asc, eq, lte, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { futuresAutomation, futuresAutomationEvents } from '../../db/futuresAutomationSchema';
import type { CryptoFuturesTradingEnv } from '../cryptoAutoTrading/types';
import { cryptoFuturesTradeSlackChannel } from '../cryptoAutoTrading/engine';
import { sendSlackMessage } from '../slackService';
import { AUTO_ORDER_LABELS, FUTURES_AUTO_STRATEGIES } from './automation';
const date = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export async function enqueueAutomationEvent(env: CryptoFuturesTradingEnv, event: typeof futuresAutomationEvents.$inferInsert) {
  await drizzle(env.DB).insert(futuresAutomationEvents).values(event).onConflictDoNothing().run();
}
export async function deliverAutomationNotifications(env: CryptoFuturesTradingEnv) {
  const db = drizzle(env.DB), now = Date.now();
  const events = await db.select().from(futuresAutomationEvents).where(and(eq(futuresAutomationEvents.notificationStatus, 'PENDING'),
    ne(futuresAutomationEvents.orderStatus, 'PENDING'), lte(futuresAutomationEvents.nextAttemptAt, now)))
    .orderBy(asc(futuresAutomationEvents.signalAt)).limit(10).all();
  for (const event of events) {
    const lease = now + 60_000;
    const claimed = await db.update(futuresAutomationEvents).set({ deliveryLeaseUntil: lease })
      .where(and(eq(futuresAutomationEvents.id, event.id), eq(futuresAutomationEvents.notificationStatus, 'PENDING'), lte(futuresAutomationEvents.deliveryLeaseUntil, now)))
      .returning().get();
    if (!claimed) continue;
    const config = await db.select().from(futuresAutomation).where(eq(futuresAutomation.userId, event.userId)).get();
    /** 已送出的委託即使使用者停止也要告知；尚未送單的舊設定訊號才取消。 */
    const sentOrder = ['SUBMITTED', 'FILLED', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(event.orderStatus);
    const matches = config?.enabled && config.executionMode === event.executionMode && config.strategyId === event.strategyId;
    if (!sentOrder && !matches || now - event.signalAt > 30 * 60_000) {
      await db.update(futuresAutomationEvents).set({ notificationStatus: config?.enabled ? 'EXPIRED' : 'CANCELED', deliveryLeaseUntil: 0 })
        .where(eq(futuresAutomationEvents.id, event.id)).run();
      continue;
    }
    const labels: Record<string, string> = { OPEN_LONG: '做多進場', OPEN_SHORT: '做空進場', CLOSE_LONG: '多單出場', CLOSE_SHORT: '空單出場' };
    const strategy = FUTURES_AUTO_STRATEGIES.find(row => row.id === event.strategyId)?.name ?? event.strategyId;
    const live = event.executionMode === 'LIVE';
    const message = `${live ? '⚠️' : '🧪'} ${event.symbol}｜${live ? 'LIVE 正式' : 'Demo'} 自動訊號｜${labels[event.intent] ?? event.intent}\n` +
      `${strategy}｜${date.format(event.signalAt)}（台北時間）\n參考價 ${event.price}\n` +
      (event.stopPrice != null ? `計畫停損 ${event.stopPrice}｜目標 ${event.targetPrice ?? '—'}\n` : '') +
      `委託狀態：${AUTO_ORDER_LABELS[event.orderStatus] ?? event.orderStatus}\n${event.orderReason || event.reason}\n` +
      `訊號識別：${event.executionMode}:${event.symbol}:${event.signalAt}:${event.intent}\n${live ? '正式盤真實委託' : '模擬盤'}・實際成交以 Bitget／復盤對帳為準`;
    const channel = cryptoFuturesTradeSlackChannel(env);
    /** 交易所錯誤文字不可信任，跳脫 Slack 特殊字元，避免變成提及使用者或連結。 */
    const safeMessage = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const sent = !!env.SLACK_API_TOKEN && !!channel && await sendSlackMessage(env.SLACK_API_TOKEN, channel, safeMessage);
    /** shortcut: 通知回應遺失可能重複投遞，卡片保留固定識別；需要嚴格單次投遞時改用支援冪等鍵的管道。 */
    const attempts = event.attempts + 1;
    await db.update(futuresAutomationEvents).set({ notificationStatus: sent ? 'SENT' : attempts >= 3 ? 'FAILED' : 'PENDING', attempts,
      nextAttemptAt: Date.now() + attempts * 60_000, deliveryLeaseUntil: 0 }).where(eq(futuresAutomationEvents.id, event.id)).run();
  }
}
