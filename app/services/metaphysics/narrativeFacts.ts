/**
 * @file 組出送給 AI 的「衍生標籤」與 AI 失敗時的模板文字（純函式）。
 * 隱私邊界：這裡只能輸出強弱、喜用分組、性格標籤、吉凶等級、四化觸發規則；
 * 不得輸出出生年月日時或四柱干支（四柱可反推出生日期）。測試會檢查這一點。
 */
import type { BaziProfile } from './baziProfile';
import type { DailyLuck, PillarLuck } from './baziLuck';
import type { ZiweiDayResult } from './types';

export interface NarrativeFacts { facts: string[]; fallback: string }

/** 觸發規則最多列出幾條：太多會稀釋 AI 解說重點，也讓模板文字過長。 */
const MAX_TRIGGERS = 6;

export function marketFacts(label: string, result: ZiweiDayResult): NarrativeFacts {
  const triggers = result.triggers.slice(0, MAX_TRIGGERS);
  return {
    facts: [`市場：${label}`, `方向分數：${result.directionScore}（-100～+100，正值偏多）`, `變盤強度：${result.turningStrength}（0–3）`, ...triggers],
    fallback: `${label}今日方向分數 ${result.directionScore}、變盤強度 ${result.turningStrength}。主要訊號：${triggers.slice(0, 3).join('；') || '無明顯四化衝擊'}。`,
  };
}

export function baziProfileFacts(profile: BaziProfile): NarrativeFacts {
  const favorable = profile.favorableGroups.join('、');
  return {
    facts: [`日主五行：${profile.dayElement}`, `日主強弱：${profile.strength}`, `喜用：${favorable}`,
      `忌：${profile.unfavorableGroups.join('、') || '無明顯忌神'}`, `投資性格：${profile.labels.join('、')}`],
    fallback: `你的日主屬${profile.dayElement}、${profile.strength}，喜${favorable}；投資性格偏${profile.labels.join('、')}。`,
  };
}

export function baziDailyFacts(today: DailyLuck, year: PillarLuck, daYun: PillarLuck | null): NarrativeFacts {
  const flags = today.flags.length > 0 ? `（${today.flags.join('、')}）` : '';
  return {
    facts: [`今日運勢：${today.grade5}${flags}`, `今年流年：${year.grade3}${year.flags.length ? `（${year.flags.join('、')}）` : ''}`,
      `目前大運：${daYun ? daYun.grade3 : '尚未起運'}`],
    fallback: `今日運勢${today.grade5}${flags}；今年流年${year.grade3}。`,
  };
}
