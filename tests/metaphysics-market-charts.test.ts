/** @file 市場本命盤常數必須與 iztro 即時排盤一致；改了出生時刻卻忘了重跑產生器時，這裡會失敗。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { astro } from 'iztro';
import { MARKET_CHART_GENDER, MARKET_CHART_SPECS } from '../app/services/metaphysics/marketChartSpecs';
import { buildNatalPalaces } from '../app/services/metaphysics/natalChartBuilder';
import { MARKET_NATAL_CHARTS } from '../app/services/metaphysics/marketNatalCharts.generated';

test('三個市場的常數本命盤與 iztro 即時排盤完全一致', () => {
  for (const spec of Object.values(MARKET_CHART_SPECS)) {
    const astrolabe = astro.bySolar(spec.solarDate, spec.timeIndex, MARKET_CHART_GENDER, true, 'zh-TW');
    assert.deepEqual(MARKET_NATAL_CHARTS[spec.market].palaces, buildNatalPalaces(astrolabe), spec.market);
  }
});

test('台股本命盤：命宮在酉、有天同；財帛在巳、有巨門；大限 65–74 在遷移', () => {
  const tw = MARKET_NATAL_CHARTS.TW;
  const ming = tw.palaces.find((p) => p.name === '命宮')!;
  const wealth = tw.palaces.find((p) => p.name === '財帛')!;
  assert.equal(ming.earthlyBranch, '酉');
  assert.ok(ming.stars.includes('天同'));
  assert.equal(wealth.earthlyBranch, '巳');
  assert.ok(wealth.stars.includes('巨門'));
  assert.deepEqual(tw.palaces.find((p) => p.name === '遷移')!.decadalRange, [65, 74]);
  assert.equal(tw.chineseDate, '壬寅 壬寅 戊寅 丁巳');
});

test('BTC 本命盤命宮在辰；美股本命盤命宮在亥', () => {
  assert.equal(MARKET_NATAL_CHARTS.CRYPTO.palaces.find((p) => p.name === '命宮')!.earthlyBranch, '辰');
  assert.equal(MARKET_NATAL_CHARTS.US.palaces.find((p) => p.name === '命宮')!.earthlyBranch, '亥');
});
