/** @file 把 iztro 星盤轉成本系統的精簡本命盤；只在產生器與測試中使用，Worker 執行期不載入 iztro。 */
import type { NatalPalace } from './types';

/** iztro FunctionalAstrolabe 中本模組用到的欄位（避免在型別上直接依賴 iztro）。 */
interface AstrolabeLike {
  palaces: Array<{ index: number; name: string; earthlyBranch: string; majorStars: Array<{ name: string }>;
    minorStars: Array<{ name: string }>; decadal: { range: number[] } }>;
}

/** 只保留主星與輔星（四化只會落在這些星上），以及大限虛歲區間。 */
export function buildNatalPalaces(astrolabe: AstrolabeLike): NatalPalace[] {
  return astrolabe.palaces.map((palace) => ({
    index: palace.index,
    name: palace.name,
    earthlyBranch: palace.earthlyBranch,
    stars: [...palace.majorStars, ...palace.minorStars].map((star) => star.name),
    decadalRange: [palace.decadal.range[0], palace.decadal.range[1]] as [number, number],
  }));
}
