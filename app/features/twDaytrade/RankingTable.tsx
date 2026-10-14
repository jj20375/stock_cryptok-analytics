/** @file 當沖排行：以近期驗證勝率排序，顯示樣本量與淨期望，不把策略分數稱作勝率。 */
import type { DaytradeRankRow } from '../../services/twDaytrade/types';

export const daytradeTime = (time: number) => new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(time);
const percent = (value: number | null) => value == null ? '—' : `${value.toFixed(2)}%`;
const price = (value: number | null) => value == null ? '—' : `NT$${value.toFixed(2)}`;

export function DaytradeRankingTable({ rows, current }: { rows: DaytradeRankRow[]; current: boolean }) {
  if (!rows.length) return <p className="rounded-xl border border-dashed border-current/20 p-6 text-sm opacity-70">
    {current ? '目前沒有同時符合新鮮做多訊號、最低回測筆數及正淨期望的股票，等待下一根 15 分 K。' : '目前沒有達到最低樣本量與正淨期望的策略；可在下方查看每檔不足原因。'}</p>;
  return <div className="overflow-x-auto rounded-xl border border-current/15"><table className="w-full min-w-[1000px] text-left text-sm">
    <caption className="sr-only">{current ? '目前符合的當沖做多前十名' : '歷史當沖研究前十名'}</caption>
    <thead className="bg-white/5"><tr>{['名次／股票', '代表策略', '近期驗證勝率', '歷史勝率', '每筆平均淨報酬', '參考價／預估停損', '最新收盤／訊號'].map(label => <th key={label} scope="col" className="p-4 font-medium">{label}</th>)}</tr></thead>
    <tbody>{rows.map(({ stock, strategy, matchedStrategies }, index) => <tr key={stock.symbol} className="border-t border-current/10 align-top">
      <td className="p-4"><span className="mr-2 opacity-50">{index + 1}</span><strong>{stock.name}</strong><p className="mt-1 text-xs opacity-60">{stock.symbol}</p></td>
      <td className="p-4">{strategy.name}<p className="mt-1 text-xs opacity-60">{strategy.adapted ? '日線公式改以 15 分 K 研究' : '原生支援 15 分 K'}</p>
        {matchedStrategies.length > 1 && <p className="mt-2 text-xs">同步命中：{matchedStrategies.join('、')}</p>}</td>
      <td className="p-4"><strong className="text-lg">{percent(strategy.validation.winRatePct)}</strong><p className="mt-1 text-xs opacity-60">{strategy.validation.wins} 勝／{strategy.validation.trades} 筆 · {daytradeTime(strategy.validationStart)} 起</p></td>
      <td className="p-4">{percent(strategy.historical.winRatePct)}<p className="mt-1 text-xs opacity-60">{strategy.historical.wins} 勝／{strategy.historical.trades} 筆</p></td>
      <td className="p-4">{percent(strategy.validation.averageNetReturnPct)}<p className="mt-1 text-xs opacity-60">近期驗證，已扣全部成本</p></td>
      <td className="p-4">{price(strategy.signal?.referencePrice ?? stock.price)}<p className="mt-1 text-xs opacity-60">停損 {price(strategy.signal?.stopPrice ?? null)}</p>{strategy.signal?.targetPrice != null && <p className="text-xs opacity-60">目標 {price(strategy.signal.targetPrice)}</p>}</td>
      <td className="max-w-xs p-4"><p className="text-xs opacity-60">{daytradeTime(stock.closedAt)}（台北）</p>
        <p className="mt-2">{strategy.signal?.reason ?? '最新沒有新做多進場訊號'}</p>
        {!stock.fresh && <p className="mt-2 text-xs text-amber-500">休市、已過進場時間或行情延遲；僅供研究</p>}
        {stock.riskWarning && <p className="mt-2 text-xs text-amber-500">量增未破：排除當前候選</p>}</td>
    </tr>)}</tbody>
  </table></div>;
}
