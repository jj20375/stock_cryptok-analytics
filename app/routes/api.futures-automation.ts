/** @file 本人合約自動化設定與唯讀檢查；LIVE 需獨立確認，HTTP 請求不直接送單。 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users, paperTrades, cryptoAutoOrders, futuresAutomation, futuresAutomationEvents } from '../db/schema';
import { getUserId } from '../utils/auth';
import { readSyncBody } from '../services/freqtrade/body.server';
import { DEFAULT_AUTOMATION, automationMode, automationPolicy, validateAutomationInput, type AutomationStatus } from '../services/cryptoFutures/automation';
import { readAutomationChecks, safeAutomationError } from '../services/cryptoFutures/automation.server';
import { cryptoFuturesTradeSlackChannel } from '../services/cryptoAutoTrading/engine';
import type { CryptoFuturesTradingEnv } from '../services/cryptoAutoTrading/types';
import { loadLedgerCredentials } from '../services/bitgetLedger/credentials.server';
import { fetchBitgetFuturesAccount } from '../services/bitgetService';
import { futuresSnapshot } from '../services/cryptoFutures/snapshot.server';
import { futuresAutomationUniverse } from '../services/cryptoFutures/universe.server';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any).cloudflare.env as CryptoFuturesTradingEnv;
  if (!env.SESSION_SECRET) return reply({ error: '登入簽名設定尚未完成' }, 503);
  const userId = await getUserId(request, env);
  if (!userId) return reply({ error: '請先登入' }, 401);
  try {
    const db = drizzle(env.DB), user = await db.select().from(users).where(eq(users.id, userId)).get();
    const config = await db.select().from(futuresAutomation).where(eq(futuresAutomation.userId, userId)).get();
    const events = await db.select({ id: futuresAutomationEvents.id, executionMode: futuresAutomationEvents.executionMode, symbol: futuresAutomationEvents.symbol, strategyId: futuresAutomationEvents.strategyId,
      signalAt: futuresAutomationEvents.signalAt, intent: futuresAutomationEvents.intent, price: futuresAutomationEvents.price, reason: futuresAutomationEvents.reason,
      orderStatus: sql<string>`COALESCE(${cryptoAutoOrders.status}, ${futuresAutomationEvents.orderStatus})`,
      orderReason: sql<string | null>`COALESCE(${cryptoAutoOrders.reason}, ${futuresAutomationEvents.orderReason})`, notificationStatus: futuresAutomationEvents.notificationStatus })
      .from(futuresAutomationEvents).leftJoin(cryptoAutoOrders, and(eq(cryptoAutoOrders.userId, userId), eq(cryptoAutoOrders.sourceEventId, futuresAutomationEvents.id),
        eq(cryptoAutoOrders.executionMode, futuresAutomationEvents.executionMode))).where(eq(futuresAutomationEvents.userId, userId)).orderBy(desc(futuresAutomationEvents.signalAt)).limit(20).all();
    const policies = { DEMO: automationPolicy(env, 'DEMO'), LIVE: automationPolicy(env, 'LIVE') };
    const mode = automationMode(config?.executionMode);
    const status: AutomationStatus = { config: config ? validateAutomationInput({ enabled: config.enabled, executionMode: config.executionMode, testMode: config.testMode, positionPct: config.positionPct, maxOpenPositions: config.maxOpenPositions,
      maxNotionalUsdt: config.maxNotionalUsdt, symbols: JSON.parse(config.symbolsJson).join(', '),
      strategyId: config.strategyId, feePct: config.feeRate * 100 }) : DEFAULT_AUTOMATION,
      policyEnabled: policies[mode].enabled, policyReason: policies[mode].reason, policies,
      hasDemo: !!user?.bitgetDemoApiKey && !!user?.bitgetDemoApiSecret && !!user?.bitgetDemoPassphrase,
      hasLive: !!user?.bitgetFuturesLiveApiKey && !!user?.bitgetFuturesLiveApiSecret && !!user?.bitgetFuturesLivePassphrase,
      liveAuthorized: !!user?.liveTradingEnabled && user?.bitgetFuturesExecutionMode === 'LIVE',
      slackReady: !!env.SLACK_API_TOKEN && !!cryptoFuturesTradeSlackChannel(env), checkedAt: config?.checkedAt ?? null, lastError: config?.lastError ?? null,
      checks: readAutomationChecks(config?.scanStateJson ?? '{}'), events };
    return reply(status);
  } catch (error) {
    return reply({ error: /no such (table|column)/i.test(String(error)) ? '合約自動化尚未套用資料庫更新（0025～0027）' : safeAutomationError(error) }, 503);
  }
}
export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context as any).cloudflare.env as CryptoFuturesTradingEnv;
  if (!env.SESSION_SECRET) return reply({ error: '登入簽名設定尚未完成' }, 503);
  const userId = await getUserId(request, env);
  if (!userId) return reply({ error: '請先登入' }, 401);
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(request.url).origin || !request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: '請從本站提交設定' }, 403);
  try {
    const body = JSON.parse(await readSyncBody(request, 4096)), db = drizzle(env.DB), now = Date.now();
    if (!['save', 'stop', 'check', 'preview'].includes(body.operation)) throw new Error('合約自動化操作無效');
    if (body.operation === 'stop') {
      /** 停止永遠可用，不要求憑證、通知或部署開關；已送出的委託仍需對帳。 */
      await db.insert(futuresAutomation).values({ userId, enabled: false, updatedAt: now })
        .onConflictDoUpdate({ target: futuresAutomation.userId, set: { enabled: false, updatedAt: now } }).run();
      return reply({ message: '已停止自動新倉；已送出的委託與既有部位仍保留保護' });
    }
    const lease = await env.DB.prepare(`INSERT INTO crypto_futures_rate_limits(user_id,next_at) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET next_at=excluded.next_at WHERE next_at<=? RETURNING user_id`).bind(userId, now + 10_000, now).first();
    if (!lease) return reply({ error: '請等十秒後再操作' }, 429);
    if (body.operation === 'check') {
      const mode = automationMode(body.executionMode);
      const { credentials } = await loadLedgerCredentials(env, userId, mode);
      const account = await fetchBitgetFuturesAccount(mode, 'BTCUSDT', credentials.apiKey, credentials.apiSecret, credentials.passphrase);
      return reply({ message: `Bitget ${mode} 帳戶讀取成功（${account.apiDialect}）；此檢查沒有送單，交易權限尚須委託確認` });
    }
    const input = validateAutomationInput(body);
    /** 全市場模式沒有固定清單，預覽與帳戶檢查改用目前成交額最高的合約；只在需要時才讀公開行情。 */
    const firstSymbol = async () => input.universe === 'ALL' ? (await futuresAutomationUniverse())[0] : input.symbols.split(', ')[0];
    if (body.operation === 'preview') {
      /** 預覽唯讀公開行情、本人持倉與交易所 USDT 資金，不儲存啟用或呼叫交易寫入端點。 */
      const snapshot = await futuresSnapshot(env, userId, await firstSymbol(), input.strategyId, input.feePct / 100,
        { source: 'FUTURES_AUTO', executionMode: input.executionMode, positionPct: input.positionPct, maxNotionalUsdt: input.testMode ? input.maxNotionalUsdt : undefined });
      return reply({ preview: { executionMode: input.executionMode, symbol: snapshot.symbol, signalAt: snapshot.signalAt,
        action: snapshot.action.type, reason: snapshot.action.reason, quote: snapshot.quote, error: snapshot.quoteError, maxNotionalUsdt: input.testMode ? input.maxNotionalUsdt : undefined, testMode: input.testMode, capitalUsdt: snapshot.capitalUsdt } });
    }
    if (input.enabled) {
      const live = input.executionMode === 'LIVE';
      if ((live ? body.confirmLive : body.confirmDemo) !== true) throw new Error(live ? '請明確確認使用真實資金全倉自動交易與資金配置' : '請確認只使用 Demo 模擬資金自動交易');
      const policy = automationPolicy(env, input.executionMode);
      if (!policy.enabled) throw new Error(policy.reason!);
      if (live) {
        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        if (!user?.liveTradingEnabled || user.bitgetFuturesExecutionMode !== 'LIVE') throw new Error('請先在設定選擇正式合約 LIVE 並開啟實戰授權');
      }
      if (!env.SLACK_API_TOKEN || !cryptoFuturesTradeSlackChannel(env)) throw new Error('合約 Slack 通知頻道尚未設定');
      const { credentials } = await loadLedgerCredentials(env, userId, input.executionMode);
      await fetchBitgetFuturesAccount(input.executionMode, await firstSymbol(), credentials.apiKey, credentials.apiSecret, credentials.passphrase);
    }
    const old = await db.select().from(futuresAutomation).where(eq(futuresAutomation.userId, userId)).get();
    const symbolsJson = JSON.stringify(input.symbols.split(', '));
    if (old && (old.strategyId !== input.strategyId || old.symbolsJson !== symbolsJson || old.executionMode !== input.executionMode)) {
      const open = await db.select({ id: paperTrades.id }).from(paperTrades).where(and(eq(paperTrades.userId, userId), inArray(paperTrades.mode, ['PAPER', 'LIVE']),
        eq(paperTrades.status, 'OPEN'), like(paperTrades.reason, '[BITGET_%_AUTO:FUTURES_AUTO:%'))).get();
      const pending = await db.select({ id: cryptoAutoOrders.id }).from(cryptoAutoOrders).where(and(eq(cryptoAutoOrders.userId, userId), eq(cryptoAutoOrders.source, 'FUTURES_AUTO'),
        inArray(cryptoAutoOrders.status, ['RECEIVED', 'SUBMITTED', 'UNKNOWN', 'PARTIALLY_FILLED']))).get();
      if (open || pending) throw new Error('自動化仍有部位或未確認委託，請先核對並平倉後再換環境、商品或策略');
    }
    const values = { enabled: input.enabled, executionMode: input.executionMode, testMode: input.testMode, positionPct: input.positionPct, maxOpenPositions: input.maxOpenPositions, maxNotionalUsdt: input.maxNotionalUsdt, symbolsJson, strategyId: input.strategyId, feeRate: input.feePct / 100, updatedAt: now };
    await db.insert(futuresAutomation).values({ userId, ...values }).onConflictDoUpdate({ target: futuresAutomation.userId, set: values }).run();
    return reply({ message: input.enabled ? `${input.executionMode} 自動化已啟用；每分鐘檢查${input.universe === 'ALL' ? '全市場合約' : ''}下一根 1H 收盤訊號，全倉・${input.testMode ? `測試單名目上限 ${input.maxNotionalUsdt} USDT` : '依交易所 USDT 本金與風控分配，不設固定 30U 上限'}`
      : `${input.executionMode} 設定已儲存，尚未啟用自動交易` });
  } catch (error) { return reply({ error: safeAutomationError(error) }, 400); }
}
