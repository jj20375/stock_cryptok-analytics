import type { StockDataPoint, Timeframe } from '../../types';

export type MarketKey = 'US' | 'TW' | 'CRYPTO';

export interface StockOption {
  symbol: string;
  name: string;
}

export interface ScanResult {
  symbol: string;
  name: string;
  score: number;
  reason: string;
  aiInsight?: string;
  trend?: 'up' | 'down';
}

export interface AIStrategy {
  marketData: string;
  matchAnalysis: string;
  conclusion: string;
  actionPlan: string;
  riskWarning: string;
}

export type ScanStrategy = 'trend' | 'consecutive_volume' | 'volume_no_break' | 'daily_volume_spike';

export interface IndicatorVisibility {
  ma5: boolean;
  ma10: boolean;
  ma20: boolean;
  ma60: boolean;
  ma120: boolean;
  ema: boolean;
  volume: boolean;
  kd: boolean;
  macd: boolean;
  rsi: boolean;
}

export type StrategyOverlayId = 'big_fish' | 'extreme_reversal' | 'trend' | 'consecutive_volume' | 'volume_no_break';
export type StrategyEventType = 'ENTRY' | 'EXIT' | 'WARNING';

export interface StrategyEvent {
  timestamp: number;
  price: number;
  type: StrategyEventType;
  label: string;
  reason: string;
  icon: string;
  color?: string;
}

export interface StrategyLineSegment {
  fromTimestamp: number;
  fromPrice: number;
  toTimestamp: number;
  toPrice: number;
  color: string;
  label: string;
}

export interface StrategyOverlayLayer {
  strategyId: StrategyOverlayId;
  strategyName: string;
  shortName: string;
  color: string;
  icon: 'fish' | 'trend' | 'volume' | 'warning' | 'zap';
  events: StrategyEvent[];
  lines: StrategyLineSegment[];
}

export interface PortfolioStock {
  symbol: string;
  name: string;
  market: string;
  avgPrice?: string;
  shares?: string;
  currentPrice?: number;
}

export interface PortfolioSummary {
  totalPnL: number;
  totalROI: number;
  winRate: number;
  totalCost: number;
}

export interface TimeframeOption {
  value: Timeframe;
  label: string;
}

export type { StockDataPoint, Timeframe };
