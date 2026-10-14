/** @component 共用數字文字輸入；編輯字串與提交數值分離，顯示範圍並用原生有效性阻止錯誤提交。 */
import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { normalizeNumericText, numericBoundsHint, numericFieldError } from '../utils/numericInput';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue'> & {
  value?: string | number; defaultValue?: string | number; label?: string; error?: string | null;
  onValueChange?: (value: number) => void;
};

export function NumericInput({ value, defaultValue, label, error: extraError, onValueChange, onChange, onBlur,
  min, max, step = 'any', required = true, 'aria-describedby': describedBy, ...props }: Props) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  /** 本地字串保留空白與2.等編輯狀態；父層收到NaN代表尚未完成，不能直接當0提交。 */
  const [text, setText] = useState(() => normalizeNumericText(String(value ?? defaultValue ?? '')));
  const [touched, setTouched] = useState(false), emitted = useRef(value);
  const error = extraError || numericFieldError(text, { min, max, step, required });
  /** 只同步真正由外部重設的值；數值回寫不抹掉使用者的小數點或清空動作。 */
  useEffect(() => {
    if (value !== undefined && !Object.is(value, emitted.current)) {
      emitted.current = value; setText(Number.isNaN(value) ? '' : normalizeNumericText(String(value)));
    }
  }, [value]);
  /** text輸入不會自動套用min/max；設定原生錯誤可保護form與共用提交檢查。 */
  useEffect(() => { input.current?.setCustomValidity(error ?? ''); }, [error]);
  return <span className="flex min-w-0 flex-col">
    <input {...props} ref={input} type="text" inputMode={step === 1 || step === '1' ? 'numeric' : 'decimal'}
      min={min} max={max} step={step} required={required} value={text} data-numeric-input="true"
      aria-label={props['aria-label'] ?? label} aria-invalid={!!error}
      aria-describedby={[describedBy, `${id}-hint`, error ? `${id}-error` : ''].filter(Boolean).join(' ')}
      onInvalid={event => { setTouched(true); props.onInvalid?.(event); }}
      onChange={event => {
        const next = normalizeNumericText(event.target.value);
        event.target.value = next; setText(next); setTouched(true);
        const number = numericFieldError(next) ? NaN : Number(next);
        emitted.current = onValueChange ? number : next;
        onValueChange?.(number); onChange?.(event);
      }}
      onBlur={event => {
        setTouched(true);
        /** 自動儲存的欄位只有有效數值才觸發副作用，避免把錯誤內容寫回持股。 */
        if (!error) onBlur?.(event);
      }} />
    <span id={`${id}-hint`} className="mt-1 block text-[11px] font-normal leading-relaxed opacity-70">{numericBoundsHint({ min, max, step })}</span>
    {error && (touched || text !== '') && <span id={`${id}-error`} role="alert" className="numeric-input-error mt-1 block text-xs font-medium">{error}</span>}
  </span>;
}
