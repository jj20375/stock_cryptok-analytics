/** @file 玄學羅盤共用型別與規則版本。規則版本一改，回測與快照都要分開統計。 */
import type { Stem } from './ganzhi';
import type { MetaMarket } from './marketChartSpecs';

/** 紫微變盤規則版本；任何權重或門檻調整都必須升版。 */
export const ZIWEI_RULE_VERSION = 'ziwei-v1';
/** 八字評分規則版本。 */
export const BAZI_RULE_VERSION = 'bazi-v1';

/** 四化種類，順序與 iztro mutagen 陣列一致：[祿, 權, 科, 忌]。 */
export type Mutagen = '祿' | '權' | '科' | '忌';
/** 運限層級。 */
export type LuckLayer = '流年' | '流月' | '流日';

/** 本命盤的單一宮位（精簡版）。 */
export interface NatalPalace {
  /** iztro 宮位索引 0–11（0 為寅宮）。對宮 = (index + 6) % 12。 */
  index: number;
  /** 宮名，例如「命宮」「財帛」。 */
  name: string;
  earthlyBranch: string;
  /** 主星＋輔星名稱（繁體）；四化只會落在這些星上。 */
  stars: string[];
  /** 大限虛歲區間 [起, 迄]。 */
  decadalRange: [number, number];
}

export interface NatalChart {
  chineseDate: string;
  fiveElementsClass: string;
  palaces: NatalPalace[];
}

/** 某層運限的一個四化落宮事件。 */
export interface MutagenPlacement {
  layer: LuckLayer;
  mutagen: Mutagen;
  star: string;
  palaceIndex: number;
  palaceName: string;
}

/** 某市場某一天的紫微判讀結果。 */
export interface ZiweiDayResult {
  market: MetaMarket;
  /** 市場當地日期 YYYY-MM-DD。 */
  tradeDate: string;
  stems: Record<LuckLayer, Stem>;
  placements: MutagenPlacement[];
  /** 方向分數 -100～+100，正值偏多。 */
  directionScore: number;
  /** 變盤點數（未分級前）。 */
  turningPoints: number;
  /** 變盤強度 0–3。 */
  turningStrength: 0 | 1 | 2 | 3;
  /** 觸發的規則說明，供頁面展開與 AI 解說使用。 */
  triggers: string[];
  ruleVersion: string;
}
