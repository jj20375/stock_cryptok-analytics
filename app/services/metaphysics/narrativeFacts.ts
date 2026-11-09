/**
 * @file 組出送給 AI 的「衍生標籤」與 AI 失敗時的模板文字（純函式）。
 * 隱私邊界：這裡只能輸出強弱、喜用分組、性格標籤、吉凶等級、四化觸發規則；
 * 不得輸出出生年月日時或四柱干支（四柱可反推出生日期）。測試會檢查這一點。
 */
import type { BaziProfile } from './baziProfile';
import type { DailyLuck, PillarLuck } from './baziLuck';
import { DIRECTION_CALL_THRESHOLD } from './hitRate';
import type { ZiweiDayResult } from './types';

export interface NarrativeFacts { facts: string[]; fallback: string }

/** 觸發規則最多列出幾條：太多會稀釋 AI 解說重點，也讓模板文字過長。 */
const MAX_TRIGGERS = 6;

/**
 * 方向分數的文字標籤，與頁面日曆、命中率統計共用同一門檻（|分數| ≥ 30 才算表態）。
 * 必須明確寫給 AI：只寫「正值偏多」時，AI 會把 +9 這種中性分數解說成偏多，與頁面標示矛盾。
 */
function directionLabel(score: number): '偏多' | '偏空' | '中性' {
  if (score >= DIRECTION_CALL_THRESHOLD) return '偏多';
  if (score <= -DIRECTION_CALL_THRESHOLD) return '偏空';
  return '中性';
}

export function marketFacts(label: string, result: ZiweiDayResult): NarrativeFacts {
  const triggers = result.triggers.slice(0, MAX_TRIGGERS);
  const direction = directionLabel(result.directionScore);
  return {
    facts: [`市場：${label}`,
      `方向分數：${result.directionScore}（${direction}；範圍 -100～+100，絕對值 ≥ ${DIRECTION_CALL_THRESHOLD} 才算偏多或偏空）`,
      `變盤強度：${result.turningStrength}（0–3）`, ...triggers],
    fallback: `${label}今日方向分數 ${result.directionScore}（${direction}）、變盤強度 ${result.turningStrength}。主要訊號：${triggers.slice(0, 3).join('；') || '無明顯四化衝擊'}。`,
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
