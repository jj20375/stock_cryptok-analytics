/**
 * @file 產生三個市場的紫微本命盤常數檔 `app/services/metaphysics/marketNatalCharts.generated.ts`。
 * 為什麼預先產生：iztro 單次排運限約 5ms，頁面一次要算 3 市場 × 31 天，Worker CPU 吃不消；
 * 本命盤固定不變，預先算好星曜落宮，執行期只需查表＋lunar 算干支（每天約 0.01ms）。
 * 執行：node --import tsx scripts/metaphysics/generate-market-charts.ts
 */
import { writeFileSync } from 'node:fs';
import { astro } from 'iztro';
import { MARKET_CHART_GENDER, MARKET_CHART_SPECS } from '../../app/services/metaphysics/marketChartSpecs';
import { buildNatalPalaces } from '../../app/services/metaphysics/natalChartBuilder';

const OUTPUT_PATH = 'app/services/metaphysics/marketNatalCharts.generated.ts';

const charts = Object.fromEntries(Object.values(MARKET_CHART_SPECS).map((spec) => {
  // fixLeap=true：閏月前半算上個月、後半算下個月，與 iztro 預設一致。
  const astrolabe = astro.bySolar(spec.solarDate, spec.timeIndex, MARKET_CHART_GENDER, true, 'zh-TW');
  return [spec.market, { chineseDate: astrolabe.chineseDate, fiveElementsClass: astrolabe.fiveElementsClass,
    palaces: buildNatalPalaces(astrolabe) }];
}));

const body = `/** @file 由 scripts/metaphysics/generate-market-charts.ts 自動產生，請勿手動修改。 */
import type { NatalChart } from './types';
import type { MetaMarket } from './marketChartSpecs';

export const MARKET_NATAL_CHARTS: Record<MetaMarket, NatalChart> = ${JSON.stringify(charts, null, 2)};
`;
writeFileSync(OUTPUT_PATH, body);
console.log(`已產生 ${OUTPUT_PATH}`);
