/** @file 虛擬幣新倉與自動掃描政策；既有多單平倉及停損不受新倉開關限制。 */
export interface CryptoActivityEnv {
  CRYPTO_NEW_ENTRIES_ENABLED?: string;
  CRYPTO_AUTO_SCAN_ENABLED?: string;
}

/** 缺設定也禁止新倉，避免手動測試或 Webhook 繞過正式部署的停用狀態。 */
export const cryptoNewEntriesAllowed = (env: CryptoActivityEnv) => env.CRYPTO_NEW_ENTRIES_ENABLED === 'true';
export const cryptoAutoScanEnabled = (env: CryptoActivityEnv) => env.CRYPTO_AUTO_SCAN_ENABLED === 'true';

/** 現貨只檢查已持有的 CRYPTO 標的；Bitget 永續由獨立合約停損處理，不能誤用現貨賣出 API。 */
type ProtectionTrade = { market: string; symbol: string; status: string; reason: string | null };
export const isCryptoSpotProtectionTrade = (trade: ProtectionTrade) =>
  trade.market === 'CRYPTO' && trade.status === 'OPEN' && !/^\[BITGET_(?:DEMO|LIVE)_AUTO:/.test(trade.reason ?? '');

export function cryptoSpotProtectionSymbols(trades: ProtectionTrade[]) {
  return [...new Set(trades.filter(isCryptoSpotProtectionTrade).map(trade => trade.symbol))];
}
