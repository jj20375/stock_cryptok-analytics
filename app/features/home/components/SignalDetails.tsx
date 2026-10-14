/** @file 策略訊號明細；方向、等待與真實重放價位可讀，點選只定位圖表，不會下單。 */
import { X } from 'lucide-react';
import { chartDateFormatter } from '../../../utils/chartDate';
import { getSignalAction, SIGNAL_STRATEGIES, type SignalItem } from '../signal-display';

interface SignalDetailsProps {
  items: SignalItem[];
  timezone: string;
  selectedId: string | null;
  onSelect: (item: SignalItem) => void;
  onClose: () => void;
}

/** 明細不佔用 K 線高度；點選項目定位時間，完整原因可用鍵盤或觸控閱讀。 */
export function SignalDetails({ items, timezone, selectedId, onSelect, onClose }: SignalDetailsProps) {
  const dateFormat = chartDateFormatter(timezone);
  return <aside aria-label="策略訊號明細" className="absolute inset-0 z-30 flex flex-col overflow-hidden border-l border-slate-300 sm:static sm:w-[300px] sm:shrink-0"
    style={{ background: '#ffffff', color: '#0f172a' }}>
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <div><h3 className="text-sm font-bold">訊號明細 · {items.length} 筆</h3><p className="mt-1 text-xs text-slate-500">由新到舊 · {timezone} · 點選定位 K 線</p></div>
      <button type="button" onClick={onClose} aria-label="關閉訊號明細" className="rounded p-2 hover:bg-slate-100 focus-visible:outline-2"><X size={18} /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {items.length === 0 && <p className="p-4 text-sm text-slate-600">目前啟用的策略在此資料範圍沒有訊號。</p>}
      {items.map(item => {
        const selected = selectedId === item.id;
        return <button type="button" key={item.id} aria-pressed={selected} onClick={() => onSelect(item)}
          className="mb-2 w-full rounded-md border p-3 text-left focus-visible:outline-2 focus-visible:outline-blue-600"
          style={{ borderColor: selected ? '#2563eb' : '#e2e8f0', background: selected ? '#eff6ff' : '#ffffff' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold" style={{ color: SIGNAL_STRATEGIES[item.strategyId].color }}>{item.strategyName}</span>
            <span className="rounded px-2 py-1 text-xs font-bold" style={{ background: SIGNAL_STRATEGIES[item.strategyId].color, color: '#ffffff' }}>{getSignalAction(item)}</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">{dateFormat.format(item.timestamp)} · {item.price.toLocaleString('zh-TW', { maximumFractionDigits: 6 })}</div>
          <p className="mt-2 text-sm font-medium">{item.label}</p>
          {selected && <p className="mt-2 border-t border-blue-100 pt-2 text-sm leading-relaxed text-slate-700">{item.reason}</p>}
        </button>;
      })}
    </div>
  </aside>;
}
