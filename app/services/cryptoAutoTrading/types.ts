/** @file TradingView 與站內吃大魚共用的 Bitget USDT 永續多單訊號契約。 */
import { drizzle } from 'drizzle-orm/d1';

export type CryptoAutoTradeSource = 'TRADINGVIEW' | 'INTERNAL' | 'SYSTEM_STOP';
export type CryptoAutoTradeAction = 'BUY' | 'SELL';

export interface CryptoAutoTradeSignal {
  /** 來源內穩定 ID；同一根 K 線重送時必須相同，供資料庫去重。 */
  id: string;
  source: CryptoAutoTradeSource;
  symbol: string;
  action: CryptoAutoTradeAction;
  /** 訊號時間為 UTC 毫秒；開倉只接受三十分鐘內的新鮮訊號。 */
  signalAt: number;
  referencePrice: number;
  label: string;
}

export type BitgetFuturesExecutionMode = 'DEMO' | 'LIVE';

export interface CryptoFuturesTradingEnv {
  DB: Parameters<typeof drizzle>[0];
  MASTER_ENCRYPTION_KEY?: string;
  SLACK_API_TOKEN?: string;
  /** Bitget Demo USDT 永續開多／平多專用頻道，避免和一般雷達訊號混在一起。 */
  CRYPTO_FUTURES_TRADE_SLACK_CHANNEL_ID?: string;
  /** 舊版虛擬幣訊號頻道，只作新專用頻道尚未設定時的相容性備援。 */
  CRYPTO_ENTRY_SLACK_CHANNEL_ID?: string;
}

/** 舊名稱僅供既有呼叫端相容；新程式請使用 CryptoFuturesTradingEnv。 */
export type CryptoDemoTradingEnv = CryptoFuturesTradingEnv;
