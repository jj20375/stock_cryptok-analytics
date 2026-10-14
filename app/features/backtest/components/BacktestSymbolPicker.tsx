/** @component 回測標的選擇；現貨與永續提示分開，清單不等同可交易商品。 */
import type { BacktestSymbolOption } from '../constants';
interface Props {
  market: 'CRYPTO' | 'US' | 'TW'; futures: boolean; custom: boolean; input: string; symbol: string;
  symbols: BacktestSymbolOption[];
  onCustomChange: (value: boolean) => void; onInputChange: (value: string) => void; onSymbolChange: (value: string) => void;
}
export function BacktestSymbolPicker({ market, futures, custom, input, symbol, symbols, onCustomChange, onInputChange, onSymbolChange }: Props) {
  const selectClass = 'w-full border bg-white px-2 py-1.5 text-xs rounded-sm';
  return <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between"><span className="text-[10px] font-bold opacity-50">標的</span>
      <div className="flex gap-1"><button className="border px-2 py-1 text-xs" aria-pressed={!custom} onClick={() => onCustomChange(false)}>清單選擇</button>
        <button className="border px-2 py-1 text-xs" aria-pressed={custom} onClick={() => onCustomChange(true)}>自訂代號</button></div></div>
    {custom ? <><input aria-label="自訂回測代號" className={selectClass} value={input} onChange={event => onInputChange(event.target.value)}
      placeholder={market === 'CRYPTO' ? '例如 BTC 或 BTCUSDT' : market === 'TW' ? '例如 2454' : '例如 PLTR'} />
      <p className="text-[10px] opacity-60">{futures ? '需為所選交易所的 USDT 永續商品；同一次回測不混用來源。' : market === 'CRYPTO' ? '自動補 USDT 結尾，沿用現貨歷史來源。' : '輸入股票代號，查無資料會顯示錯誤。'}</p></>
      : <select aria-label="回測標的" className={selectClass} value={symbol} onChange={event => onSymbolChange(event.target.value)}>{symbols.map(item => <option key={item.symbol} value={item.symbol}>{item.name} ({item.symbol})</option>)}</select>}
  </div>;
}
