/**
 * 【詳細繁體中文註解】：回測績效指標計算
 *
 * 指標定義(全部以「已扣手續費與滑價」的淨值計算):
 *   - 總報酬率   = (期末權益 - 初始資金) / 初始資金
 *   - CAGR      = (期末/期初)^(365/回測天數) - 1(年化複合報酬)
 *   - 最大回撤   = max((波段高點 - 權益)/波段高點),單次遍歷權益曲線
 *   - 夏普值     = mean(每根報酬) / std(每根報酬) × sqrt(每年根數)
 *                 無風險利率取 0(短線策略持有期短,簡化處理;報告中註明)
 *   - 勝率       = 獲利筆數 / 總筆數
 *   - Profit Factor = 總獲利 / |總虧損|(> 1 才有正期望的粗略跡象)
 *   - 期望值     = 平均每筆淨損益
 *   - 最大連虧   = 連續虧損筆數的最大值
 */

import type { BacktestTradeRecord, EquityPoint } from './engine';

export interface BacktestMetrics {
  initialCapital: number;
  finalEquity: number;
  /** 總報酬率 % */
  totalReturnPct: number;
  /** 年化複合報酬率 %(回測期間不足 30 天時參考價值低,UI 應註明) */
  cagrPct: number;
  /** 最大回撤 % */
  maxDrawdownPct: number;
  /** 夏普值(年化,無風險利率取 0) */
  sharpeRatio: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  /** 勝率 % */
  winRatePct: number;
  profitFactor: number;
  /** 平均每筆淨損益 */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  maxConsecutiveLosses: number;
  /** 平均持倉 K 線根數 */
  avgHoldingBars: number;
  /** 手續費+滑價前的粗略總損益中,被成本吃掉的金額(總手續費) */
  totalFees: number;
  /** 回測天數 */
  durationDays: number;
}

/**
 * 計算全部績效指標。
 * @param barsPerYear 每年 K 線根數(年化因子):
 *   加密貨幣 24h 全年無休:15m=35040、1h=8760、4h=2190、1d=365
 *   美股日線:252(交易日)
 */
export const computeMetrics = (
  equityCurve: EquityPoint[],
  trades: BacktestTradeRecord[],
  initialCapital: number,
  barsPerYear: number
): BacktestMetrics => {
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital;
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

  // 回測天數(以權益曲線頭尾時間差計)
  const durationMs =
    equityCurve.length > 1 ? equityCurve[equityCurve.length - 1].time - equityCurve[0].time : 0;
  const durationDays = durationMs / (24 * 60 * 60 * 1000);

  // CAGR:期間過短(< 1 天)時直接視為 0,避免指數爆炸
  let cagrPct = 0;
  if (durationDays >= 1 && initialCapital > 0 && finalEquity > 0) {
    cagrPct = (Math.pow(finalEquity / initialCapital, 365 / durationDays) - 1) * 100;
  }

  // 最大回撤:單次遍歷
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) {
      const drawdown = ((peak - point.equity) / peak) * 100;
      if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
    }
  }

  // 夏普值:逐根權益報酬率
  let sharpeRatio = 0;
  if (equityCurve.length > 2) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      if (prev > 0) returns.push(equityCurve[i].equity / prev - 1);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    if (std > 0) sharpeRatio = (mean / std) * Math.sqrt(barsPerYear);
  }

  // 交易統計
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));

  let maxConsecutiveLosses = 0;
  let streak = 0;
  for (const t of trades) {
    if (t.pnl <= 0) {
      streak += 1;
      if (streak > maxConsecutiveLosses) maxConsecutiveLosses = streak;
    } else {
      streak = 0;
    }
  }

  return {
    initialCapital,
    finalEquity: round2(finalEquity),
    totalReturnPct: round2(totalReturnPct),
    cagrPct: round2(cagrPct),
    maxDrawdownPct: round2(maxDrawdownPct),
    sharpeRatio: round2(sharpeRatio),
    totalTrades: trades.length,
    winTrades: wins.length,
    lossTrades: losses.length,
    winRatePct: trades.length > 0 ? round2((wins.length / trades.length) * 100) : 0,
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 0,
    expectancy: trades.length > 0 ? round2((grossProfit - grossLoss) / trades.length) : 0,
    avgWin: wins.length > 0 ? round2(grossProfit / wins.length) : 0,
    avgLoss: losses.length > 0 ? round2(-grossLoss / losses.length) : 0,
    maxConsecutiveLosses,
    avgHoldingBars:
      trades.length > 0
        ? round2(trades.reduce((a, t) => a + t.holdingBars, 0) / trades.length)
        : 0,
    totalFees: round2(trades.reduce((a, t) => a + t.fee, 0)),
    durationDays: round2(durationDays),
  };
};

/**
 * 權益曲線降採樣到最多 maxPoints 點(等距取樣,頭尾必保留)。
 * 用途:15m × 2 年有 7 萬根,原樣存 D1 的 result JSON 會過大,前端畫圖也不需要這麼細。
 */
export const downsampleEquityCurve = (curve: EquityPoint[], maxPoints: number = 1000): EquityPoint[] => {
  if (curve.length <= maxPoints) return curve;
  const step = (curve.length - 1) / (maxPoints - 1);
  const sampled: EquityPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(curve[Math.round(i * step)]);
  }
  return sampled;
};

/** 四捨五入到小數 2 位(Infinity 原樣保留,JSON 序列化時由上層處理) */
const round2 = (value: number): number => {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 100) / 100;
};
