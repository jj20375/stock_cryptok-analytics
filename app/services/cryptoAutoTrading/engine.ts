/** @file Bitget USDT 永續自動交易引擎；支援獨立 Demo／LIVE 憑證，舊來源維持開多／平多，新策略明確區分多空操作。 */
import { cryptoNewEntriesAllowed } from '../cryptoActivityPolicy';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { cryptoAutoOrders } from '../../db/cryptoAutoTradeSchema';
import { paperTrades, users } from '../../db/schema';
import { decryptData } from '../../utils/encryption';
import { digestText, registerLedgerAccount } from '../bitgetLedger/credentials.server';
import { fetchLedgerSnapshot } from '../bitgetLedger/api.server';
import {
  closeBitgetFuturesLong,
  BitgetApiError,
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
import { futuresSignalIntent, futuresSignalIsEntry, futuresSignalSide } from './types';
import { futuresEntryRisk, futuresLeverageForStop } from '../backtest/futures';
import { futuresMetadata, futuresLiquidityError } from '../cryptoFutures/market.server';
import { applySlippage } from '../backtest/costs';
import { fetchCrossFunds, crossEntryCheck } from '../cryptoFutures/crossFunds.server';
import { reserveCrossTrade } from '../cryptoFutures/reservation.server';
import { getStrategy } from '../strategy/registry';
import { futuresAutomation } from '../../db/futuresAutomationSchema';
import { AUTO_SIGNAL_MAX_AGE, automationConfigAuthorizes, automationEntryAllowed, automationPositionCapPct } from '../cryptoFutures/automation';

/** 舊來源最多接受三十分鐘內的新倉訊號；新 Demo 自動化另以五分鐘上限限制，單位毫秒。 */
const ENTRY_FRESHNESS_MS = 30 * 60 * 1000;
/** 容忍五分鐘時鐘偏差，超出未來時間即拒絕，避免錯誤訊號時間繞過新鮮度。 */
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const REASON_PREFIX: Record<BitgetFuturesExecutionMode, string> = {
  DEMO: '[BITGET_DEMO_AUTO:',
  LIVE: '[BITGET_LIVE_AUTO:',
};
/** 兩種環境共用本金百分比上限；槓桿不能提高計畫風險或名目部位。 */
const MAX_RISK_PER_TRADE_PCT = 0.25;
const MAX_POSITION_PCT = 5;
/** 使用者可設定的合約槓桿上限；資料異常一律回退為 1 倍。 */
const MAX_LEVERAGE = 75;

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
  /** 不保存交易所原始錯誤文字，避免帳戶資訊或憑證被回顯到紀錄與通知。 */
  if (error instanceof BitgetApiError) return `[Bitget] API 未完成（${error.code.replace(/[^0-9]/g, '').slice(0, 5)}）`;
  const message = error instanceof Error ? error.message : '未知錯誤';
  /** 不得把 request headers 或加密金鑰寫入資料庫。 */
  return message.replace(/[\r\n]/g, ' ').slice(0, 240);
};

const sourceEnabledForEntry = (user: UserRow, signal: CryptoAutoTradeSignal) => {
  /** 此來源在入口與送單前另查獨立的帳戶授權，不借用舊吃大魚開關。 */
  if (signal.source === 'FUTURES_AUTO') return true;
  if (signal.source === 'TRADINGVIEW') return user.tradingviewDemoAutoTradingEnabled;
  if (signal.source === 'INTERNAL') return user.internalDemoAutoTradingEnabled;
  return false;
};

async function automationAuthorizesSignal(db: ReturnType<typeof drizzle>, userId: number, signal: CryptoAutoTradeSignal, mode: BitgetFuturesExecutionMode, previousUser?: UserRow) {
  const config = await db.select().from(futuresAutomation).where(eq(futuresAutomation.userId, userId)).get();
  if (!automationConfigAuthorizes(config, signal, mode)) return false;
  if (!previousUser) return true;
  /** 送單前重新讀本人授權與憑證；撤回 LIVE 或輪替金鑰後不沿用掃描開始時的舊值。 */
  const current = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!current || resolveFuturesExecutionMode(current, mode, 'BUY') !== mode || mode === 'LIVE' && current.bitgetFuturesExecutionMode !== 'LIVE') return false;
  const fields = mode === 'LIVE' ? ['bitgetFuturesLiveApiKey', 'bitgetFuturesLiveApiSecret', 'bitgetFuturesLivePassphrase'] as const
    : ['bitgetDemoApiKey', 'bitgetDemoApiSecret', 'bitgetDemoPassphrase'] as const;
  const riskFields = ['capitalBaseUsdt', 'maxRiskPerTradePct', 'maxDailyLossPct', 'maxPositionSizePct', 'maxOpenPositions', 'maxTradesPerDay',
    'bitgetDemoMaxLeverage', 'bitgetFuturesLiveMaxLeverage'] as const;
  return [...fields, ...riskFields].every(field => current[field] === previousUser[field]);
}

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
    action: signal.intent ?? signal.action, executionMode: mode, signalAt: signal.signalAt,
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
  let reservedTradeId: number | null = null;
  let orderAttempted = false;
  let orderAccepted = false;
  let closingTrade: { id: number; reconciliationStatus: string } | null = null;
  const positionSide = futuresSignalSide(signal), entry = futuresSignalIsEntry(signal);
  const sideLabel = positionSide === 'long' ? '多' : '空';
  let executionPrice = signal.referencePrice;
  try {
    const credentials = await credentialsForUser(env, user, mode);
    const scope = { id: await digestText(`${user.id}:${mode}:${credentials.apiKey}`), userId: user.id, environment: mode };
    await registerLedgerAccount(env, scope);
    await updateAudit(db, claim.id, { ledgerAccountId: scope.id });
    const allUserTrades = await db.select().from(paperTrades).where(and(
      eq(paperTrades.userId, user.id), eq(paperTrades.market, 'CRYPTO'),
    )).all();
    /** Demo 與正式盤各自計算部位和每日風控，避免測試交易污染正式帳戶額度。 */
    const userTrades = allUserTrades.filter(trade => trade.mode === recordMode);
    const openTrade = userTrades.find(trade =>
      trade.symbol === signal.symbol && trade.status === 'OPEN' && trade.exchange === 'BITGET' &&
      isOwnedTrade(trade.reason, mode) && trade.side === (positionSide === 'long' ? 'BUY' : 'SELL'),
    );
    /** 專用策略不能平掉舊雷達建立的同商品部位。 */
    if (signal.source === 'FUTURES_AUTO' && openTrade && !openTrade.reason?.startsWith(`${REASON_PREFIX[mode]}FUTURES_AUTO:`)) throw new Error('合約部位不是此自動化建立，拒絕操作');

    if (entry) {
      if (openTrade) {
        await updateAudit(db, claim.id, { status: 'IGNORED', reason: `已有同幣種 ${label} 永續${sideLabel}單` });
        return;
      }
      const crossMargin = signal.source === 'FUTURES_AUTO';
      const account = await fetchBitgetFuturesAccount(mode, signal.symbol, credentials.apiKey, credentials.apiSecret, credentials.passphrase);
      /** 全倉本金每次取本人交易所 USDT 淨值；設定頁的研究本金不影響實際下單。 */
      const funds = crossMargin ? await fetchCrossFunds(mode, signal.symbol, account, credentials) : null;
      const riskUser = funds ? { ...user, capitalBaseUsdt: String(funds.equityUsdt),
        maxPositionSizePct: String(signal.automationPositionPct ?? 5), maxOpenPositions: signal.automationMaxOpenPositions ?? 3 } : user;
      const risk = evaluateCapitalRisk({
        isEntrySignal: true, isLive: mode === 'LIVE', symbol: signal.symbol, trades: userTrades,
        user: signal.strategyId?.startsWith('futures_') ? { ...riskUser, maxDailyLossPct: Math.min(Number(user.maxDailyLossPct) || 1, 1) } : riskUser,
        consecutiveLossCooldownMs: signal.strategyId?.startsWith('futures_') ? 6 * 3_600_000 : undefined,
      });
      /** 舊共用風控最小本金為 10U；實際資金需還原，不能用預設／下限放大少額帳戶。 */
      if (funds) {
        risk.settings.capitalBaseUsdt = funds.equityUsdt;
        if (risk.stats.dailyPnL <= -funds.equityUsdt * Math.min(risk.settings.maxDailyLossPct, 1) / 100) throw new Error('合約日內虧損已達實際本金上限');
      }
      if (!risk.allowTrade) {
        await updateAudit(db, claim.id, { status: 'REJECTED', reason: risk.reason });
        return;
      }
      const positionCapPct = signal.source === 'FUTURES_AUTO'
        ? automationPositionCapPct(risk.settings.capitalBaseUsdt, risk.settings.maxPositionSizePct, signal.maxNotionalUsdt)
        : Math.min(risk.settings.maxPositionSizePct, MAX_POSITION_PCT);
      /** 兩種環境共用比例風控；測試單額度另行限制，正式資金不套用固定 30U。 */
      let position = calculateRiskBasedPosition({
        capitalBaseUsdt: risk.settings.capitalBaseUsdt,
        currentPrice: signal.referencePrice,
        maxPositionSizePct: positionCapPct,
        maxRiskPerTradePct: Math.min(risk.settings.maxRiskPerTradePct, MAX_RISK_PER_TRADE_PCT),
        precision: rules.quantityPrecision,
        stopLossPct: Math.min(Math.max(risk.settings.riskStopLossPct, 2), 8),
        minNotionalUsdt: Math.max(rules.minTradeUsdt, 5),
      });
      let targetPrice: number | undefined, plannedRiskUsdt = 0;
      const configuredLeverage = mode === 'LIVE' ? user.bitgetFuturesLiveMaxLeverage : user.bitgetDemoMaxLeverage;
      let effectiveLeverage = resolveFuturesEffectiveLeverage(configuredLeverage, rules);
      if (signal.strategyId?.startsWith('futures_')) {
        if (!signal.entryPlan || !Number.isFinite(signal.feeRate) || !Number.isFinite(signal.fundingBudgetRate)) throw new Error('合約策略缺少完整風險快照');
        const metadata = await futuresMetadata(signal.symbol);
        /** 市價委託先預留單邊 10 bps 不利成交；實際滑價仍需成交對帳，不保證此界線。 */
        const expectedEntryPrice = applySlippage(metadata.price, positionSide === 'long' ? 'BUY' : 'SELL', { feeRate: 0, slippageBps: 10 });
        /** 最新行情與訊號根分離；成本與結構重新驗證，不能照舊訊號價格估算保證金。 */
        const calculated = futuresEntryRisk(positionSide === 'long' ? 'LONG' : 'SHORT', expectedEntryPrice, signal.entryPlan,
          { feeRate: Math.max(signal.feeRate!, metadata.takerFeeRate ?? 0.0006), slippageBps: 10 }, risk.settings.capitalBaseUsdt,
          risk.settings.maxRiskPerTradePct, positionCapPct, rules.quantityPrecision, effectiveLeverage, signal.fundingBudgetRate);
        if ('error' in calculated) throw new Error(calculated.error);
        const liquidityError = futuresLiquidityError(metadata, calculated.quantity * expectedEntryPrice, positionSide === 'long' ? 'LONG' : 'SHORT');
        if (liquidityError) throw new Error(liquidityError);
        /** 上限內選可容納結構停損的倍數，名目與停損不變；實際保證金仍需帳戶 API 驗證。 */
        const tier = metadata.tiers.find(t => calculated.quantity * expectedEntryPrice >= t.min && calculated.quantity * expectedEntryPrice <= t.max);
        /** 全倉槓桿依商品級距，不使用逐倉停損／強平價格模型降低倍數。 */
        const leverage = crossMargin ? (tier && tier.maxLeverage >= rules.minLeverage
          ? { leverage: Math.floor(Math.min(effectiveLeverage, tier.maxLeverage)) } : { error: '合約全倉級距不足' })
          : futuresLeverageForStop(positionSide === 'long' ? 'LONG' : 'SHORT', expectedEntryPrice,
            calculated.quantity, calculated.stopLossPrice, Math.max(signal.feeRate!, metadata.takerFeeRate ?? 0.0006),
            metadata.tiers, effectiveLeverage, rules.minLeverage);
        if ('error' in leverage) throw new Error(leverage.error);
        effectiveLeverage = leverage.leverage;
        /** 同方向共用 0.5% 計畫風險上限；舊部位另預留名目 0.2% 成本，不把未知費率當零。 */
        const sameSideRisk = userTrades.filter(t => t.status === 'OPEN' && t.side === (positionSide === 'long' ? 'BUY' : 'SELL'))
          .reduce((sum, t) => sum + (Math.abs(Number(t.entryPrice) - Number(t.stopLossPrice)) + Number(t.entryPrice) * (2 * Math.max(signal.feeRate!, metadata.takerFeeRate ?? 0.0006) + 0.002)) * Number(t.amount), 0);
        if (sameSideRisk + calculated.riskUsdt > risk.settings.capitalBaseUsdt * 0.005) throw new Error('同方向總計畫風險超過 0.5%');
        position = { ...position, ...calculated, reason: undefined };
        plannedRiskUsdt = calculated.riskUsdt;
        executionPrice = expectedEntryPrice;
        targetPrice = calculated.targetPrice;
      }
      if (position.reason) {
        await updateAudit(db, claim.id, { status: 'REJECTED', reason: position.reason });
        return;
      }
      const contractQuantity = floorToContractStep(position.quantity, rules.sizeMultiplier, rules.quantityPrecision);
      const contractNotional = contractQuantity * executionPrice;
      /** 數量向下取整後再驗名目；市價實際滑價由成交對帳檢查，不能乘上槓桿放大數量。 */
      if (signal.source === 'FUTURES_AUTO' && signal.maxNotionalUsdt != null && contractNotional > signal.maxNotionalUsdt + 1e-8) throw new Error('合約名目倉位超過授權上限');
      if (contractQuantity < rules.minTradeQuantity || contractNotional < rules.minTradeUsdt) {
        await updateAudit(db, claim.id, {
          status: 'REJECTED',
          reason: `風控倉位低於合約最低限制（數量 ${rules.minTradeQuantity}、名目 ${rules.minTradeUsdt} USDT）`,
        });
        return;
      }
      /** 槓桿只降低所需保證金，不放大名目倉位。 */
      const estimatedMarginUsdt = contractNotional / effectiveLeverage;
      const marginMode = crossMargin ? 'crossed' : 'isolated';
      /**
       * 同商品已有任何方向的部位（手動、其他系統或本系統）一律跳過，不混倉也不在雙向模式另開反向倉；
       * 單向模式下也避免 buy 意外減少手動空倉。2026-10-14 使用者決定：有手動部位的幣種直接跳過。
       */
      const beforeEntry = await fetchLedgerSnapshot(account.apiDialect, credentials, scope);
      if (beforeEntry.positions.some(position => position.symbol === signal.symbol)) {
        await updateAudit(db, claim.id, { status: 'REJECTED', reason: '交易所已有同商品部位（可能是手動單），跳過此幣避免混倉' });
        return;
      }
      /**
       * 其他商品的手動部位不再阻擋新倉，也不由本系統平倉或停損：
       * - 策略風險額度（單筆 0.25%、同方向 0.5%、持倉槽位）只計本系統建立的部位。
       * - 全倉保證金安全改由 crossEntryCheck 以交易所實際可用 USDT 與維持保證金把關，
       *   該數字已包含手動部位占用的保證金與未實現損益。
       * - 出場、停損備援與對帳只處理 reason 帶本模組前綴且帳戶指紋相符的部位。
       */
      /** 保證金模式與槓桿設定失敗即拒單，不沿用帳戶既有設定。 */
      if (signal.source === 'FUTURES_AUTO' && (!automationEntryAllowed(env, signal.source, signal.strategyId, mode)
        || !await automationAuthorizesSignal(db, user.id, signal, mode, user))) throw new Error('自動化授權已停止或設定已變更');
      await configureBitgetFuturesLong(
        mode, signal.symbol, account, effectiveLeverage,
        credentials.apiKey, credentials.apiSecret, credentials.passphrase, positionSide, marginMode,
      );
      const strategySnapshotJson = JSON.stringify({ source: signal.source, label: signal.label,
        signalAt: signal.signalAt, referencePrice: signal.referencePrice, configuredTimeframe: signal.strategyId?.startsWith('futures_') ? '1h' : user.strategyTimeframe,
        requestedQuantity: contractQuantity, notionalUsdt: contractNotional, leverage: effectiveLeverage,
        stopLossPrice: position.stopLossPrice, capitalBaseUsdt: risk.settings.capitalBaseUsdt,
        riskPerTradePct: Math.min(risk.settings.maxRiskPerTradePct, MAX_RISK_PER_TRADE_PCT),
        positionCapPct: Math.min(risk.settings.maxPositionSizePct, MAX_POSITION_PCT), intent: futuresSignalIntent(signal),
        positionSide, strategyId: signal.strategyId, strategyParams: signal.strategyParams, entryPlan: signal.entryPlan, targetPrice,
        marginMode, automationTestMode: signal.automationTestMode,
        maxNotionalUsdt: signal.source === 'FUTURES_AUTO' ? signal.maxNotionalUsdt : undefined,
      });
      /** 發送前以唯一持倉槽保留風控額度；逾時不能直接釋放或當作已成交。 */
      const reservationValues = {
        userId: user.id, mode: recordMode as 'PAPER' | 'LIVE', market: 'CRYPTO', exchange: 'BITGET',
        symbol: signal.symbol, side: positionSide === 'long' ? 'BUY' as const : 'SELL' as const, status: 'OPEN', ledgerAccountId: scope.id, reconciliationStatus: 'PENDING',
        entryPrice: executionPrice.toString(), amount: contractQuantity.toString(),
        stopLossPrice: position.stopLossPrice.toString(),
        reason: `${REASON_PREFIX[mode]}${signal.source}:${signal.id}] ${signal.label}｜USDT 永續${sideLabel}單｜待成交對帳`,
      };
      const reservation = crossMargin ? await reserveCrossTrade(env, { ...reservationValues, maxOpenPositions: signal.automationMaxOpenPositions ?? 3 })
        : await db.insert(paperTrades).values(reservationValues).returning().get();
      if (!reservation) throw new Error('合約持倉名額已滿，無法保留風控額度');
      reservedTradeId = reservation.id;
      await updateAudit(db, claim.id, { paperTradeId: reservedTradeId, requestedQuantity: contractQuantity.toString(), strategySnapshotJson });
      /** 行情檢查可能耗時；使用者中途停止時再次查授權，禁止沿用舊設定開倉。 */
      if (signal.source === 'FUTURES_AUTO' && (!automationEntryAllowed(env, signal.source, signal.strategyId, mode)
        || !await automationAuthorizesSignal(db, user.id, signal, mode, user))) throw new Error('自動化授權已停止或設定已變更');
      if (crossMargin) {
        /** 劃轉或其他委託可能改變餘額；下單前再唯讀資金，不足即取消本地預留。 */
        const latestFunds = await fetchCrossFunds(mode, signal.symbol, account, credentials);
        const metadata = await futuresMetadata(signal.symbol);
        const riskUsdt = plannedRiskUsdt * contractQuantity / position.quantity;
        const rejected = crossEntryCheck(latestFunds, contractNotional, effectiveLeverage, riskUsdt,
          Math.max(signal.feeRate ?? .0006, metadata.takerFeeRate ?? .0006), metadata.tiers);
        if (rejected) throw new Error(rejected);
        if (contractNotional > latestFunds.equityUsdt * positionCapPct / 100 + 1e-8
          || riskUsdt > latestFunds.equityUsdt * Math.min(risk.settings.maxRiskPerTradePct, .25) / 100 + 1e-8) throw new Error('合約本金已降低，請等待下一次訊號重新估算');
        if (!await automationAuthorizesSignal(db, user.id, signal, mode, user) || !automationEntryAllowed(env, signal.source, signal.strategyId, mode)) throw new Error('自動化授權已停止或設定已變更');
      }
      orderAttempted = true;
      const receipt = await placeBitgetFuturesLong({
        environment: mode, symbol: signal.symbol, quantity: contractQuantity,
        quantityPrecision: rules.quantityPrecision, stopLossPrice: position.stopLossPrice,
        pricePrecision: rules.pricePrecision, positionMode: account.positionMode,
        apiDialect: account.apiDialect, marginMode,
        clientOid: claim.clientOid, positionSide, takeProfitPrice: targetPrice, ...credentials,
      });
      orderAccepted = true;
      /** 先保存 orderId 再建立本地部位，避免本地寫入失敗後無紀錄重送。 */
      await updateAudit(db, claim.id, {
        status: 'SUBMITTED', bitgetOrderId: receipt.orderId, bitgetClientOid: receipt.clientOid,
        reason: `通過風控，${label} 永續${crossMargin ? '全倉' : '逐倉'} ${effectiveLeverage}x 開${sideLabel} ${contractQuantity}（${contractNotional.toFixed(2)} USDT）`,
      });
      if (signal.source !== 'FUTURES_AUTO') await notifyExecution(env,
        `${modeEmoji(mode)} *Bitget ${label}永續開${sideLabel}委託已接受｜${signal.symbol}*\n` +
        `來源：${signal.source}｜參考價 ${signal.referencePrice}\n` +
        `逐倉 ${effectiveLeverage}x｜倉位 ${contractNotional.toFixed(2)} USDT｜保證金約 ${estimatedMarginUsdt.toFixed(2)} USDT｜原生停損 ${position.stopLossPrice.toPrecision(7)}\n` +
        (mode === 'LIVE' ? '_這是正式盤真實訂單，請到 Bitget 核對成交。_' : '_模擬盤成交仍須以 Bitget Demo 訂單紀錄為準。_'),
      );
      return;
    }

    if (!openTrade) {
      await updateAudit(db, claim.id, { status: 'IGNORED', reason: `沒有本模組建立的同幣種 ${label} ${sideLabel}單` });
      return;
    }
    if (openTrade.ledgerAccountId && openTrade.ledgerAccountId !== scope.id) throw new Error('持倉憑證已變更，請先至 Bitget 核對原帳戶');
    if (openTrade.reconciliationStatus === 'CLOSE_PENDING') {
      await updateAudit(db, claim.id, { status: 'IGNORED', reason: '已有平倉委託待對帳' });
      return;
    }
    let heldQuantity = Number(openTrade.amount);
    let heldQuantityText = openTrade.amount;
    if (openTrade.ledgerAccountId) {
      /** reservation 可能大於部分成交，平倉前查即時實際 long 數量，不能拿預留數量送單。 */
      const account = await fetchBitgetFuturesAccount(mode, signal.symbol, credentials.apiKey, credentials.apiSecret, credentials.passphrase);
      const snapshot = await fetchLedgerSnapshot(account.apiDialect, credentials, scope);
      const actual = snapshot.positions.find(position => position.symbol === signal.symbol && position.side === positionSide);
      if (!actual) { await updateAudit(db, claim.id, { status: 'IGNORED', reason: `交易所未持有${sideLabel}單，等待成交對帳` }); return; }
      if (Number(actual.quantity) > Number(openTrade.amount)) throw new Error('交易所持倉量超過本系統記錄，請核對是否含其他來源倉位');
      heldQuantity = Number(actual.quantity);
      heldQuantityText = actual.quantity;
    }
    if (!(heldQuantity > 0)) throw new Error(`本地 ${label} 永續持倉數量無效`);
    await updateAudit(db, claim.id, { paperTradeId: openTrade.id, requestedQuantity: heldQuantity.toString(),
      strategySnapshotJson: JSON.stringify({ source: signal.source, label: signal.label, signalAt: signal.signalAt, referencePrice: signal.referencePrice }) });
    if (openTrade.ledgerAccountId) {
      /** 平倉委託只允許一個執行者領取；逾時保留未知狀態直到唯讀對帳證實結果。 */
      const claimedClose = await db.update(paperTrades).set({ reconciliationStatus: 'CLOSE_PENDING' })
        .where(and(eq(paperTrades.id, openTrade.id), eq(paperTrades.reconciliationStatus, openTrade.reconciliationStatus))).returning().get();
      if (!claimedClose) { await updateAudit(db, claim.id, { status: 'IGNORED', reason: '已有其他平倉流程' }); return; }
      closingTrade = { id: openTrade.id, reconciliationStatus: openTrade.reconciliationStatus };
    }
    /** Flash Close 鎖定 long；不送一般 sell 委託，避免反手開空。 */
    orderAttempted = true;
    const receipt = await closeBitgetFuturesLong(
      mode, signal.symbol, heldQuantityText, credentials.apiKey, credentials.apiSecret, credentials.passphrase, claim.clientOid, positionSide,
    );
    orderAccepted = true;
    const entryPrice = Number(openTrade.entryPrice);
    const pnl = (signal.referencePrice - entryPrice) * heldQuantity * (positionSide === 'long' ? 1 : -1);
    await updateAudit(db, claim.id, {
      status: 'SUBMITTED', bitgetOrderId: receipt.orderId,
      bitgetClientOid: receipt.clientOid || claim.clientOid,
      reason: `${label} 永續平${sideLabel} ${heldQuantity}；只減少指定持倉`,
    });
    /** 舊紀錄沒有 entry 指紋，只保留原本停損路徑與估算標籤；新紀錄由成交對帳關倉。 */
    if (!openTrade.ledgerAccountId) await db.update(paperTrades).set({
      status: 'CLOSED', exitPrice: signal.referencePrice.toString(), pnl: pnl.toFixed(4),
      reconciliationStatus: 'ESTIMATED', closedAt: new Date().toISOString(),
    }).where(eq(paperTrades.id, openTrade.id)).run();
    if (signal.source !== 'FUTURES_AUTO') await notifyExecution(env,
      `${modeEmoji(mode)} *Bitget ${label}永續平${sideLabel}委託已接受｜${signal.symbol}*\n` +
      `原因：${signal.label}｜參考價 ${signal.referencePrice}\n` +
      `本地估算損益：${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`,
    );
  } catch (error) {
    const reason = safeError(error);
    /** 通知失敗不能覆蓋已接受訂單；網路逾時視為結果未知，不自動重送。 */
    /** HTTP 5xx 或系統碼可能是回應遺失，不可當作明確拒單；僅釋放驗證／業務拒單。 */
    const explicitlyRejected = error instanceof BitgetApiError && /^(?:4\d{2}|[1-4]\d{4})$/.test(error.code);
    if (!orderAccepted) await updateAudit(db, claim.id, { status: orderAttempted && !explicitlyRejected ? 'UNKNOWN' : 'FAILED', reason });
    if (reservedTradeId && (!orderAttempted || explicitlyRejected)) await db.update(paperTrades).set({ status: 'CANCELED', reconciliationStatus: 'NOT_SUBMITTED' }).where(eq(paperTrades.id, reservedTradeId)).run();
    /** 明確拒單才解除平倉鎖；逾時、回應格式錯誤仍等待交易所資料，禁止盲目重送。 */
    if (closingTrade && !orderAccepted && (!orderAttempted || explicitlyRejected)) await db.update(paperTrades)
      .set({ reconciliationStatus: closingTrade.reconciliationStatus }).where(and(eq(paperTrades.id, closingTrade.id), eq(paperTrades.reconciliationStatus, 'CLOSE_PENDING'))).run();
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
  // 在任何 D1 查詢、金鑰解密與交易所請求前阻擋新倉；SELL 仍可保護既有持倉。
  const entry = futuresSignalIsEntry(signal);
  /** 本來源必須指定環境與本人；正式新倉必須通過獨立部署政策，平倉保護仍可用。 */
  if (signal.source === 'FUTURES_AUTO' && (!targetUserId || !forcedMode || entry && !automationEntryAllowed(env, signal.source, signal.strategyId, forcedMode))) return;
  /** 研究模組可顯示歷史訊號，但不得藉排程、Webhook 或 forcedMode 開 Demo／LIVE 新倉。 */
  if (entry && getStrategy(signal.strategyId ?? '')?.backtestOnly) return;
  /** 僅做多模組不能由其他來源或變造訊號改成開空；既有空單平倉保護仍可使用。 */
  if (entry && futuresSignalSide(signal) === 'short' && getStrategy(signal.strategyId ?? '')?.supportsShort === false) return;
  if (signal.intent && !['OPEN_LONG', 'OPEN_SHORT', 'CLOSE_LONG', 'CLOSE_SHORT'].includes(signal.intent)) return;
  if (signal.intent && signal.source === 'TRADINGVIEW') return;
  if (entry && !cryptoNewEntriesAllowed(env) && !automationEntryAllowed(env, signal.source, signal.strategyId, forcedMode)) return;
  if (!Number.isFinite(signal.referencePrice) || signal.referencePrice <= 0) return;
  const now = Date.now();
  if (signal.signalAt > now + FUTURE_CLOCK_TOLERANCE_MS) return;
  if (entry && now - signal.signalAt > ENTRY_FRESHNESS_MS) return;
  if (entry && signal.source === 'FUTURES_AUTO' && now - signal.signalAt > AUTO_SIGNAL_MAX_AGE) return;
  const db = drizzle(env.DB);
  if (entry && signal.source === 'FUTURES_AUTO' && !await automationAuthorizesSignal(db, targetUserId!, signal, forcedMode!)) return;
  const candidates = targetUserId
    ? await db.select().from(users).where(eq(users.id, targetUserId)).all()
    : await db.select().from(users).all();
  const targetUsers = candidates.flatMap(user => {
    const mode = resolveFuturesExecutionMode(user, forcedMode, entry ? 'BUY' : 'SELL');
    return mode && (!entry || sourceEnabledForEntry(user, signal)) && !(entry && signal.source === 'FUTURES_AUTO' && mode === 'LIVE' && user.bitgetFuturesExecutionMode !== 'LIVE') ? [{ user, mode }] : [];
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
