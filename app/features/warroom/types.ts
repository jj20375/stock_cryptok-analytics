/**
 * 【詳細繁體中文註解】：戰情室前端型別定義,對應 api.warroom.ts 的回應結構。
 */

export type MarketRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRASH';
export type CoinSignalType = 'LONG' | 'SHORT' | 'HOLD';

export interface CoinSignal {
  symbol: string;
  name: string;
  price?: number;
  signal?: CoinSignalType;
  reason?: string;
  stopLossPct?: number | null;
  stopLossPrice?: number | null;
  exitHint?: string;
  fundingRate?: number | null;
  nextFundingTime?: number | null;
  /** 同一現貨來源的已收盤資料；資金費率另取 Binance 永續，不混充同一商品價格。 */
  source?: string;
  barTime?: number;
  changePct?: number;
  closes?: number[];
  /** 該幣種資料查詢或評估失敗時的錯誤說明(此時其餘欄位皆為 undefined) */
  error?: string;
}

export interface WarRoomMarketRegime {
  riskLevel: MarketRiskLevel;
  allowLong: boolean;
  reason: string;
}

export interface WarRoomData {
  updatedAt: string;
  interval: string;
  strategyName: string;
  marketRegime: WarRoomMarketRegime;
  coins: CoinSignal[];
}
