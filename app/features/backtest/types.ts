/** @file 回測 UI 與 API 共用資料形狀；成交限制及賣出稅率隨研究任務保存。 */
/**
 * 【詳細繁體中文註解】：回測前端型別定義
 * 與後端 api.backtest.ts 的回應結構一一對應。
 */

/** 策略中繼資料(來自 GET /api/backtest?strategies=1,不含 evaluate 函式) */
export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  markets: ('CRYPTO' | 'US' | 'TW')[];
  supportedIntervals: string[];
  requiresNextOpen?: boolean;
  supportsShort: boolean;
  futuresOnly?: boolean;
  backtestOnly?: boolean;
  defaultParams: Record<string, number>;
  paramMeta: {
    key: string;
    label: string;
    description: string;
    min?: number;
    max?: number;
    step?: number;
  }[];
}

/** 績效指標(對應 metrics.ts BacktestMetrics) */
export interface BacktestResult {
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRatePct: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  maxConsecutiveLosses: number;
  avgHoldingBars: number;
  totalFees: number;
  durationDays: number;
  futures?: ReturnType<typeof import('../../services/cryptoFutures/evaluation').buildFuturesEvaluation>;
}

/** 權益曲線單點 */
export interface EquityPoint {
  time: number;
  equity: number;
}

/** 交易明細(對應 backtest_trades 表) */
export interface BacktestTrade {
  id: number;
  side: 'LONG' | 'SHORT';
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  fee: number;
  pnl: number | null;
  pnlPct: number | null;
  holdingBars: number | null;
  entryReason: string | null;
  exitReason: string | null;
}

/** 回測詳情 */
export interface BacktestDetail {
  id: number;
  strategyId: string;
  symbol: string;
  market: 'CRYPTO' | 'US' | 'TW';
  interval: string;
  startTime: number;
  endTime: number;
  status: string;
  error: string | null;
  createdAt: string;
  params: Record<string, unknown>;
  result: BacktestResult | null;
  equityCurve: EquityPoint[] | null;
}

/** 回測列表項目 */
export interface BacktestListItem {
  id: number;
  strategyId: string;
  symbol: string;
  market: string;
  interval: string;
  startTime: number;
  endTime: number;
  status: string;
  resultJson: string | null;
  createdAt: string;
}

/** K 線(供圖表) */
export interface ChartKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 前端執行狀態機 */
export type BacktestPhase =
  | 'idle'
  | 'creating'
  | 'preparing'
  | 'running'
  | 'loading_result'
  | 'done'
  | 'error';

/** 回測表單值 */
export interface BacktestFormValues {
  market: 'CRYPTO' | 'US' | 'TW';
  symbol: string;
  strategyId: string;
  interval: string;
  /** 回測範圍(天數,由快捷鍵換算) */
  rangeDays: number;
  initialCapital: number;
  /** 手續費率 %(UI 以百分比呈現,送出時除以 100) */
  feeRatePct: number;
  sellTaxRatePct: number;
  slippageBps: number;
  fillMode: 'nextOpen' | 'close';
  maxRiskPerTradePct: number;
  maxPositionSizePct: number;
  strategyParams: Record<string, number>;
  futures?: { instrument: 'BITGET_USDT_PERP' | 'BYBIT_USDT_PERP'; leverage: number; direction: 'BOTH' | 'LONG' | 'SHORT' };
}
