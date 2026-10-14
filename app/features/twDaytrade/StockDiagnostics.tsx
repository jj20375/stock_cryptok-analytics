/** @file 每檔六個做多策略與量增未破風控的資料明細；不足樣本明確呈現。 */
import type { DaytradeStockResult } from '../../services/twDaytrade/types';
import { daytradeTime } from './RankingTable';

export function DaytradeStockDiagnostics({ stocks }: { stocks: DaytradeStockResult[] }) {
  return <section className="space-y-3"><h2 className="text-xl font-bold">已掃描股票與策略明細</h2>
    {stocks.map(stock => <details key={stock.symbol} className="rounded-xl border border-current/15 p-4">
      <summary className="cursor-pointer text-sm font-semibold">{stock.symbol} {stock.name} · NT${stock.price.toFixed(2)} · {stock.bars} 根 · {daytradeTime(stock.closedAt)}
        {stock.riskWarning && <span className="ml-3 text-amber-500">量增未破警示</span>}</summary>
      <p className="mt-3 text-xs opacity-65">資料起點 {daytradeTime(stock.startTime)} · 前五個完整交易日平均成交額 NT${Math.round(stock.averageTurnover).toLocaleString()}
        · 當沖交易資格須向券商確認</p>
      {stock.riskWarning && <p className="mt-2 text-sm text-amber-500">{stock.riskWarning}</p>}
      <ul className="mt-3 space-y-3 text-sm">{stock.strategies.map(strategy => <li key={strategy.id} className="border-t border-current/10 pt-3">
        <strong>{strategy.name}</strong> · 歷史 {strategy.historical.trades} 筆 · 近期 {strategy.validation.trades} 筆／勝率 {strategy.validation.winRatePct?.toFixed(2) ?? '—'}%
        <p className="mt-1 text-xs opacity-65">{strategy.exclusions.length ? strategy.exclusions.join('；') : '回測門檻已符合'}
          {' · '}{strategy.signal ? `命中新做多：${strategy.signal.reason}` : '最新無新做多訊號'}</p>
      </li>)}</ul>
    </details>)}
  </section>;
}
