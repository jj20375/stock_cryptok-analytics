/**
 * @file 紫微市場變盤時機（規則 ziwei-v1）。純函式：輸入市場與日期，輸出方向分數與變盤強度。
 * 玄學參考，非量化訊號；結果不得寫入羅盤分數、選股、下單或風控。
 */
import { Solar } from 'lunar-typescript';
import { STEMS, type Stem } from './ganzhi';
import { MARKET_NATAL_CHARTS } from './marketNatalCharts.generated';
import type { MetaMarket } from './marketChartSpecs';
import { parseIsoDate } from './calendarTime';
import { ZIWEI_RULE_VERSION, type LuckLayer, type Mutagen, type MutagenPlacement, type NatalChart, type ZiweiDayResult } from './types';

/** 天干四化表（iztro 預設派別），順序 [祿, 權, 科, 忌]；已用 iztro horoscope 做逐日比對測試。 */
export const MUTAGEN_TABLE: Record<Stem, [string, string, string, string]> = {
  甲: ['廉貞', '破軍', '武曲', '太陽'], 乙: ['天機', '天梁', '紫微', '太陰'], 丙: ['天同', '天機', '文昌', '廉貞'],
  丁: ['太陰', '天同', '天機', '巨門'], 戊: ['貪狼', '太陰', '右弼', '天機'], 己: ['武曲', '貪狼', '天梁', '文曲'],
  庚: ['太陽', '武曲', '太陰', '天同'], 辛: ['巨門', '太陽', '文曲', '文昌'], 壬: ['天梁', '紫微', '左輔', '武曲'],
  癸: ['破軍', '巨門', '太陰', '貪狼'],
};
const MUTAGENS: Mutagen[] = ['祿', '權', '科', '忌'];

/** 關鍵宮位：命宮（整體）、財帛（資金價格）、官祿（基本面）、田宅（資產庫存）、福德（情緒）、遷移（外部衝擊）。 */
const KEY_PALACES = new Set(['命宮', '財帛', '官祿', '田宅', '福德', '遷移']);
/** 層級權重：流日影響當天最直接，流月次之，流年只是背景。 */
const LAYER_WEIGHT: Record<LuckLayer, number> = { 流日: 1.0, 流月: 0.6, 流年: 0.3 };
/** 四化入關鍵宮位的基礎分；忌入對宮（沖）另計 -15。 */
const MUTAGEN_BASE: Record<Mutagen, number> = { 祿: 20, 權: 10, 科: 5, 忌: -20 };
const JI_CLASH_BASE = -15;

/**
 * 取得某國曆日的流年、流月、流日天干（與 iztro horoscope 規則一致）：
 * - 流年：農曆年干（正月初一換年）。
 * - 流月：五虎遁，以流年干與農曆月數推算；閏月 15 日以前算本月、16 日起算下個月（iztro fixLeap）。
 * - 流日：日干支的天干。
 */
export function luckStemsOf(isoDate: string): Record<LuckLayer, Stem> {
  const { year, month, day } = parseIsoDate(isoDate);
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  const yearStem = lunar.getYearGan() as Stem;
  const rawMonth = lunar.getMonth();
  const lunarMonth = rawMonth < 0 && lunar.getDay() > 15 ? Math.abs(rawMonth) + 1 : Math.abs(rawMonth);
  const monthStemIndex = ((STEMS.indexOf(yearStem) % 5) * 2 + 2 + (lunarMonth - 1)) % 10;
  return { 流年: yearStem, 流月: STEMS[monthStemIndex], 流日: lunar.getDayGan() as Stem };
}

/** 找出四化星在本命盤中的落宮；找不到（理論上不會）就略過。 */
export function placeMutagens(chart: NatalChart, stems: Record<LuckLayer, Stem>): MutagenPlacement[] {
  const placements: MutagenPlacement[] = [];
  for (const layer of ['流年', '流月', '流日'] as LuckLayer[]) {
    MUTAGEN_TABLE[stems[layer]].forEach((star, i) => {
      const palace = chart.palaces.find((p) => p.stars.includes(star));
      if (palace) placements.push({ layer, mutagen: MUTAGENS[i], star, palaceIndex: palace.index, palaceName: palace.name });
    });
  }
  return placements;
}

const oppositeIndex = (index: number) => (index + 6) % 12;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 方向分數：四化入關鍵宮位加減分，忌星不在關鍵宮但沖關鍵宮時 -15；乘上層級權重後加總。 */
export function scoreDirection(chart: NatalChart, placements: MutagenPlacement[], triggers: string[]): number {
  let total = 0;
  for (const p of placements) {
    const weight = LAYER_WEIGHT[p.layer];
    if (KEY_PALACES.has(p.palaceName)) {
      total += MUTAGEN_BASE[p.mutagen] * weight;
      triggers.push(`${p.layer}${p.star}化${p.mutagen}入${p.palaceName}`);
    } else if (p.mutagen === '忌') {
      const opposite = chart.palaces[oppositeIndex(p.palaceIndex)];
      if (KEY_PALACES.has(opposite.name)) {
        total += JI_CLASH_BASE * weight;
        triggers.push(`${p.layer}${p.star}化忌沖${opposite.name}`);
      }
    }
  }
  return clamp(Math.round(total), -100, 100);
}

/** 變盤點數（每一條規則最多計一次）。 */
export function scoreTurningPoints(chart: NatalChart, placements: MutagenPlacement[], triggers: string[]): number {
  const find = (layer: LuckLayer, mutagen: Mutagen) => placements.find((p) => p.layer === layer && p.mutagen === mutagen);
  const nameAt = (index: number) => chart.palaces[index].name;
  let points = 0;
  const dayJi = find('流日', '忌');
  if (dayJi && ['命宮', '財帛'].includes(dayJi.palaceName)) { points += 2; triggers.push(`變盤：流日忌入${dayJi.palaceName}（+2）`); }
  if (dayJi && ['命宮', '財帛'].includes(nameAt(oppositeIndex(dayJi.palaceIndex)))) {
    points += 2; triggers.push(`變盤：流日忌沖${nameAt(oppositeIndex(dayJi.palaceIndex))}（+2）`);
  }
  const otherJi = [find('流年', '忌'), find('流月', '忌')].filter((p): p is MutagenPlacement => Boolean(p));
  if (dayJi && otherJi.some((p) => p.palaceIndex === dayJi.palaceIndex)) {
    points += 2; triggers.push('變盤：流日忌與流年／流月忌疊併（+2）');
  }
  const dayLu = find('流日', '祿');
  const jiLu = [dayLu && placements.find((p) => p.mutagen === '忌' && p.palaceIndex === dayLu.palaceIndex),
    dayJi && placements.find((p) => p.mutagen === '祿' && p.palaceIndex === dayJi.palaceIndex)].find(Boolean);
  if (jiLu) { points += 1; triggers.push(`變盤：祿忌同宮於${jiLu.palaceName}（+1）`); }
  const dayQuan = find('流日', '權');
  if (dayQuan && ['命宮', '遷移'].includes(dayQuan.palaceName)) { points += 1; triggers.push(`變盤：流日權入${dayQuan.palaceName}（+1）`); }
  return points;
}

/**
 * 變盤點數 → 強度：0–2 → 0、3 → 1、4 → 2、5 以上 → 3。
 * 門檻依 2016–2025 三個市場的「觸發頻率」校準（未看任何行情），讓強度 ≥ 2 約占 8–20% 的日子；
 * 若用 1 點就算變盤，三個市場有超過一半的日子都是變盤日，標記就失去意義。
 */
export function strengthFromPoints(points: number): 0 | 1 | 2 | 3 {
  if (points <= 2) return 0;
  if (points === 3) return 1;
  if (points === 4) return 2;
  return 3;
}

/** 計算某市場某日（市場當地日期）的紫微判讀。 */
export function evaluateZiweiDay(market: MetaMarket, tradeDate: string, chart: NatalChart = MARKET_NATAL_CHARTS[market]): ZiweiDayResult {
  const stems = luckStemsOf(tradeDate);
  const placements = placeMutagens(chart, stems);
  const triggers: string[] = [];
  const directionScore = scoreDirection(chart, placements, triggers);
  const turningPoints = scoreTurningPoints(chart, placements, triggers);
  return { market, tradeDate, stems, placements, directionScore, turningPoints,
    turningStrength: strengthFromPoints(turningPoints), triggers, ruleVersion: ZIWEI_RULE_VERSION };
}

/** 目前所在大限宮位（虛歲）；市場超過 120 歲（美股）時回傳 null，頁面顯示「超出大限範圍」。 */
export function currentDecadalPalace(chart: NatalChart, birthYear: number, currentYear: number) {
  const nominalAge = currentYear - birthYear + 1;
  return chart.palaces.find((p) => nominalAge >= p.decadalRange[0] && nominalAge <= p.decadalRange[1]) ?? null;
}
