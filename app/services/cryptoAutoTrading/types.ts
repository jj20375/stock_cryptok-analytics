/** @file TradingView 與站內吃大魚共用的 Bitget USDT 永續多單訊號契約。 */
import type { CryptoActivityEnv } from '../cryptoActivityPolicy';
import { drizzle } from 'drizzle-orm/d1';
import type { StrategyEntryPlan } from '../strategy/types';

export type CryptoAutoTradeSource = 'TRADINGVIEW' | 'INTERNAL' | 'SYSTEM_STOP' | 'FUTURES_AUTO';
export type CryptoAutoTradeAction = 'BUY' | 'SELL';
export type FuturesIntent = 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT';

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
  /** 新合約模組明確表達開／平與多／空；舊來源缺值仍保持開多／平多。 */
  intent?: FuturesIntent;
  strategyId?: string;
  strategyParams?: Record<string, number>;
  entryPlan?: StrategyEntryPlan;
  feeRate?: number;
  fundingBudgetRate?: number;
  /** 自動化設定版本與 USDT 名目上限；送單前須和伺服器現存授權完全相同。 */
  automationUpdatedAt?: number;
  /** true 才套用測試名目額度；缺值僅相容既有小額測試。 */
  automationTestMode?: boolean;
  /** 本人自動化授權的名目本金百分比與持倉槽位上限。 */
  automationPositionPct?: number;
  automationMaxOpenPositions?: number;
  maxNotionalUsdt?: number;
}

export const futuresSignalIntent = (signal: Pick<CryptoAutoTradeSignal, 'intent' | 'action'>): FuturesIntent => signal.intent ?? (signal.action === 'BUY' ? 'OPEN_LONG' : 'CLOSE_LONG');
export const futuresSignalIsEntry = (signal: Pick<CryptoAutoTradeSignal, 'intent' | 'action'>) => futuresSignalIntent(signal).startsWith('OPEN_');
export const futuresSignalSide = (signal: Pick<CryptoAutoTradeSignal, 'intent' | 'action'>) => futuresSignalIntent(signal).endsWith('SHORT') ? 'short' as const : 'long' as const;
export const futuresAuditIsEntry = (action: string) => ['BUY', 'OPEN_LONG', 'OPEN_SHORT'].includes(action);
export const futuresAuditIsClose = (action: string) => ['SELL', 'CLOSE_LONG', 'CLOSE_SHORT'].includes(action);

export type BitgetFuturesExecutionMode = 'DEMO' | 'LIVE';

export interface CryptoFuturesTradingEnv extends CryptoActivityEnv {
  /** 獨立開放已授權的 Demo 自動化，不能啟用舊來源或 LIVE 新倉。 */
  CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED?: string;
  CRYPTO_FUTURES_DEMO_AUTOMATION_PAUSE_REASON?: string;
  /** 正式自動化獨立開放，預設禁止；不共用 Demo 或舊雷達的新倉開關。 */
  CRYPTO_FUTURES_LIVE_AUTOMATION_ENABLED?: string;
  CRYPTO_FUTURES_LIVE_AUTOMATION_PAUSE_REASON?: string;
  /** 新設定入口必須有真正的 Session 簽名密鑰，不能使用登入模組的舊後備值。 */
  SESSION_SECRET?: string;
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
