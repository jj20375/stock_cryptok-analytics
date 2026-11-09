/**
 * @file 八字命局（規則 bazi-v1）：四柱、日主強弱、喜用神（扶抑法簡化版）、投資性格標籤、大運。
 * 純函式；不處理從格與調候。玄學參考，不構成投資建議。
 */
import { Lunar, Solar } from 'lunar-typescript';
import {
  HIDDEN_STEMS, branchElement, elementGroup, stemElement, tenGodGroup, tenGodOf,
  type Branch, type Element, type Stem, type TenGod, type TenGodGroup,
} from './ganzhi';
import { toTaipeiStandardTime, type WallTime } from './calendarTime';

/** 使用者輸入的生辰（加密保存的內容即此結構）。 */
export interface BirthInput {
  calendar: 'solar' | 'lunar';
  year: number;
  month: number;
  day: number;
  /** 農曆閏月；國曆時忽略。 */
  isLeapMonth: boolean;
  /** 0–23；hourUnknown 時忽略。 */
  hour: number;
  minute: number;
  hourUnknown: boolean;
  gender: 'male' | 'female';
}

export interface Pillar { stem: Stem; branch: Branch }
export type Strength = '身強' | '身弱' | '中和';
export type InvestorLabel = '機會型' | '穩健型' | '從眾型' | '研究型' | '冒險型' | '財多身弱' | '均衡型';

export interface DaYun { ganZhi: string; stem: Stem; branch: Branch; startYear: number; endYear: number; startAge: number }

export interface BaziProfile {
  pillars: { year: Pillar; month: Pillar; day: Pillar; hour: Pillar | null };
  dayElement: Element;
  strength: Strength;
  /** 日主強弱分數（得令＋得地＋得勢）。 */
  strengthScore: number;
  favorableGroups: TenGodGroup[];
  unfavorableGroups: TenGodGroup[];
  labels: InvestorLabel[];
  daYun: DaYun[];
  /** 是否套用了台灣舊日光節約時間修正。 */
  dstCorrected: boolean;
  hourUnknown: boolean;
}

/** 身強門檻：得令 3 分＋得地最多 4 分＋得勢最多 3 分，滿分 10；≥5 身強、≤2 身弱。 */
const STRONG_THRESHOLD = 5;
const WEAK_THRESHOLD = 2;
/** 時辰不明時用正午排盤：日柱不受子時換日影響，時柱則不使用。 */
const UNKNOWN_HOUR_PLACEHOLDER = 12;

/** 把輸入換成國曆牆上時間（農曆先轉國曆），再修正台灣舊日光節約時間。 */
export function toStandardSolarWallTime(input: BirthInput): { wall: WallTime; corrected: boolean } {
  const hour = input.hourUnknown ? UNKNOWN_HOUR_PLACEHOLDER : input.hour;
  const minute = input.hourUnknown ? 0 : input.minute;
  let wall: WallTime = { year: input.year, month: input.month, day: input.day, hour, minute };
  if (input.calendar === 'lunar') {
    const solar = Lunar.fromYmdHms(input.year, input.isLeapMonth ? -input.month : input.month, input.day, hour, minute, 0).getSolar();
    wall = { year: solar.getYear(), month: solar.getMonth(), day: solar.getDay(), hour, minute };
  }
  // 時辰不明時不修正：沒有可靠時間，修正 1 小時沒有意義。
  return input.hourUnknown ? { wall, corrected: false } : toTaipeiStandardTime(wall);
}

const isSupport = (group: TenGodGroup) => group === '比劫' || group === '印';

/** 日主強弱：得令（月支五行同我或生我 +3）＋得地（地支本氣助身 +1、僅中餘氣助身 +0.5）＋得勢（其他天干助身各 +1）。 */
export function scoreStrength(pillars: BaziProfile['pillars']): number {
  const dayStem = pillars.day.stem;
  const dayEl = stemElement(dayStem);
  const monthGroup = elementGroup(dayEl, branchElement(pillars.month.branch));
  let score = isSupport(monthGroup) ? 3 : 0;
  const branches = [pillars.year.branch, pillars.month.branch, pillars.day.branch, pillars.hour?.branch].filter((b): b is Branch => Boolean(b));
  for (const branch of branches) {
    const [main, ...rest] = HIDDEN_STEMS[branch];
    if (isSupport(tenGodGroup(tenGodOf(dayStem, main)))) score += 1;
    else if (rest.some((stem) => isSupport(tenGodGroup(tenGodOf(dayStem, stem))))) score += 0.5;
  }
  const otherStems = [pillars.year.stem, pillars.month.stem, pillars.hour?.stem].filter((s): s is Stem => Boolean(s));
  score += otherStems.filter((stem) => isSupport(tenGodGroup(tenGodOf(dayStem, stem)))).length;
  return score;
}

export function strengthOf(score: number): Strength {
  if (score >= STRONG_THRESHOLD) return '身強';
  if (score <= WEAK_THRESHOLD) return '身弱';
  return '中和';
}

/** 扶抑法簡化版：身弱喜印比、忌財官食傷；身強喜財官食傷、忌印比；中和喜財與食傷、無明顯忌神。 */
export function favorOf(strength: Strength): { favorable: TenGodGroup[]; unfavorable: TenGodGroup[] } {
  if (strength === '身弱') return { favorable: ['印', '比劫'], unfavorable: ['財', '官殺', '食傷'] };
  if (strength === '身強') return { favorable: ['財', '官殺', '食傷'], unfavorable: ['印', '比劫'] };
  return { favorable: ['財', '食傷'], unfavorable: [] };
}

/** 投資性格標籤：以「透干的三個天干（不含日干）＋地支本氣」的十神出現次數判斷。 */
export function investorLabels(pillars: BaziProfile['pillars'], strength: Strength): InvestorLabel[] {
  const dayStem = pillars.day.stem;
  const visibleStems = [pillars.year.stem, pillars.month.stem, pillars.hour?.stem].filter((s): s is Stem => Boolean(s));
  const branchMains = [pillars.year.branch, pillars.month.branch, pillars.day.branch, pillars.hour?.branch]
    .filter((b): b is Branch => Boolean(b)).map((b) => HIDDEN_STEMS[b][0]);
  const visibleGods = visibleStems.map((s) => tenGodOf(dayStem, s));
  const allGods: TenGod[] = [...visibleGods, ...branchMains.map((s) => tenGodOf(dayStem, s))];
  const count = (pred: (g: TenGod) => boolean) => allGods.filter(pred).length;
  const wealth = count((g) => tenGodGroup(g) === '財');
  const labels: InvestorLabel[] = [];
  if (visibleGods.includes('偏財') || count((g) => g === '偏財') >= 2) labels.push('機會型');
  if (count((g) => g === '正財') >= 1 && count((g) => g === '偏財') === 0) labels.push('穩健型');
  if (count((g) => tenGodGroup(g) === '比劫') >= 3) labels.push('從眾型');
  if (count((g) => tenGodGroup(g) === '食傷') >= 1 && wealth >= 1) labels.push('研究型');
  if (visibleGods.includes('七殺')) labels.push('冒險型');
  if (strength === '身弱' && wealth >= 3) labels.push('財多身弱');
  return labels.length > 0 ? labels : ['均衡型'];
}

/** 由生辰排出完整命局。子時以 23:00 換日（lunar-typescript sect 1）。 */
export function buildBaziProfile(input: BirthInput): BaziProfile {
  const { wall, corrected } = toStandardSolarWallTime(input);
  const solar = Solar.fromYmdHms(wall.year, wall.month, wall.day, wall.hour, wall.minute, 0);
  const eightChar = solar.getLunar().getEightChar();
  eightChar.setSect(1);
  const pillar = (stem: string, branch: string): Pillar => ({ stem: stem as Stem, branch: branch as Branch });
  const pillars: BaziProfile['pillars'] = {
    year: pillar(eightChar.getYearGan(), eightChar.getYearZhi()),
    month: pillar(eightChar.getMonthGan(), eightChar.getMonthZhi()),
    day: pillar(eightChar.getDayGan(), eightChar.getDayZhi()),
    hour: input.hourUnknown ? null : pillar(eightChar.getTimeGan(), eightChar.getTimeZhi()),
  };
  const strengthScore = scoreStrength(pillars);
  const strength = strengthOf(strengthScore);
  const { favorable, unfavorable } = favorOf(strength);
  // 大運第 0 筆是起運前（干支為空字串），不列入。
  const daYun = eightChar.getYun(input.gender === 'male' ? 1 : 0).getDaYun()
    .filter((d) => d.getGanZhi() !== '')
    .map((d) => ({ ganZhi: d.getGanZhi(), stem: d.getGanZhi()[0] as Stem, branch: d.getGanZhi()[1] as Branch,
      startYear: d.getStartYear(), endYear: d.getEndYear(), startAge: d.getStartAge() }));
  return { pillars, dayElement: stemElement(pillars.day.stem), strength, strengthScore, favorableGroups: favorable,
    unfavorableGroups: unfavorable, labels: investorLabels(pillars, strength), daYun, dstCorrected: corrected, hourUnknown: input.hourUnknown };
}
