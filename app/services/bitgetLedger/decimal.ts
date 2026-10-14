/** @file 帳本定點運算；18 位小數足以保留 Bitget 原始精度，統計呈現才轉 Number。 */
const SCALE = 10n ** 18n;
export function units(value: string): bigint {
  if (!/^-?\d{1,30}(\.\d{1,18})?$/.test(value)) throw new Error('交易所數值格式不正確');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, '0'))) * (negative ? -1n : 1n);
}
export function decimal(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(18, '0').replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}
export const add = (a: string, b: string) => decimal(units(a) + units(b));
export const subtract = (a: string, b: string) => decimal(units(a) - units(b));
export const multiply = (a: string, b: string) => decimal(units(a) * units(b) / SCALE);
export const divide = (a: string, b: string) => {
  if (units(b) === 0n) throw new Error('交易數量不可為零');
  return decimal(units(a) * SCALE / units(b));
};
export const sum = (values: string[]) => decimal(values.reduce((total, value) => total + units(value), 0n));

