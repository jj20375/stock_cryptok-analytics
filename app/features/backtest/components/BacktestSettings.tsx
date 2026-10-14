/** @component 回測策略參數與成交設定；只更新表單，由 API 再驗證並保存研究快照。 */
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { NumericInput } from '../../../components/NumericInput';
import type { BacktestFormValues, StrategyMeta } from '../types';

import { getExecutionFields, type ExecutionSettings } from '../numeric-settings';
export { getExecutionFields, type ExecutionSettings } from '../numeric-settings';

/** 市場選擇與成本設定同屬研究假設，獨立呈現讓主表單只負責狀態與提交。 */
export function BacktestMarketPicker({ market, onChange, chipClass }: {
  market: BacktestFormValues['market']; onChange: (market: BacktestFormValues['market']) => void; chipClass: (active: boolean) => string;
}) {
  return <div className="flex flex-col gap-1">
    <span className="text-[10px] font-mono font-bold uppercase opacity-50">市場</span>
    <div className="flex gap-1">{([['CRYPTO', '加密貨幣'], ['US', '美股'], ['TW', '台股']] as const).map(([key, label]) =>
      <button key={key} type="button" aria-pressed={market === key} className={chipClass(market === key)} onClick={() => onChange(key)}>{label}</button>)}</div>
    {market === 'US' && <p className="text-[9px] font-mono opacity-40 mt-1">含虛擬幣概念股與一般大型股，可搭配支援美股的策略</p>}
  </div>;
}

export function BacktestSettings({ strategy, params, execution, market, futures, onParamChange, onExecutionChange }: {
  strategy: StrategyMeta | null; params: Record<string, number>; execution: ExecutionSettings; market: string;
  futures?: boolean; onParamChange: (key: string, value: number) => void; onExecutionChange: (change: Partial<ExecutionSettings>) => void;
}) {
  /** 額外成本欄位按需展開，切換顯示不改動已設定的交易假設。 */
  const [expanded, setExpanded] = useState(false);
  const inputClass = 'w-full border border-[#141414] bg-white px-2 py-1.5 text-xs font-mono rounded-sm focus:outline-none';
  return <>
    {strategy?.backtestOnly && <p role="status" className="border rounded p-2 text-xs">研究候選，僅回測。對照已保存的 ADA 研究請使用 89D、3x 上限、本金 1000、單邊費率 0.06%、滑價 5 bps；最新行情會使結果與固定快照不同。</p>}
    {strategy && strategy.paramMeta.length > 0 && <div className="flex flex-col gap-2">
      <span className="text-[10px] font-mono font-bold uppercase opacity-50">策略參數</span>
      <div className="grid grid-cols-2 gap-2">{strategy.paramMeta.map(meta => <label key={meta.key} className="flex flex-col gap-0.5" title={meta.description}>
        <span className="text-[10px] font-mono opacity-70">{meta.label}</span>
        <NumericInput key={`${strategy.id}:${meta.key}`} label={meta.label} className={inputClass} value={params[meta.key] ?? ''} min={meta.min} max={meta.max} step={meta.step}
          error={meta.key === 'exitAdx' && params.exitAdx <= params.adxMax ? '出場 ADX 必須大於盤整 ADX 上限' : meta.key === 'maxStopAtr' && params.maxStopAtr < params.minStopAtr ? '不可小於最小停損 ATR' : null}
          onValueChange={value => onParamChange(meta.key, value)} />
      </label>)}</div>
      {params.stopLossPct === 100 && <p role="status" className="text-xs leading-relaxed">100% 以進場幣價計算，多單停損價為0；策略出場條件仍有效。合約研究無法為此停損保留強平安全距離，會取消進場；風險倉位也可能低於最小下單額。</p>}
    </div>}
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
      className="flex items-center gap-1 text-[10px] font-mono uppercase opacity-60 hover:opacity-100">
      {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}進階設定（資金／成本／成交模式）
    </button>
    {strategy?.requiresNextOpen && <p className="text-[10px] leading-relaxed opacity-60">此策略在下一根開盤驗證追價與目標空間，固定使用下一根開盤成交。</p>}
    {expanded && <div className="grid grid-cols-2 gap-2">
      {getExecutionFields(futures).map(field => <label key={field.key} className="flex flex-col gap-0.5">
        <span className="text-[10px] font-mono opacity-70">{field.label}</span>
        <NumericInput label={field.label} className={inputClass} value={execution[field.key]} min={field.min} max={field.max} step={field.step}
          onValueChange={value => onExecutionChange({ [field.key]: value })} />
      </label>)}
      <label className="flex flex-col gap-0.5"><span className="text-[10px] font-mono opacity-70">成交模式</span>
        <select className={inputClass} value={execution.fillMode} onChange={event => onExecutionChange({ fillMode: event.target.value as 'nextOpen' | 'close' })}>
          <option value="nextOpen">下一根開盤（保守）</option>
          <option value="close" disabled={strategy?.requiresNextOpen}>訊號當根收盤（較樂觀）</option>
        </select>
      </label>
      {market === 'TW' && <p className="col-span-2 text-[10px] leading-relaxed opacity-60">台股預設一般股票賣出稅率；ETF、當沖等請依實際商品與成交類型調整。</p>}
    </div>}
  </>;
}
