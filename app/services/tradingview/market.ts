/** @file TradingView 市場分流；無法辨識的訊號不送到任何頻道，也不交給合約引擎。 */
import { cryptoSignalSlackChannel, type CryptoSignalNotificationEnv } from '../cryptoSignalNotifications';
import { isTwStockOrEtfCode } from '../twStockRadar/securities';

export type TradingviewMarket = 'tw_stock' | 'us_stock' | 'crypto' | 'unknown';
export const tradingviewMarketLabel = (market: string) =>
  ({ tw_stock: '台股', us_stock: '美股', crypto: '虛擬幣' }[market] ?? '未知市場');

/** 台股 Webhook 同樣排除權證；支援 TWSE:2330、2330.TW 與裸代號，ETF 通知可保留。 */
export function isExcludedTradingviewSecurity(payload: Record<string, unknown>) {
  if (resolveTradingviewMarket(payload) !== 'tw_stock') return false;
  const symbol = typeof payload.symbol === 'string' ? payload.symbol.trim().toUpperCase() : '';
  return !isTwStockOrEtfCode(symbol.split(':').at(-1)!.replace(/\.(TW|TWO)$/, ''));
}

/** 優先使用明示市場；舊 Alert 可由交易所／完整代號判斷，裸美股代號須明示市場以避免猜錯。 */
export function resolveTradingviewMarket(payload: Record<string, unknown>): TradingviewMarket {
  if (typeof payload.market === 'string' && payload.market.trim()) {
    const market = payload.market.trim().toLowerCase();
    return ['tw_stock', 'us_stock', 'crypto'].includes(market) ? market as TradingviewMarket : 'unknown';
  }
  const symbol = typeof payload.symbol === 'string' ? payload.symbol.trim().toUpperCase() : '';
  const exchange = typeof payload.exchange === 'string' ? payload.exchange.trim().toUpperCase() : symbol.split(':')[0];
  if (['TWSE', 'TPEX'].includes(exchange) || /\.(TW|TWO)$/.test(symbol)) return 'tw_stock';
  if (['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'BATS'].includes(exchange)) return 'us_stock';
  if (['BINANCE', 'BYBIT', 'BITGET', 'GATEIO', 'OKX', 'COINBASE', 'KRAKEN'].includes(exchange) ||
    /(?:USDT|USDC|USD)(?:\.P)?$/.test(symbol)) return 'crypto';
  return 'unknown';
}

export interface TradingviewChannelEnv extends CryptoSignalNotificationEnv {
  TW_STOCK_SLACK_CHANNEL_ID?: string;
  US_STOCK_SLACK_CHANNEL_ID?: string;
}

/** 股票各用專屬頻道，不能 fallback 到虛擬幣或一般日報頻道。 */
export function tradingviewSlackChannel(env: TradingviewChannelEnv, market: TradingviewMarket) {
  if (market === 'tw_stock') return env.TW_STOCK_SLACK_CHANNEL_ID?.trim() || null;
  if (market === 'us_stock') return env.US_STOCK_SLACK_CHANNEL_ID?.trim() || null;
  return market === 'crypto' ? cryptoSignalSlackChannel(env) : null;
}
