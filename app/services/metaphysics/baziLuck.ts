/**
 * @file 八字運勢（規則 bazi-v1）：大運、流年、流月、流日對喜用神的生剋評分。
 * 純函式；輸出運勢等級與旗標，不包含任何標的或買賣動作。
 */
import { Solar } from 'lunar-typescript';
import { branchElement, branchesClash, elementGroup, stemElement, tenGodOf, type Branch, type Element, type Stem } from './ganzhi';
import { addDays, parseIsoDate } from './calendarTime';
import type { BaziProfile, DaYun, Pillar } from './baziProfile';

export type FiveGrade = '大吉' | '吉' | '平' | '凶' | '大凶';
export type ThreeGrade = '吉' | '平' | '凶';
export type LuckFlag = '財運佳' | '破財風險' | '變動';

export interface PillarLuck { pillar: Pillar; score: number; grade5: FiveGrade; grade3: ThreeGrade; flags: LuckFlag[] }
export interface DailyLuck extends PillarLuck { date: string }

/** 單一五行對此命局的喜忌：喜 +1、忌 -1、其他 0。 */
export function elementFavor(profile: BaziProfile, element: Element): number {
  const group = elementGroup(profile.dayElement, element);
  if (profile.favorableGroups.includes(group)) return 1;
  if (profile.unfavorableGroups.includes(group)) return -1;
  return 0;
}

const GRADE5: Record<number, FiveGrade> = { 2: '大吉', 1: '吉', 0: '平', [-1]: '凶', [-2]: '大凶' };

/**
 * 干支評分：天干五行喜忌 ＋ 地支本氣五行喜忌，範圍 -2～+2。
 * 旗標：
 * - 財運佳：干或支為財星，且日主不弱（身弱擔不起財）。
 * - 破財風險：天干為比肩或劫財（比劫奪財），且日主不弱；身弱時比劫反而是幫身。
 * - 變動：流日或流年地支沖日支（只在呼叫端傳入 natalDayBranch 時檢查）。
 */
export function gradePillar(profile: BaziProfile, pillar: Pillar, natalDayBranch?: Branch): PillarLuck {
  const stemEl = stemElement(pillar.stem), branchEl = branchElement(pillar.branch);
  const score = elementFavor(profile, stemEl) + elementFavor(profile, branchEl);
  const flags: LuckFlag[] = [];
  const notWeak = profile.strength !== '身弱';
  const isWealth = (el: Element) => elementGroup(profile.dayElement, el) === '財';
  if (notWeak && (isWealth(stemEl) || isWealth(branchEl))) flags.push('財運佳');
  const god = tenGodOf(profile.pillars.day.stem, pillar.stem);
  if (notWeak && (god === '比肩' || god === '劫財')) flags.push('破財風險');
  if (natalDayBranch && branchesClash(pillar.branch, natalDayBranch)) flags.push('變動');
  return { pillar, score, grade5: GRADE5[score], grade3: score > 0 ? '吉' : score < 0 ? '凶' : '平', flags };
}

/** 某國曆日期的流年（立春換年）、流月（節氣換月）、流日干支。 */
export function flowPillarsOf(isoDate: string): { year: Pillar; month: Pillar; day: Pillar } {
  const { year, month, day } = parseIsoDate(isoDate);
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  const p = (stem: string, branch: string): Pillar => ({ stem: stem as Stem, branch: branch as Branch });
  return {
    year: p(lunar.getYearGanByLiChun(), lunar.getYearZhiByLiChun()),
    month: p(lunar.getMonthGanExact(), lunar.getMonthZhiExact()),
    day: p(lunar.getDayGan(), lunar.getDayZhi()),
  };
}

/** 目前所在大運（依國曆年份）；尚未起運回傳 null。 */
export function currentDaYun(profile: BaziProfile, year: number): DaYun | null {
  return profile.daYun.find((d) => year >= d.startYear && year <= d.endYear) ?? null;
}

/** 從 startDate 起連續 days 天的流日吉凶（台北日期）。 */
export function dailyLuckRange(profile: BaziProfile, startDate: string, days: number): DailyLuck[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(startDate, i);
    return { date, ...gradePillar(profile, flowPillarsOf(date).day, profile.pillars.day.branch) };
  });
}
