export interface StockDataPoint {
  date: string;
  timestamp: number;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  currency: string;
  isMock: boolean;
  rsi?: number;
  emaShort?: number;
  emaLong?: number;
  ma5?: number;
  ma10?: number;
  ma20?: number;
  ma60?: number;
  ma120?: number;
  ma240?: number;
  mv5?: number;
  mv20?: number;
  k?: number;
  d?: number;
  macdDIF?: number;
  macdSignal?: number;
  macdHist?: number;
}

export type Signal = 'BUY' | 'SELL' | 'HOLD';

export type Timeframe = '15m' | '60m' | '4h' | '1d';
