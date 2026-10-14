/** @file 每分鐘檢查已收盤 1H 合約策略；Demo／LIVE 分開政策、訊號、持倉與成交對帳。 */
import { and, asc, eq, inArray, like, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { cryptoAutoOrders } from '../../db/cryptoAutoTradeSchema';
import { paperTrades } from '../../db/schema';
import { futuresAutomation, futuresAutomationCandles, futuresAutomationEvents } from '../../db/futuresAutomationSchema';
import { futuresAutomationUniverse } from './universe.server';
import { processCryptoFuturesSignal } from '../cryptoAutoTrading/engine';
import type { BitgetFuturesExecutionMode, CryptoFuturesTradingEnv, FuturesIntent } from '../cryptoAutoTrading/types';
import type { Candle } from '../strategy/types';
import { AUTO_HOUR, AUTO_SIGNAL_MAX_AGE, automationEventId, futuresFundingHours, automationMode, automationPolicy, validateAutomationInput } from './automation';
import { loadAutomationCandles } from './automationCandles.server';
import { deliverAutomationNotifications, enqueueAutomationEvent } from './automationNotifications.server';
import { futuresSnapshot } from './snapshot.server';
import { BitgetApiError } from '../bitgetService';

/** shortcut: 每分鐘最多四個帳戶、各五個商品；多帳戶需要更短延遲時再以佇列分片。 */
const SCAN_BUDGET_MS = 50_000;
export type AutomationChecks = Record<string, { bar: number; reason: string }>;
export function readAutomationChecks(json: string): AutomationChecks {
  try {
    const rows = JSON.parse(json);
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return {};
    return Object.fromEntries(Object.entries(rows).filter(([, row]) => row && typeof row === 'object' &&
      Number.isSafeInteger((row as { bar: number }).bar) && typeof (row as { reason: string }).reason === 'string')) as AutomationChecks;
  } catch { return {}; }
}
export function safeAutomationError(error: unknown) {
  /** 交易所原始文字可能回顯請求細節；僅將白名單錯誤碼送到瀏覽器。 */
  if (error instanceof BitgetApiError && error.code === '40084') return 'Bitget 帳戶為 Classic 經典模式，需使用 V2 合約 API（40084）';
  if (error instanceof BitgetApiError) return `Bitget API 未通過驗證（${error.code.replace(/[^0-9]/g, '').slice(0, 5)}），請核對金鑰環境、口令、權限與 IP 白名單`;
  const failure = error as { cause?: { code?: string }; code?: string };
  const code = failure?.cause?.code ?? failure?.code;
  /** 說明可修復的網路原因，不輸出 headers、簽章或原始憑證。 */
  if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code ?? '')) return 'Bitget HTTPS 憑證驗證失敗，請修正本機信任憑證或網路 HTTPS 檢查；請勿關閉 TLS 驗證';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code ?? '')) return 'Bitget 網域解析失敗，請檢查本機 DNS 或網路後重試';
  const message = error instanceof Error ? error.message : '';
  return /Bitget|合約|行情|盤勢|Demo|策略|持倉|帳戶|商品|風險|憑證|自動化|單邊|通知|部署|Workers|Slack|請|停止/.test(message) && !/SQL|select|insert|encrypted|secret|token|decrypt/i.test(message)
    ? message.replace(/[\r\n]/g, ' ').slice(0, 220) : '自動化暫未完成，請檢查系統設定或交易所連線';
}
async function evaluateSymbol(env: CryptoFuturesTradingEnv, config: typeof futuresAutomation.$inferSelect, symbol: string, candles: Candle[]) {
  const db = drizzle(env.DB);
  const mode = automationMode(config.executionMode);
  const snapshot = await futuresSnapshot(env, config.userId, symbol, config.strategyId, config.feeRate,
    { candles, source: 'FUTURES_AUTO', executionMode: mode, positionPct: config.positionPct, maxNotionalUsdt: config.testMode ? config.maxNotionalUsdt : undefined });
  if (snapshot.action.type === 'HOLD') return snapshot.action.reason || '尚無確認訊號';
  const entry = snapshot.action.type === 'ENTRY';
  const side = snapshot.action.type === 'ENTRY' ? snapshot.action.side : snapshot.position?.side;
  if (!side) throw new Error('合約退出訊號缺少本系統持倉');
  const intent: FuturesIntent = entry ? side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT' : side === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
  const id = automationEventId(config.userId, symbol, config.strategyId, snapshot.signalAt, intent, mode);
  const blocked = entry ? snapshot.quoteError || snapshot.quote?.blockedReason || (!snapshot.quote ? '缺少完整風險估算' : null) : null;
  /** 參考價為訊號根的 USDT 收盤價；實際成交另由交易所對帳，不能把參考價視為成交。 */
  const referencePrice = candles.at(-1)!.close;
  await enqueueAutomationEvent(env, { id, executionMode: mode, userId: config.userId, symbol, strategyId: config.strategyId, signalAt: snapshot.signalAt, intent,
    price: referencePrice, reason: snapshot.action.reason, stopPrice: snapshot.quote?.stopLossPrice, targetPrice: snapshot.quote?.targetPrice, createdAt: Date.now() });
  if (!blocked) await processCryptoFuturesSignal(env, { id, source: 'FUTURES_AUTO', symbol, intent, action: ['OPEN_LONG', 'CLOSE_SHORT'].includes(intent) ? 'BUY' : 'SELL',
    signalAt: snapshot.signalAt, referencePrice, label: snapshot.action.reason, strategyId: config.strategyId, strategyParams: snapshot.strategyParams,
    entryPlan: snapshot.action.type === 'ENTRY' ? snapshot.action.entryPlan : undefined, feeRate: config.feeRate,
    automationUpdatedAt: config.updatedAt, automationTestMode: config.testMode, automationPositionPct: config.positionPct, automationMaxOpenPositions: config.maxOpenPositions, maxNotionalUsdt: config.testMode ? config.maxNotionalUsdt : undefined,
    fundingBudgetRate: Math.max(0, snapshot.metadata.fundingRate * (side === 'SHORT' ? -1 : 1)) *
      Math.ceil(futuresFundingHours(config.strategyId, snapshot.strategyParams) / snapshot.metadata.fundingInterval) }, config.userId, mode);
  const audit = await db.select().from(cryptoAutoOrders).where(and(eq(cryptoAutoOrders.userId, config.userId), eq(cryptoAutoOrders.sourceEventId, id),
    eq(cryptoAutoOrders.executionMode, mode))).get();
  const orderStatus = blocked ? 'BLOCKED' : audit?.status ?? 'NOT_SUBMITTED';
  await db.update(futuresAutomationEvents).set({ orderStatus, orderReason: blocked || audit?.reason || `請確認 ${mode} 憑證與自動化授權` })
    .where(eq(futuresAutomationEvents.id, id)).run();
  return `${snapshot.action.reason}・${orderStatus}`;
}
/**
 * 全市場掃描順序：本系統持倉 → 已有 K 線快取 → 尚未暖機。
 * 持倉商品即使跌出成交額門檻也要繼續檢查出場；有快取的商品每根只補一頁，
 * 優先處理才能在收盤後五分鐘內完成判斷，暖機較慢的新商品排在最後。
 */
async function allMarketScanOrder(env: CryptoFuturesTradingEnv, config: typeof futuresAutomation.$inferSelect) {
  const db = drizzle(env.DB), mode = automationMode(config.executionMode);
  const prefix = `[BITGET_${mode}_AUTO:FUTURES_AUTO:`;
  const held = (await db.select({ symbol: paperTrades.symbol, reason: paperTrades.reason }).from(paperTrades).where(and(eq(paperTrades.userId, config.userId),
    eq(paperTrades.mode, mode === 'LIVE' ? 'LIVE' : 'PAPER'), eq(paperTrades.exchange, 'BITGET'), eq(paperTrades.status, 'OPEN'), like(paperTrades.reason, `${prefix}%`))).all())
    /** LIKE 的底線是萬用字元，仍逐字確認是本自動化建立的部位。 */
    .filter(row => row.reason?.startsWith(prefix)).map(row => row.symbol);
  const universe = await futuresAutomationUniverse();
  const cached = new Set((await db.select({ symbol: futuresAutomationCandles.symbol }).from(futuresAutomationCandles).all()).map(row => row.symbol));
  return [...new Set([...held, ...universe.filter(symbol => cached.has(symbol)), ...universe.filter(symbol => !cached.has(symbol))])];
}
export async function runFuturesAutomation(env: CryptoFuturesTradingEnv, scope?: BitgetFuturesExecutionMode) {
  const modes = (scope ? [scope] : ['DEMO', 'LIVE'] as BitgetFuturesExecutionMode[]).filter(mode => automationPolicy(env, mode).enabled);
  if (!modes.length) return;
  const db = drizzle(env.DB), startedAt = Date.now();
  const configs = await db.select().from(futuresAutomation).where(and(eq(futuresAutomation.enabled, true), inArray(futuresAutomation.executionMode, modes)))
    .orderBy(asc(futuresAutomation.checkedAt)).limit(4).all();
  const candles = new Map<string, Promise<Candle[]>>();
  for (const config of configs) {
    if (Date.now() - startedAt >= SCAN_BUDGET_MS) break;
    const owner = crypto.randomUUID();
    const claim = await db.update(futuresAutomation).set({ leaseOwner: owner, leaseUntil: Date.now() + 120_000 })
      .where(and(eq(futuresAutomation.userId, config.userId), eq(futuresAutomation.enabled, true), lte(futuresAutomation.leaseUntil, Date.now())))
      .returning().get();
    if (!claim) continue;
    const checks = readAutomationChecks(claim.scanStateJson);
    let lastError: string | null = null;
    try {
      const parsed = validateAutomationInput({ enabled: claim.enabled, executionMode: claim.executionMode, testMode: claim.testMode, positionPct: claim.positionPct, maxOpenPositions: claim.maxOpenPositions, maxNotionalUsdt: claim.maxNotionalUsdt,
        symbols: JSON.parse(claim.symbolsJson).join(', '), strategyId: claim.strategyId, feePct: claim.feeRate * 100 });
      const symbols = parsed.universe === 'ALL' ? await allMarketScanOrder(env, claim) : parsed.symbols.split(', ');
      /** 只保留本輪商品的檢查狀態；全市場清單每小時變動，舊商品不能無限累積在設定列。 */
      for (const key of Object.keys(checks)) if (!symbols.some(symbol => key === `${claim.strategyId}:${symbol}`)) delete checks[key];
      const errors: string[] = [];
      for (const symbol of symbols) {
        if (Date.now() - startedAt >= SCAN_BUDGET_MS) break;
        const closedAt = Math.floor(Date.now() / AUTO_HOUR) * AUTO_HOUR, key = `${claim.strategyId}:${symbol}`;
        if (checks[key]?.bar === closedAt) continue;
        try {
          const cacheKey = `${symbol}:${closedAt}`;
          if (!candles.has(cacheKey)) candles.set(cacheKey, loadAutomationCandles(env, symbol, closedAt - AUTO_HOUR));
          const bars = await candles.get(cacheKey)!;
          /** 首次啟用先暖機，收盤時只補一根；晚啟用也不能把舊訊號當作即時進場。 */
          const reason = Date.now() - closedAt > AUTO_SIGNAL_MAX_AGE ? '暖機完成，等待下一根 1H 收盤；不追補超過五分鐘的進場'
            : await evaluateSymbol(env, claim, symbol, bars);
          checks[key] = { bar: closedAt, reason };
        } catch (error) {
          errors.push(`${symbol}：${safeAutomationError(error)}`);
          /** 五分鐘訊號窗口內保留重試；窗口外記錄原因並停止本小時重試，避免歷史不足的新商品每分鐘重抓行情。 */
          if (Date.now() - closedAt > AUTO_SIGNAL_MAX_AGE) checks[key] = { bar: closedAt, reason: `暫停：${safeAutomationError(error)}` };
        }
      }
      if (errors.length) lastError = errors[0] + (errors.length > 1 ? `（另有 ${errors.length - 1} 個商品未完成）` : '');
    } catch (error) { lastError = safeAutomationError(error); }
    finally {
      /** 設定若被使用者修改，不回寫舊策略的掃描狀態；租約仍須釋放。 */
      await db.update(futuresAutomation).set({ scanStateJson: JSON.stringify(checks), checkedAt: Date.now(), lastError })
        .where(and(eq(futuresAutomation.userId, claim.userId), eq(futuresAutomation.leaseOwner, owner), eq(futuresAutomation.updatedAt, claim.updatedAt))).run();
      await db.update(futuresAutomation).set({ leaseOwner: null, leaseUntil: 0 }).where(and(eq(futuresAutomation.userId, claim.userId), eq(futuresAutomation.leaseOwner, owner))).run();
    }
  }
  await deliverAutomationNotifications(env);
}
/** 舊入口只執行 Demo，供既有呼叫端與測試相容；不能因新增 LIVE 政策而改送正式單。 */
export const runFuturesDemoAutomation = (env: CryptoFuturesTradingEnv) => runFuturesAutomation(env, 'DEMO');
