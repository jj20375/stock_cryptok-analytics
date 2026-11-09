/** @file 生辰表單驗證（純函式）：檢查國曆／農曆日期合法、閏月存在、時分範圍。 */
import { LunarMonth } from 'lunar-typescript';
import type { BirthInput } from './baziProfile';

export type BirthParseResult = { ok: true; value: BirthInput } | { ok: false; error: string };

/** 最早可輸入年份：lunar-typescript 支援更早，但台灣時制修正表只涵蓋 1900 年以後。 */
const MIN_YEAR = 1900;

const toInt = (value: FormDataEntryValue | null): number => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

export function parseBirthForm(form: FormData, currentYear: number): BirthParseResult {
  const calendar = form.get('calendar');
  const gender = form.get('gender');
  if (calendar !== 'solar' && calendar !== 'lunar') return { ok: false, error: '請選擇國曆或農曆' };
  if (gender !== 'male' && gender !== 'female') return { ok: false, error: '請選擇性別（決定大運順行或逆行）' };
  const year = toInt(form.get('year')), month = toInt(form.get('month')), day = toInt(form.get('day'));
  if (!inRange(year, MIN_YEAR, currentYear) || !inRange(month, 1, 12) || !inRange(day, 1, 31)) {
    return { ok: false, error: `出生日期不正確（年份需介於 ${MIN_YEAR}–${currentYear}）` };
  }
  const isLeapMonth = calendar === 'lunar' && form.get('isLeapMonth') === 'on';
  if (calendar === 'solar') {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) return { ok: false, error: '國曆日期不存在' };
  } else {
    const lunarMonth = LunarMonth.fromYm(year, isLeapMonth ? -month : month);
    if (!lunarMonth) return { ok: false, error: isLeapMonth ? `農曆 ${year} 年沒有閏${month}月` : '農曆日期不正確' };
    if (day > lunarMonth.getDayCount()) return { ok: false, error: `農曆該月只有 ${lunarMonth.getDayCount()} 天` };
  }
  const hourUnknown = form.get('hourUnknown') === 'on';
  const hour = hourUnknown ? 0 : toInt(form.get('hour'));
  const minute = hourUnknown ? 0 : toInt(form.get('minute'));
  if (!hourUnknown && (!inRange(hour, 0, 23) || !inRange(minute, 0, 59))) return { ok: false, error: '出生時間不正確，或請勾選「時辰不明」' };
  return { ok: true, value: { calendar, year, month, day, isLeapMonth, hour, minute, hourUnknown, gender } };
}
