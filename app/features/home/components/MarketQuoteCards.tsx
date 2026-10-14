/** @component 首頁行情卡片；顯示原始 OHLCV 與單根價差，日期沿用圖表市場時區，沒有交易副作用。 */
import type { StockDataPoint, MarketKey } from '../types';
import { chartDateFormatter, CHART_TIMEZONE_LABELS, MARKET_CHART_TIMEZONES } from '../../../utils/chartDate';
import { cn } from '../../../utils/cn';

export function MarketQuoteCards({ latestData, currentPrice, priceChange, priceChangePercent, market, loading }: {
  latestData: StockDataPoint | null; currentPrice: number; priceChange: number; priceChangePercent: number;
  market: MarketKey; loading: boolean;
}) {
  const timezone = MARKET_CHART_TIMEZONES[market];
  /** 載入途中不把舊標的數值當作新行情；股票維持兩位小數以避免來源浮點尾數，加密貨幣最多六位。 */
  const ready = !!latestData && !loading;
  const price = (value: number) => value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: market === 'CRYPTO' ? 6 : 2 });
  const currency = ready ? latestData.currency : '';
  const cards = [
    { label: 'K 線日期', value: ready ? chartDateFormatter(timezone, false).format(latestData.timestamp) : '—', hint: CHART_TIMEZONE_LABELS[timezone] ?? timezone, color: '' },
    { label: '最新收盤價', value: ready ? price(currentPrice) : '—', hint: currency, color: ready ? (priceChange >= 0 ? 'text-rose-500' : 'text-emerald-500') : '' },
    { label: '單根漲跌', value: ready ? `${priceChange >= 0 ? '▲' : '▼'} ${price(Math.abs(priceChange))}（${Math.abs(priceChangePercent).toFixed(2)}%）` : '—', hint: '相較前一根 K 線', color: ready ? (priceChange >= 0 ? 'text-rose-500' : 'text-emerald-500') : '' },
    { label: '開盤／最高／最低', value: ready ? `${price(latestData.open)} / ${price(latestData.high)} / ${price(latestData.low)}` : '—', hint: currency, color: '' },
    { label: '成交量', value: ready ? latestData.volume.toLocaleString('zh-TW') : '—', hint: '最新一根 K 線', color: '' },
  ];
  return <section aria-label="行情摘要" className="grid grid-cols-2 gap-3 md:grid-cols-5">
    {cards.map(card => <div key={card.label} className="min-w-0 rounded border border-slate-700 bg-slate-900/80 p-4 text-slate-100">
      <div className="text-xs text-slate-400">{card.label}</div>
      <div className={cn('mt-2 break-words text-base font-bold tabular-nums', card.color)}>{card.value}</div>
      <div className="mt-1 break-words text-[10px] text-slate-500">{card.hint}</div>
    </div>)}
  </section>;
}
