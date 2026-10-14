/** @file 以同一條 D1 寫入原子保留持倉槽，重疊排程也不能超過本人授權的三筆上限。 */
import type { CryptoFuturesTradingEnv } from '../cryptoAutoTrading/types';
export async function reserveCrossTrade(env: CryptoFuturesTradingEnv, values: {
  userId: number; mode: 'PAPER' | 'LIVE'; symbol: string; side: 'BUY' | 'SELL'; ledgerAccountId: string;
  entryPrice: string; amount: string; stopLossPrice: string; reason: string; maxOpenPositions: number;
}) {
  if (!Number.isInteger(values.maxOpenPositions) || values.maxOpenPositions < 1 || values.maxOpenPositions > 3) throw new Error('合約持倉上限無效');
  /** OPEN 包含尚待成交／UNKNOWN 的預留；未知委託不可釋放名額或盲目重送。 */
  return env.DB.prepare(`INSERT INTO paper_trades
    (user_id,mode,market,exchange,symbol,side,status,ledger_account_id,reconciliation_status,entry_price,amount,stop_loss_price,reason)
    SELECT ?,?,'CRYPTO','BITGET',?,?,'OPEN',?,'PENDING',?,?,?,?
    WHERE (SELECT COUNT(*) FROM paper_trades WHERE user_id=? AND mode=? AND market='CRYPTO' AND status='OPEN') < ?
    RETURNING id`).bind(values.userId, values.mode, values.symbol, values.side, values.ledgerAccountId,
      values.entryPrice, values.amount, values.stopLossPrice, values.reason, values.userId, values.mode, values.maxOpenPositions).first<{ id: number }>();
}
