/** @file Bitget Demo／LIVE USDT 永續停損備援；原生停損之外每五分鐘檢查 Mark Price。 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { paperTrades, users } from '../../db/schema';
import { fetchBitgetFuturesMarkPrice } from '../bitgetService';
import { processCryptoFuturesSignal, resolveFuturesExecutionMode } from './engine';
import type { BitgetFuturesExecutionMode, CryptoAutoTradeSource, CryptoFuturesTradingEnv } from './types';
import { futuresProtectionReason } from '../cryptoFutures/protection.server';

const MAX_POSITIONS_PER_TICK = 8;

export async function runCryptoFuturesStopMonitor(env: CryptoFuturesTradingEnv, scope?: { mode: BitgetFuturesExecutionMode; source?: CryptoAutoTradeSource }) {
  const db = drizzle(env.DB);
  const allUsers = await db.select().from(users).all();
  let inspected = 0;
  for (const user of allUsers) {
    /** 雲端維持兩種環境；本機呼叫明確限制 Demo，避免保護程序意外使用正式憑證。 */
    for (const mode of scope ? [scope.mode] : ['DEMO', 'LIVE'] as BitgetFuturesExecutionMode[]) {
      /** 平倉不受新倉開關限制；只要對應憑證仍在，就繼續保護既有持倉。 */
      if (resolveFuturesExecutionMode(user, mode, 'SELL') !== mode) continue;
      const recordMode = mode === 'LIVE' ? 'LIVE' : 'PAPER';
      const reasonPrefix = mode === 'LIVE' ? '[BITGET_LIVE_AUTO:' : '[BITGET_DEMO_AUTO:';
      const openTrades = await db.select().from(paperTrades).where(and(
        eq(paperTrades.userId, user.id), eq(paperTrades.market, 'CRYPTO'),
        eq(paperTrades.exchange, 'BITGET'), eq(paperTrades.mode, recordMode), eq(paperTrades.status, 'OPEN'),
      )).all();
      for (const trade of openTrades) {
        if (!trade.reason?.startsWith(reasonPrefix) || !trade.stopLossPrice) continue;
        if (scope?.source && !trade.reason.startsWith(`${reasonPrefix}${scope.source}:`)) continue;
        if (++inspected > MAX_POSITIONS_PER_TICK) return;
        try {
          const price = await fetchBitgetFuturesMarkPrice(trade.symbol);
          const stopLossPrice = Number(trade.stopLossPrice);
          const short = trade.side === 'SELL';
          const protectionReason = Number.isFinite(stopLossPrice) && (short ? price >= stopLossPrice : price <= stopLossPrice)
            ? `五分鐘停損 ${stopLossPrice}` : await futuresProtectionReason(env, trade, price);
          if (protectionReason) {
            /** 每五分鐘一個事件 ID；Flash Close 只平多，失敗時下一輪用新事件重試。 */
            await processCryptoFuturesSignal(env, {
              id: `stop:${mode}:${trade.id}:${Math.floor(Date.now() / 300_000)}`,
              source: 'SYSTEM_STOP', symbol: trade.symbol, action: short ? 'BUY' : 'SELL', intent: short ? 'CLOSE_SHORT' : 'CLOSE_LONG',
              signalAt: Date.now(), referencePrice: price, label: protectionReason,
            }, user.id, mode);
          }
        } catch {
          console.warn(`[Bitget ${mode} Stop] ${trade.symbol} 暫時無法檢查，留待下輪重試`);
        }
      }
    }
  }
}

/** 舊名稱保留給尚未同步更新的排程入口。 */
export const runCryptoDemoStopMonitor = runCryptoFuturesStopMonitor;
