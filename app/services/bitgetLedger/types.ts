/** @file 唯讀帳本資料契約；金鑰只在伺服器請求上下文中存在。 */
import type { BitgetFuturesEnvironment, BitgetFuturesAccount } from '../bitgetService';
export type Dialect = BitgetFuturesAccount['apiDialect'];
export type PositionSide = 'long' | 'short' | 'net';
export interface Credentials { apiKey: string; apiSecret: string; passphrase: string }
export interface Scope { id: string; userId: number; environment: BitgetFuturesEnvironment }
export interface Fee { coin: string; amount: string }
export interface Fill {
  exchangeId: string; orderId: string; clientOid: string | null; symbol: string;
  side: 'buy' | 'sell'; positionSide: PositionSide; effect: 'open' | 'close' | 'unknown';
  price: string; quantity: string; realizedPnl: string | null; fees: Fee[] | null; executedAt: number;
}
export interface Bill {
  exchangeId: string; symbol: string | null; coin: string; type: string;
  amount: string; balance: string | null; occurredAt: number;
}
export interface Order {
  exchangeId: string; clientOid: string | null; symbol: string; side: 'buy' | 'sell';
  positionSide: PositionSide; status: string; quantity: string; filledQuantity: string;
  averagePrice: string | null; updatedAt: number;
}
export interface Position {
  symbol: string; side: 'long' | 'short'; quantity: string; averagePrice: string;
  unrealizedPnl: string | null;
}
export interface Snapshot { positions: Position[]; observedAt: number }
export type Stream = 'orders' | 'fills' | 'bills';
export interface SyncCursor {
  start: number; end: number;
  pages: Record<Stream, { cursor: string | null; done: boolean }>;
}
export interface Attribution {
  orderId: string; source: string; label: string; referencePrice: number;
  snapshot: string | null; paperTradeId: number | null;
}
export interface Session {
  id: string; symbol: string; side: 'long' | 'short'; openTime: number; closeTime: number | null;
  quantity: string; remainingQuantity: string; averageEntry: string; averageExit: string | null;
  realizedPnl: string | null; feePnl: string | null; fundingPnl: string; netPnl: string | null;
  status: 'OPEN' | 'CLOSED'; issues: string[]; fills: Fill[]; bills: Bill[];
  strategy: string; source: string; snapshot: string | null; referencePrice: number | null;
}
