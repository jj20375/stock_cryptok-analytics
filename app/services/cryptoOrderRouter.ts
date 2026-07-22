/**
 * 【詳細繁體中文註解】：加密貨幣下單路由層
 *
 * 目的:讓 strategyEngine.ts 不需要關心「使用者選了哪個交易所」的細節 —
 * 依 user.preferredExchange 選擇呼叫 Binance 或 Bitget 的下單函式,對外提供統一介面。
 *
 * 兩個交易所的下單單位不同(Binance 買賣皆用基礎幣數量;Bitget 買單用報價幣金額、
 * 賣單用基礎幣數量),此路由層負責換算,呼叫端(strategyEngine)只需傳「基礎幣數量」與「現價」。
 *
 * PAPER 模式差異:Binance 有測試下單端點會實際呼叫 API 驗證;Bitget 沒有對應端點,
 * 因此 Bitget 路徑在 PAPER 模式下直接視為模擬成功、不呼叫外部 API(於下方函式內明確標註)。
 */

import { placeTestOrder as placeBinanceTestOrder, placeRealOrder as placeBinanceRealOrder } from './binanceService';
import { placeBitgetMarketBuy, placeBitgetMarketSell, BITGET_CRYPTO_PRECISION } from './bitgetService';

export type CryptoExchange = 'BINANCE' | 'BITGET';

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  /** 僅 Bitget 需要 */
  passphrase?: string;
}

/** 依交易所取得該幣種的下單數量精度;Binance 精度表由呼叫端傳入(沿用 strategyEngine 既有的 SYMBOL_PRECISION) */
export const getExchangeCryptoPrecision = (
  exchange: CryptoExchange,
  symbol: string,
  binancePrecisionTable: Record<string, number>
): number => {
  if (exchange === 'BITGET') return BITGET_CRYPTO_PRECISION[symbol] ?? 2;
  return binancePrecisionTable[symbol] ?? 2;
};

/**
 * 下買單(開倉)。
 * @param quantity 基礎幣數量(由 positionSizing 計算)
 * @param currentPrice 現價,用於 Bitget 買單換算報價幣金額(quantity × currentPrice)
 * @param isLive true 為真實下單、false 為模擬(PAPER)
 */
export const placeCryptoBuyOrder = async (
  exchange: CryptoExchange,
  symbol: string,
  quantity: number,
  currentPrice: number,
  isLive: boolean,
  credentials: ExchangeCredentials
): Promise<boolean> => {
  if (exchange === 'BITGET') {
    // Bitget 無測試下單端點,PAPER 模式不呼叫外部 API,直接視為模擬成功
    if (!isLive) return true;
    const notionalQuote = quantity * currentPrice;
    return placeBitgetMarketBuy(symbol, notionalQuote, credentials.apiKey, credentials.apiSecret, credentials.passphrase!);
  }

  return isLive
    ? placeBinanceRealOrder(symbol, 'BUY', quantity, credentials.apiKey, credentials.apiSecret)
    : placeBinanceTestOrder(symbol, 'BUY', quantity, credentials.apiKey, credentials.apiSecret);
};

/**
 * 下賣單(平倉)。
 * @param quantity 基礎幣數量(即原本開倉的持倉數量)
 */
export const placeCryptoSellOrder = async (
  exchange: CryptoExchange,
  symbol: string,
  quantity: number,
  isLive: boolean,
  credentials: ExchangeCredentials
): Promise<boolean> => {
  if (exchange === 'BITGET') {
    if (!isLive) return true;
    return placeBitgetMarketSell(symbol, quantity, credentials.apiKey, credentials.apiSecret, credentials.passphrase!);
  }

  return isLive
    ? placeBinanceRealOrder(symbol, 'SELL', quantity, credentials.apiKey, credentials.apiSecret)
    : placeBinanceTestOrder(symbol, 'SELL', quantity, credentials.apiKey, credentials.apiSecret);
};
