/** @file Bitget USDT 永續自動交易引擎；支援獨立 Demo／LIVE 憑證，且永遠只開多與平多。 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { cryptoAutoOrders } from '../../db/cryptoAutoTradeSchema';
import { paperTrades, users } from '../../db/schema';
import { decryptData } from '../../utils/encryption';
import {
  closeBitgetFuturesLong,
  configureBitgetFuturesLong,
  fetchBitgetFuturesAccount,
  fetchBitgetFuturesRules,
  placeBitgetFuturesLong,
  type BitgetFuturesRules,
} from '../bitgetService';
import { calculateRiskBasedPosition } from '../positionSizing';
import { evaluateCapitalRisk } from '../riskGuard';
import { sendSlackMessage } from '../slackService';
import type { BitgetFuturesExecutionMode, CryptoAutoTradeSignal, CryptoFuturesTradingEnv } from './types';

const ENTRY_FRESHNESS_MS = 30 * 60 * 1000;
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const REASON_PREFIX: Record<BitgetFuturesExecutionMode, string> = {
  DEMO: '[BITGET_DEMO_AUTO:',
  LIVE: '[BITGET_LIVE_AUTO:',
};
const MAX_RISK_PER_TRADE_PCT = 0.25;
const MAX_POSITION_PCT = 5;
/** 使用者可設定的合約槓桿上限；資料異常一律回退為 1 倍。 */
const MAX_LEVERAGE = 50;

type UserRow = typeof users.$inferSelect;

const textDigest = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const floorToPrecision = (value: number, precision: number) => {
  const multiplier = 10 ** precision;
  return Math.floor(value * multiplier) / multiplier;
};

/** 合約張數必須是 sizeMultiplier 的整數倍；最後再依 volumePlace 截斷浮點誤差。 */
const floorToContractStep = (value: number, step: number, precision: number) =>
  floorToPrecision(Math.floor((value + Number.EPSILON) / step) * step, precision);

/** 最高槓桿取使用者與交易所上限較小者；若最低倍數超過使用者上限就拒單。 */
export function resolveFuturesEffectiveLeverage(
  configuredMaxLeverage: unknown,
  rules: Pick<BitgetFuturesRules, 'minLeverage' | 'maxLeverage'>,
) {
  const parsedLeverage = Number(configuredMaxLeverage);
  const safeConfiguredLeverage = Number.isInteger(parsedLeverage) &&
    parsedLeverage >= 1 && parsedLeverage <= MAX_LEVERAGE ? parsedLeverage : 1;
  if (rules.minLeverage > safeConfiguredLeverage) {
    throw new Error(`此合約最低槓桿為 ${rules.minLeverage} 倍，超過你的設定上限 ${safeConfiguredLeverage} 倍`);
  }
  return Math.min(safeConfiguredLeverage, rules.maxLeverage);
}

/** 舊匯出名稱保留，避免既有測試與外部模組升級時中斷。 */
export const resolveDemoEffectiveLeverage = resolveFuturesEffectiveLeverage;

type FuturesEligibility = Pick<UserRow,
  'bitgetFuturesExecutionMode' | 'liveTradingEnabled' |
  'bitgetDemoApiKey' | 'bitgetDemoApiSecret' | 'bitgetDemoPassphrase' |
  'bitgetFuturesLiveApiKey' | 'bitgetFuturesLiveApiSecret' | 'bitgetFuturesLivePassphrase'
>;

/** LIVE 需正式合約憑證與總實戰授權；forcedMode 也不能繞過授權。 */
export function resolveFuturesExecutionMode(
  user: FuturesEligibility,
  forcedMode?: BitgetFuturesExecutionMode,
  action: 'BUY' | 'SELL' = 'BUY',
): BitgetFuturesExecutionMode | null {
  const mode = forcedMode ?? (user.bitgetFuturesExecutionMode === 'LIVE' ? 'LIVE' : 'DEMO');
  if (mode === 'LIVE') {
    /** 關閉實戰授權會阻止新倉，但不能阻止既有正式多單停損／平倉。 */
    return (action === 'SELL' || user.liveTradingEnabled) && user.bitgetFuturesLiveApiKey &&
      user.bitgetFuturesLiveApiSecret && user.bitgetFuturesLivePassphrase ? 'LIVE' : null;
  }
  return user.bitgetDemoApiKey && user.bitgetDemoApiSecret && user.bitgetDemoPassphrase ? 'DEMO' : null;
}

const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '未知錯誤';
  /** 不得把 request headers 或加密金鑰寫入資料庫。 */
  return message.replace(/[\r\n]/g, ' ').slice(0, 240);
};

const sourceEnabledForEntry = (user: UserRow, signal: CryptoAutoTradeSignal) => {
  if (signal.source === 'TRADINGVIEW') return user.tradingviewDemoAutoTradingEnabled;
  if (signal.source === 'INTERNAL') return user.internalDemoAutoTradingEnabled;
  return false;
};

async function updateAudit(
  db: ReturnType<typeof drizzle>,
  id: string,
  values: Partial<typeof cryptoAutoOrders.$inferInsert>,
) {
  await db.update(cryptoAutoOrders).set({ ...values, updatedAt: Date.now() })
    .where(eq(cryptoAutoOrders.id, id)).run();
}

/** 合約成交優先走獨立頻道；未設定時才沿用既有虛擬幣訊號頻道。 */
export const cryptoFuturesTradeSlackChannel = (env: CryptoFuturesTradingEnv) =>
  env.CRYPTO_FUTURES_TRADE_SLACK_CHANNEL_ID?.trim() || env.CRYPTO_ENTRY_SLACK_CHANNEL_ID?.trim() || null;

async function notifyExecution(env: CryptoFuturesTradingEnv, message: string) {
  const slackChannel = cryptoFuturesTradeSlackChannel(env);
  if (!env.SLACK_API_TOKEN || !slackChannel) return;
  await sendSlackMessage(env.SLACK_API_TOKEN, slackChannel, message);
}

/** 使用者、環境與來源事件只能插入一次；必須在任何交易所副作用前完成。 */
async function claimSignal(
  db: ReturnType<typeof drizzle>,
  userId: number,
  mode: BitgetFuturesExecutionMode,
  signal: CryptoAutoTradeSignal,
) {
  const digest = await textDigest(`${userId}:${mode}:${signal.source}:${signal.id}`);
  const id = digest.slice(0, 48);
  const clientOid = `cdx${digest.slice(0, 29)}`;
  const now = Date.now();
  const claimed = await db.insert(cryptoAutoOrders).values({
    id, userId, source: signal.source, sourceEventId: signal.id, symbol: signal.symbol,
    action: signal.action, executionMode: mode, signalAt: signal.signalAt,
    referencePrice: signal.referencePrice, status: 'RECEIVED', bitgetClientOid: clientOid,
    createdAt: now, updatedAt: now,
  }).onConflictDoNothing().returning();
  return claimed.length ? { id, clientOid } : null;
}

const tradeRecordMode = (mode: BitgetFuturesExecutionMode) => mode === 'LIVE' ? 'LIVE' : 'PAPER';
const displayMode = (mode: BitgetFuturesExecutionMode) => mode === 'LIVE' ? '正式盤' : 'Demo';
const modeEmoji = (mode: BitgetFuturesExecutionMode) => mode === 'LIVE' ? '⚠️' : '🧪';
const isOwnedTrade = (reason: string | null, mode: BitgetFuturesExecutionMode) =>
  reason?.startsWith(REASON_PREFIX[mode]) ?? false;

async function credentialsForUser(
  env: CryptoFuturesTradingEnv,
  user: UserRow,
  mode: BitgetFuturesExecutionMode,
) {
  if (!env.MASTER_ENCRYPTION_KEY) throw new Error('系統加密金鑰未設定');
  const encrypted = mode === 'LIVE'
    ? [user.bitgetFuturesLiveApiKey, user.bitgetFuturesLiveApiSecret, user.bitgetFuturesLivePassphrase]
    : [user.bitgetDemoApiKey, user.bitgetDemoApiSecret, user.bitgetDemoPassphrase];
  if (!encrypted.every(Boolean)) throw new Error(`Bitget ${displayMode(mode)} 合約金鑰未設定完整`);
  return {
    apiKey: await decryptData(encrypted[0]!, env.MASTER_ENCRYPTION_KEY),
    apiSecret: await decryptData(encrypted[1]!, env.MASTER_ENCRYPTION_KEY),
    passphrase: await decryptData(encrypted[2]!, env.MASTER_ENCRYPTION_KEY),
  };
}

async function processUserSignal(
  db: ReturnType<typeof drizzle>,
  env: CryptoFuturesTradingEnv,
  user: UserRow,
  mode: BitgetFuturesExecutionMode,
  signal: CryptoAutoTradeSignal,
  rules: BitgetFuturesRules,
) {
  const claim = await claimSignal(db, user.id, mode, signal);
  if (!claim) return;
  const label = displayMode(mode);
  const recordMode = tradeRecordMode(mode);
  try {
    const credentials = await credentialsForUser(env, user, mode);
    const allUserTrades = await db.select().from(paperTrades).where(and(
      eq(paperTrades.userId, user.id), eq(paperTrades.market, 'CRYPTO'),
    )).all();
    /** Demo 與正式盤各自計算部位和每日風控，避免測試交易污染正式帳戶額度。 */
    const userTrades = allUserTrades.filter(trade => trade.mode === recordMode);
    const openTrade = userTrades.find(trade =>
      trade.symbol === signal.symbol && trade.status === 'OPEN' && trade.exchange === 'BITGET' &&
      isOwnedTrade(trade.reason, mode),
    );

    if (signal.action === 'BUY') {
      if (openTrade) {
        await updateAudit(db, claim.id, { status: 'IGNORED', reason: `已有同幣種 ${label} 永續多單` });
        return;
      }
      const risk = evaluateCapitalRisk({
        isEntrySignal: true, isLive: mode === 'LIVE', symbol: signal.symbol, trades: userTrades, user,
      });
      if (!risk.allowTrade) {
        await updateAudit(db, claim.id, { status: 'REJECTED', reason: risk.reason });
        return;
      }
      /** 兩種環境都使用硬上限，LIVE 不會因切換模式而放大倉位。 */
      const position = calculateRiskBasedPosition({
        capitalBaseUsdt: risk.settings.capitalBaseUsdt,
        currentPrice: signal.referencePrice,
        maxPositionSizePct: Math.min(risk.settings.maxPositionSizePct, MAX_POSITION_PCT),
        maxRiskPerTradePct: Math.min(risk.settings.maxRiskPerTradePct, MAX_RISK_PER_TRADE_PCT),
        precision: rules.quantityPrecision,
        stopLossPct: Math.min(Math.max(risk.settings.riskStopLossPct, 2), 8),
        minNotionalUsdt: Math.max(rules.minTradeUsdt, 5),
      });
      if (position.reason) {
        await updateAudit(db, claim.id, { status: 'REJECTED', reason: position.reason });
        return;
      }
      const contractQuantity = floorToContractStep(position.quantity, rules.sizeMultiplier, rules.quantityPrecision);
      const contractNotional = contractQuantity * signal.referencePrice;
      if (contractQuantity < rules.minTradeQuantity || contractNotional < rules.minTradeUsdt) {
        await updateAudit(db, claim.id, {
          status: 'REJECTED',
          reason: `風控倉位低於合約最低限制（數量 ${rules.minTradeQuantity}、名目 ${rules.minTradeUsdt} USDT）`,
        });
        return;
      }
      /** 槓桿只降低所需保證金，不放大名目倉位。 */
      const configuredLeverage = mode === 'LIVE' ? user.bitgetFuturesLiveMaxLeverage : user.bitgetDemoMaxLeverage;
      const effectiveLeverage = resolveFuturesEffectiveLeverage(configuredLeverage, rules);
      const estimatedMarginUsdt = contractNotional / effectiveLeverage;
      const account = await fetchBitgetFuturesAccount(
        mode, signal.symbol, credentials.apiKey, credentials.apiSecret, credentials.passphrase,
      );
      /** 逐倉與槓桿設定失敗即拒單，不沿用帳戶既有設定。 */
      await configureBitgetFuturesLong(
        mode, signal.symbol, account, effectiveLeverage,
        credentials.apiKey, credentials.apiSecret, credentials.passphrase,
      );
      const receipt = await placeBitgetFuturesLong({
        environment: mode, symbol: signal.symbol, quantity: contractQuantity,
        quantityPrecision: rules.quantityPrecision, stopLossPrice: position.stopLossPrice,
        pricePrecision: rules.pricePrecision, positionMode: account.positionMode,
        apiDialect: account.apiDialect,
        clientOid: claim.clientOid, ...credentials,
      });
      /** 先保存 orderId 再建立本地部位，避免本地寫入失敗後無紀錄重送。 */
      await updateAudit(db, claim.id, {
        status: 'SUBMITTED', bitgetOrderId: receipt.orderId, bitgetClientOid: receipt.clientOid,
        reason: `通過風控，${label} 永續逐倉 ${effectiveLeverage}x 開多 ${contractQuantity}（${contractNotional.toFixed(2)} USDT）`,
      });
      await db.insert(paperTrades).values({
        userId: user.id, mode: recordMode, market: 'CRYPTO', exchange: 'BITGET',
        symbol: signal.symbol, side: 'BUY', status: 'OPEN',
        entryPrice: signal.referencePrice.toString(), amount: contractQuantity.toString(),
        stopLossPrice: position.stopLossPrice.toString(),
        reason: `${REASON_PREFIX[mode]}${signal.source}:${signal.id}] ${signal.label}｜USDT 永續多單｜Bitget ${label} order ${receipt.orderId}`,
      }).run();
      await notifyExecution(env,
        `${modeEmoji(mode)} *Bitget ${label}永續已開多｜${signal.symbol}*\n` +
        `來源：${signal.source}｜參考價 ${signal.referencePrice}\n` +
        `逐倉 ${effectiveLeverage}x｜倉位 ${contractNotional.toFixed(2)} USDT｜保證金約 ${estimatedMarginUsdt.toFixed(2)} USDT｜原生停損 ${position.stopLossPrice.toPrecision(7)}\n` +
        (mode === 'LIVE' ? '_這是正式盤真實訂單，請到 Bitget 核對成交。_' : '_模擬盤成交仍須以 Bitget Demo 訂單紀錄為準。_'),
      );
      return;
    }

    if (!openTrade) {
      await updateAudit(db, claim.id, { status: 'IGNORED', reason: `沒有本模組建立的同幣種 ${label} 多單` });
      return;
    }
    const heldQuantity = Number(openTrade.amount);
    if (!(heldQuantity > 0)) throw new Error(`本地 ${label} 永續持倉數量無效`);
    /** Flash Close 鎖定 long；不送一般 sell 委託，避免反手開空。 */
    const receipt = await closeBitgetFuturesLong(
      mode, signal.symbol, heldQuantity.toString(), credentials.apiKey, credentials.apiSecret, credentials.passphrase,
    );
    const entryPrice = Number(openTrade.entryPrice);
    const pnl = (signal.referencePrice - entryPrice) * heldQuantity;
    await updateAudit(db, claim.id, {
      status: 'SUBMITTED', bitgetOrderId: receipt.orderId,
      bitgetClientOid: receipt.clientOid || claim.clientOid,
      reason: `${label} 永續平多 ${heldQuantity}；未建立空單`,
    });
    await db.update(paperTrades).set({
      status: 'CLOSED', exitPrice: signal.referencePrice.toString(), pnl: pnl.toFixed(4),
      closedAt: new Date().toISOString(),
    }).where(eq(paperTrades.id, openTrade.id)).run();
    await notifyExecution(env,
      `${modeEmoji(mode)} *Bitget ${label}永續已平多｜${signal.symbol}*\n` +
      `原因：${signal.label}｜參考價 ${signal.referencePrice}\n` +
      `本地估算損益：${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`,
    );
  } catch (error) {
    const reason = safeError(error);
    await updateAudit(db, claim.id, { status: 'FAILED', reason });
    console.error(`[Bitget ${mode} Auto] ${signal.symbol} ${signal.action} 失敗: ${reason}`);
  }
}

/** Webhook 或站內雷達入口；forcedMode 只供既有持倉停損，LIVE 仍不能繞過授權。 */
export async function processCryptoFuturesSignal(
  env: CryptoFuturesTradingEnv,
  signal: CryptoAutoTradeSignal,
  targetUserId?: number,
  forcedMode?: BitgetFuturesExecutionMode,
) {
  if (!Number.isFinite(signal.referencePrice) || signal.referencePrice <= 0) return;
  const now = Date.now();
  if (signal.signalAt > now + FUTURE_CLOCK_TOLERANCE_MS) return;
  if (signal.action === 'BUY' && now - signal.signalAt > ENTRY_FRESHNESS_MS) return;
  const db = drizzle(env.DB);
  const candidates = targetUserId
    ? await db.select().from(users).where(eq(users.id, targetUserId)).all()
    : await db.select().from(users).all();
  const targetUsers = candidates.flatMap(user => {
    const mode = resolveFuturesExecutionMode(user, forcedMode, signal.action);
    return mode && (signal.action === 'SELL' || sourceEnabledForEntry(user, signal)) ? [{ user, mode }] : [];
  });
  if (!targetUsers.length) return;
  let rules: BitgetFuturesRules;
  try {
    rules = await fetchBitgetFuturesRules(signal.symbol);
  } catch (error) {
    console.warn(`[Bitget Futures Auto] ${signal.symbol} 規格查詢失敗: ${safeError(error)}`);
    return;
  }
  /** 逐使用者送單，避免單一 Worker 對 Bitget API 造成突發流量。 */
  for (const target of targetUsers) {
    await processUserSignal(db, env, target.user, target.mode, signal, rules);
  }
}

/** 相容既有程式的 Demo 專用入口；明確鎖定 DEMO，不會碰正式盤。 */
export const processCryptoDemoSignal = (
  env: CryptoFuturesTradingEnv,
  signal: CryptoAutoTradeSignal,
  targetUserId?: number,
) => processCryptoFuturesSignal(env, signal, targetUserId, 'DEMO');
