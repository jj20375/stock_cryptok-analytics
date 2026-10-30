/** @file 合約最新收盤訊號在伺服器重算；客戶端不能提供方向、停損或倉位繞過風控。 */
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { paperTrades, cryptoAutoOrders, users } from '../../db/schema';
import { futuresCandlesPage, futuresMetadata } from './market.server';
import { getStrategy } from '../strategy/registry';
import { IndicatorCache } from '../strategy/indicatorCache';
import { futuresRegime, futuresEntryIndex, HOUR_MS } from '../strategy/futuresRegime';
import type { OpenPositionState, StrategyEntryPlan } from '../strategy/types';
import type { BitgetFuturesExecutionMode, CryptoFuturesTradingEnv } from '../cryptoAutoTrading/types';
import { automationPositionCapPct, futuresFundingHours } from './automation';
import { futuresEntryRisk, futuresLeverageForStop } from '../backtest/futures';
import { getRiskSettingsFromUser } from '../riskGuard';
import { futuresLiquidityError } from './market.server';
import { resolveFuturesEffectiveLeverage } from '../cryptoAutoTrading/engine';
import { applySlippage } from '../backtest/costs';
import type { Candle } from '../strategy/types';
import { loadLedgerCredentials } from '../bitgetLedger/credentials.server';
import { BitgetApiError, fetchBitgetFuturesAccount } from '../bitgetService';
import { fetchCrossFunds, crossEntryCheck } from './crossFunds.server';

async function snapshotCandles(symbol: string, end: number) {
  const from = end - 999 * HOUR_MS;
  const rows = new Map<number, Awaited<ReturnType<typeof futuresCandlesPage>>[number]>();
  let cursor = end;
  for (let page = 0; page < 5 && cursor >= from; page++) {
    const bars = await futuresCandlesPage(symbol, 'TRADE', from, cursor);
    if (!bars.length) break;
    bars.forEach(bar => rows.set(bar.openTime, bar)); cursor = bars[0].openTime - HOUR_MS;
  }
  return [...rows.values()].sort((a, b) => a.openTime - b.openTime);
}
export async function futuresSnapshot(env: CryptoFuturesTradingEnv, userId: number, symbol: string, strategyId: string, feeRate = 0.0006,
  options: { candles?: Candle[]; source?: 'FUTURES_AUTO'; executionMode?: BitgetFuturesExecutionMode; positionPct?: number; maxNotionalUsdt?: number } = {}) {
  const strategy = getStrategy(strategyId);
  if (!strategy?.futuresOnly) throw new Error('請選擇合約專用策略');
  if (strategy.backtestOnly) throw new Error('此研究候選僅供歷史回測，尚未開放 Demo 或正式交易');
  const end = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
  const candles = options.candles ?? await snapshotCandles(symbol, end);
  if (candles.length < 824 || candles.at(-1)!.openTime !== end) throw new Error('最新合約行情或暖機資料不足');
  const db = drizzle(env.DB);
  const mode = options.executionMode ?? 'DEMO', reasonPrefix = `[BITGET_${mode}_AUTO:`;
  const held = await db.select().from(paperTrades).where(and(eq(paperTrades.userId, userId), eq(paperTrades.symbol, symbol),
    eq(paperTrades.mode, mode === 'LIVE' ? 'LIVE' : 'PAPER'), eq(paperTrades.status, 'OPEN'), eq(paperTrades.exchange, 'BITGET'),
    like(paperTrades.reason, `${reasonPrefix}${options.source ? `${options.source}:` : ''}%`))).get();
  let position: OpenPositionState | null = null;
  /** SQL LIKE 的底線是萬用字元，仍需逐字確認來源，不能把其他來源當作本策略持倉。 */
  if (held?.reason?.startsWith(reasonPrefix) && (!options.source || held.reason.startsWith(`${reasonPrefix}${options.source}:`))) {
    const audit = await db.select().from(cryptoAutoOrders).where(and(eq(cryptoAutoOrders.userId, userId), eq(cryptoAutoOrders.paperTradeId, held.id),
      eq(cryptoAutoOrders.executionMode, mode), inArray(cryptoAutoOrders.action, ['BUY', 'OPEN_LONG', 'OPEN_SHORT']))).orderBy(desc(cryptoAutoOrders.createdAt)).get();
    const snapshot = audit?.strategySnapshotJson ? JSON.parse(audit.strategySnapshotJson) : null;
    if (snapshot?.strategyId !== strategyId) throw new Error(`此幣已有另一策略的 ${mode} 部位，請至原策略或復盤頁管理`);
    const openedAt = new Date(held.createdAt + (held.createdAt.endsWith('Z') ? '' : 'Z')).getTime();
    position = { side: held.side === 'SELL' ? 'SHORT' : 'LONG', entryPrice: Number(held.entryPrice), quantity: Number(held.amount),
      stopLossPrice: Number(held.stopLossPrice), entryTime: openedAt,
      /** 進場發生在最新未收盤小時時，以最後已知根當作零持倉時間，不能把 -1 變成索引零。 */
      entryIndex: futuresEntryIndex(candles, openedAt),
      entryPlan: snapshot?.entryPlan as StrategyEntryPlan | undefined };
  }
  const ctx = { candles, index: candles.length - 1, indicators: new IndicatorCache(candles), position, params: strategy.defaultParams };
  const metadata = await futuresMetadata(symbol), action = strategy.evaluate(ctx);
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('帳戶不存在');
  const risk = getRiskSettingsFromUser(user), leverage = resolveFuturesEffectiveLeverage(mode === 'LIVE' ? user.bitgetFuturesLiveMaxLeverage : user.bitgetDemoMaxLeverage, metadata);
  /** 自動化全倉預覽也讀本人交易所 USDT；手動 Demo 舊預覽保留研究本金。 */
  const crossMargin = options.source === 'FUTURES_AUTO';
  let capitalUsdt = risk.capitalBaseUsdt, quoteError: string | null = null;
  let funds: Awaited<ReturnType<typeof fetchCrossFunds>> | null = null;
  if (crossMargin && action.type === 'ENTRY') {
    try {
    const { credentials } = await loadLedgerCredentials(env, userId, mode);
    const account = await fetchBitgetFuturesAccount(mode, symbol, credentials.apiKey, credentials.apiSecret, credentials.passphrase);
    funds = await fetchCrossFunds(mode, symbol, account, credentials);
    capitalUsdt = funds.equityUsdt;
    } catch (error) {
      /** 金鑰／餘額失敗仍保留確認訊號，但禁止用研究本金產生可下單報價。 */
      quoteError = error instanceof BitgetApiError ? `合約資金讀取失敗（${error.code.replace(/[^0-9]/g, '').slice(0, 5)}）`
        : '合約 USDT 資金無法驗證；請先用唯讀帳戶檢查確認憑證與餘額';
    }
  }
  const positionCapPct = options.maxNotionalUsdt == null ? crossMargin ? options.positionPct ?? 5 : Math.min(risk.maxPositionSizePct, 5)
    : automationPositionCapPct(capitalUsdt, crossMargin ? options.positionPct ?? 5 : risk.maxPositionSizePct, options.maxNotionalUsdt);
  const effectiveFeeRate = Math.max(feeRate, metadata.takerFeeRate ?? 0.0006);
  let quote: { quantity: number; notionalUsdt: number; marginUsdt: number; stopLossPrice: number; targetPrice?: number; riskUsdt: number; liquidationPrice: number | null; leverage: number; leverageCap: number; blockedReason: string | null } | null = null;
  if (action.type === 'ENTRY' && !quoteError) {
    const expectedEntryPrice = applySlippage(metadata.price, action.side === 'LONG' ? 'BUY' : 'SELL', { feeRate: 0, slippageBps: 10 });
    const budget = Math.max(0, metadata.fundingRate * (action.side === 'LONG' ? 1 : -1)) * Math.ceil(futuresFundingHours(strategyId, strategy.defaultParams) / metadata.fundingInterval);
    const sizing = futuresEntryRisk(action.side, expectedEntryPrice, action.entryPlan, { feeRate: effectiveFeeRate, slippageBps: 10 },
      /** 預覽與執行共用 0.25% 風險／5% 名目上限，避免顯示比實際送單更大的倉位。 */
      capitalUsdt, Math.min(risk.maxRiskPerTradePct, 0.25), positionCapPct, metadata.precision, leverage, budget);
    if ('error' in sizing) quoteError = sizing.error;
    else {
      const quantity = Math.floor(sizing.quantity / metadata.quantityStep + 1e-9) * metadata.quantityStep;
      const notionalUsdt = quantity * expectedEntryPrice;
      const tier = metadata.tiers.find(row => notionalUsdt >= row.min && notionalUsdt <= row.max);
      const chosen = crossMargin ? (tier && tier.maxLeverage >= metadata.minLeverage
        ? { leverage: Math.floor(Math.min(leverage, tier.maxLeverage)), liquidationPrice: null }
        : { error: '合約全倉級距不足' })
        : futuresLeverageForStop(action.side, expectedEntryPrice, quantity, sizing.stopLossPrice,
          effectiveFeeRate, metadata.tiers, leverage, metadata.minLeverage);
      const effectiveLeverage = 'error' in chosen ? leverage : chosen.leverage;
      quote = { quantity, notionalUsdt, marginUsdt: notionalUsdt / effectiveLeverage, stopLossPrice: sizing.stopLossPrice, targetPrice: sizing.targetPrice,
        riskUsdt: sizing.riskUsdt * quantity / sizing.quantity, liquidationPrice: 'error' in chosen ? null : chosen.liquidationPrice, leverage: effectiveLeverage, leverageCap: leverage,
        blockedReason: quantity < metadata.minQuantity || notionalUsdt < metadata.minNotional ? '風險倉位低於合約最小下單限制'
          : 'error' in chosen ? chosen.error : (funds ? crossEntryCheck(funds, notionalUsdt, effectiveLeverage, sizing.riskUsdt * quantity / sizing.quantity, effectiveFeeRate, metadata.tiers) : null) || futuresLiquidityError(metadata, notionalUsdt, action.side) };
    }
  }
  return { symbol, strategyId, strategyName: strategy.name, strategyParams: strategy.defaultParams, state: strategyId === 'futures_big_fish' ? { phase: ctx.indicators.bigFish().direction[ctx.index] === -1 ? 'UP' as const : 'DOWN' as const, atr: ctx.indicators.atr(10)[ctx.index], adx: NaN, reason: '1H 吃大魚 Pine 條件・僅做多・無4H進場濾網' } : futuresRegime(ctx), action, position, quote, quoteError,
    signalAt: end + HOUR_MS, metadata, capitalUsdt: funds ? capitalUsdt : undefined };
}
