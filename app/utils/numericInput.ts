/** @file 數字文字欄位的正規化與邊界檢查；保留編輯中的小數，提交前必須完成有效數值。 */
export interface NumericBounds { min?: number | string; max?: number | string; step?: number | string; required?: boolean }

/** 沒有小數點時移除多餘前導0；0.25等小數保留，空白不轉為0。 */
export function normalizeNumericText(raw: string) {
  const text = raw.trim();
  return text.includes('.') ? text : text.replace(/^(-?)0+(?=\d)/, '$1');
}

export function numericBoundsHint({ min, max, step }: NumericBounds) {
  const range = min != null && max != null ? Number(min) === Number(max) ? `固定 ${min}` : `${min}～${max}` : min != null ? `至少 ${min}，無固定上限` : max != null ? `最多 ${max}` : '無固定上下限';
  return `允許範圍：${range}${step === 1 || step === '1' ? '；整數' : step != null && step !== 'any' ? `；步進 ${step}` : '；可輸入小數'}`;
}

export function numericFieldError(raw: string | number | undefined, bounds: NumericBounds = {}): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return bounds.required === false ? null : '請填寫數值';
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) || !Number.isFinite(Number(text))) return '請輸入有效數字';
  const value = Number(text), min = bounds.min == null ? undefined : Number(bounds.min), max = bounds.max == null ? undefined : Number(bounds.max);
  if (min != null && value < min) return `最小值為 ${min}`;
  if (max != null && value > max) return `最大值為 ${max}`;
  if (bounds.step != null && bounds.step !== 'any') {
    const step = Number(bounds.step), steps = (value - (min ?? 0)) / step;
    /** 浮點小數不以字串位數猜測；容忍運算誤差，規則與策略參數驗證相同。 */
    if (step > 0 && Math.abs(steps - Math.round(steps)) > 1e-6) return `請以 ${step} 為步進（從 ${min ?? 0} 起）`;
  }
  return null;
}

/** 非原生form的按鈕也要檢查欄位；定位首個錯誤，不把錯誤設定送到伺服器。 */
export function validateNumericInputs(root: HTMLElement | null) {
  const invalid = root?.querySelector<HTMLInputElement>('input[data-numeric-input]:invalid');
  if (!invalid) return true;
  invalid.reportValidity(); invalid.focus(); return false;
}
