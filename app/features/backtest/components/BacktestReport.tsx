/** @file 回測報告區分零成交與資料讀取失敗；只顯示已完成的計算結果。
 * 【詳細繁體中文註解】：回測績效報告 — KPI 卡片列
 * 沿用 dashboard 的黑白極簡卡片風格;正報酬紅色、負報酬綠色(與站內台股漲跌配色一致)。
 */

import { cn } from '../../../utils/cn';
import type { BacktestDetail } from '../types';

interface BacktestReportProps {
  detail: BacktestDetail;
}

export function BacktestReport({ detail }: BacktestReportProps) {
  const result = detail.result;
  if (!result) return null;

  // 站內配色慣例:漲(正)=紅、跌(負)=綠(台股習慣)
  const pnlColor = (value: number) => (value >= 0 ? 'text-rose-500' : 'text-emerald-600');

  const kpis: { label: string; value: string; className?: string; hint?: string }[] = [
    {
      label: '總報酬率',
      value: `${result.totalReturnPct >= 0 ? '+' : ''}${result.totalReturnPct}%`,
      className: pnlColor(result.totalReturnPct),
      hint: `期末權益 ${result.finalEquity} / 初始 ${result.initialCapital}`,
    },
    {
      label: '年化報酬 (CAGR)',
      value: `${result.cagrPct >= 0 ? '+' : ''}${result.cagrPct}%`,
      className: pnlColor(result.cagrPct),
      hint: result.durationDays < 30 ? '期間不足 30 天,參考價值低' : `回測 ${result.durationDays} 天`,
    },
    {
      label: '最大回撤',
      value: `-${result.maxDrawdownPct}%`,
      className: 'text-amber-600',
    },
    {
      label: '夏普值',
      value: `${result.sharpeRatio}`,
      hint: '無風險利率取 0',
    },
    {
      label: '勝率',
      value: result.totalTrades ? `${result.winRatePct}%` : '—',
      hint: `${result.winTrades} 勝 / ${result.lossTrades} 敗`,
    },
    {
      label: 'Profit Factor',
      value: !result.totalTrades ? '—' : result.profitFactor >= 9999 ? '∞' : `${result.profitFactor}`,
      hint: '總獲利 ÷ 總虧損',
    },
    {
      label: '交易筆數',
      value: `${result.totalTrades}`,
      hint: `平均持倉 ${result.avgHoldingBars} 根`,
    },
    {
      label: '期望值 / 筆',
      value: `${result.expectancy >= 0 ? '+' : ''}${result.expectancy}`,
      className: pnlColor(result.expectancy),
      hint: `均獲利 ${result.avgWin} / 均虧損 ${result.avgLoss}`,
    },
    {
      label: '最大連虧',
      value: `${result.maxConsecutiveLosses} 筆`,
    },
    {
      label: '總交易成本',
      value: `${result.totalFees}`,
      hint: '手續費合計(滑價已含在成交價)',
    },
  ];

  return (
    <>
    {result.totalTrades === 0 && <p role="status" className="terminal-status warn">
      回測已完成，但此區間沒有成交，不能計算勝率。請先比較 90～180 天及不同幣種；更短的區間可能完全沒有符合條件的訊號。
    </p>}
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="bg-white/80 border border-[#141414] rounded-sm p-3 flex flex-col gap-1"
          title={kpi.hint}
        >
          <span className="text-[10px] font-mono uppercase opacity-50">{kpi.label}</span>
          <span className={cn('text-lg font-mono font-bold leading-none', kpi.className)}>
            {kpi.value}
          </span>
          {kpi.hint && <span className="text-[9px] font-mono opacity-40 leading-tight">{kpi.hint}</span>}
        </div>
      ))}
    </div>
    </>
  );
}
