/** @file 天干地支、五行、十神、藏干、六沖等命理基礎對照表；八字與紫微共用，純資料與純函式。 */

/** 十天干，依序；索引偶數為陽干、奇數為陰干。 */
export const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
/** 十二地支，依序（子=0）。 */
export const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;
export type Stem = typeof STEMS[number];
export type Branch = typeof BRANCHES[number];
export type Element = '木' | '火' | '土' | '金' | '水';
export type TenGod = '比肩' | '劫財' | '食神' | '傷官' | '偏財' | '正財' | '七殺' | '正官' | '偏印' | '正印';
/** 十神的五類分組，喜用神與吉凶判斷以分組為單位。 */
export type TenGodGroup = '比劫' | '食傷' | '財' | '官殺' | '印';

/** 天干五行：甲乙木、丙丁火、戊己土、庚辛金、壬癸水。 */
const STEM_ELEMENT: Record<Stem, Element> = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
/** 地支本氣五行。 */
const BRANCH_ELEMENT: Record<Branch, Element> = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
/** 地支藏干，順序固定為 [本氣, 中氣, 餘氣]；與 lunar-typescript 的 getXHideGan 一致，自行維護以利測試。 */
export const HIDDEN_STEMS: Record<Branch, Stem[]> = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'], 辰: ['戊', '乙', '癸'], 巳: ['丙', '庚', '戊'],
  午: ['丁', '己'], 未: ['己', '丁', '乙'], 申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
};
/** 五行相生：木生火、火生土、土生金、金生水、水生木。 */
const GENERATES: Record<Element, Element> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
/** 五行相剋：木剋土、土剋水、水剋火、火剋金、金剋木。 */
const CONTROLS: Record<Element, Element> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

export const stemElement = (stem: Stem): Element => STEM_ELEMENT[stem];
export const branchElement = (branch: Branch): Element => BRANCH_ELEMENT[branch];
export const isYangStem = (stem: Stem): boolean => STEMS.indexOf(stem) % 2 === 0;
export const generates = (from: Element, to: Element): boolean => GENERATES[from] === to;
export const controls = (from: Element, to: Element): boolean => CONTROLS[from] === to;

/** 以日主為基準，回傳另一個天干的十神；陰陽相同為偏（比肩、食神、偏財、七殺、偏印），不同為正。 */
export function tenGodOf(dayStem: Stem, other: Stem): TenGod {
  const me = stemElement(dayStem), it = stemElement(other);
  const same = isYangStem(dayStem) === isYangStem(other);
  if (me === it) return same ? '比肩' : '劫財';
  if (generates(me, it)) return same ? '食神' : '傷官';
  if (controls(me, it)) return same ? '偏財' : '正財';
  if (controls(it, me)) return same ? '七殺' : '正官';
  return same ? '偏印' : '正印';
}

/** 十神 → 五類分組。 */
export function tenGodGroup(god: TenGod): TenGodGroup {
  if (god === '比肩' || god === '劫財') return '比劫';
  if (god === '食神' || god === '傷官') return '食傷';
  if (god === '偏財' || god === '正財') return '財';
  if (god === '七殺' || god === '正官') return '官殺';
  return '印';
}

/** 以日主五行為基準，回傳某五行屬於哪一類（同我比劫、我生食傷、我剋財、剋我官殺、生我印）。 */
export function elementGroup(dayElement: Element, element: Element): TenGodGroup {
  if (element === dayElement) return '比劫';
  if (generates(dayElement, element)) return '食傷';
  if (controls(dayElement, element)) return '財';
  if (controls(element, dayElement)) return '官殺';
  return '印';
}

/** 地支六沖：相距 6 位即相沖（子午、丑未、寅申、卯酉、辰戌、巳亥）。 */
export const branchesClash = (a: Branch, b: Branch): boolean =>
  Math.abs(BRANCHES.indexOf(a) - BRANCHES.indexOf(b)) === 6;
