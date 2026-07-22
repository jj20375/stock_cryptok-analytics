/**
 * 【詳細繁體中文註解】：回測交易明細表
 * 點擊任一列會呼叫 onSelectTrade,由父層讓 K 線圖捲動定位到該筆交易的進場時間。
 */

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../../../utils/cn';
import type { BacktestTrade } from '../types';

interface TradeListTableProps {
  trades: BacktestTrade[];
  selectedTradeId: number | null;
  onSelectTrade: (trade: BacktestTrade) => void;
}

type SortKey = 'entryTime' | 'pnl' | 'pnlPct' | 'holdingBars';

const formatTime = (time: number | null) =>
  time ? new Date(time).toLocaleString('zh-TW', { hour12: false }) : '-';

export function TradeListTable({ trades, selectedTradeId, onSelectTrade }: TradeListTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('entryTime');
  const [sortDesc, setSortDesc] = useState(false);

  const sorted = [...trades].sort((a, b) => {
    const av = (a[sortKey] ?? 0) as number;
    const bv = (b[sortKey] ?? 0) as number;
    return sortDesc ? bv - av : av - bv;
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((v) => !v);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const headerCell = (label: string, key?: SortKey) => (
    <th
      className={cn(
        'px-2 py-1.5 text-left text-[10px] font-mono uppercase opacity-60 whitespace-nowrap',
        key && 'cursor-pointer select-none hover:opacity-100'
      )}
      onClick={key ? () => toggleSort(key) : undefined}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {key === sortKey && (sortDesc ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
      </span>
    </th>
  );

  return (
    <div className="bg-white/80 border border-[#141414] rounded-sm p-4 flex flex-col gap-2">
      <h3 className="text-xs font-bold font-serif">
        交易明細({trades.length} 筆)
        <span className="ml-2 text-[10px] font-mono opacity-40">點擊列可在 K 線圖上定位</span>
      </h3>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[#141414]/30">
              {headerCell('#')}
              {headerCell('方向')}
              {headerCell('進場時間', 'entryTime')}
              {headerCell('進場價')}
              {headerCell('出場價')}
              {headerCell('數量')}
              {headerCell('損益', 'pnl')}
              {headerCell('損益 %', 'pnlPct')}
              {headerCell('持倉根數', 'holdingBars')}
              {headerCell('出場原因')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((trade, index) => {
              const isLoss = (trade.pnl ?? 0) < 0;
              return (
                <tr
                  key={trade.id}
                  onClick={() => onSelectTrade(trade)}
                  className={cn(
                    'border-b border-[#141414]/10 cursor-pointer transition-colors',
                    selectedTradeId === trade.id
                      ? 'bg-[#141414] text-[#E4E3E0]'
                      : isLoss
                        ? 'bg-rose-50 hover:bg-rose-100'
                        : 'hover:bg-[#141414]/5'
                  )}
                >
                  <td className="px-2 py-1.5 opacity-50">{index + 1}</td>
                  <td className={cn('px-2 py-1.5 font-bold', trade.side === 'LONG' ? 'text-rose-500' : 'text-emerald-600', selectedTradeId === trade.id && 'text-inherit')}>
                    {trade.side === 'LONG' ? '多' : '空'}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatTime(trade.entryTime)}</td>
                  <td className="px-2 py-1.5">{trade.entryPrice.toFixed(4)}</td>
                  <td className="px-2 py-1.5">{trade.exitPrice?.toFixed(4) ?? '-'}</td>
                  <td className="px-2 py-1.5">{trade.quantity}</td>
                  <td className={cn('px-2 py-1.5 font-bold', selectedTradeId !== trade.id && ((trade.pnl ?? 0) >= 0 ? 'text-rose-500' : 'text-emerald-600'))}>
                    {trade.pnl != null ? trade.pnl.toFixed(2) : '-'}
                  </td>
                  <td className="px-2 py-1.5">{trade.pnlPct != null ? `${trade.pnlPct.toFixed(2)}%` : '-'}</td>
                  <td className="px-2 py-1.5">{trade.holdingBars ?? '-'}</td>
                  <td className="px-2 py-1.5 max-w-[240px] truncate" title={trade.exitReason ?? ''}>
                    {trade.exitReason ?? '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trades.length === 0 && (
          <p className="text-center text-[11px] font-mono opacity-40 py-6">
            本次回測期間內未觸發任何交易 — 可嘗試放寬策略參數或拉長回測範圍。
          </p>
        )}
      </div>
    </div>
  );
}
