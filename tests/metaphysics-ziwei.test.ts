/** @file 紫微變盤規則 ziwei-v1：干支與四化需與 iztro 逐日一致，並驗證已知日期的分數、強度與觸發規則。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { astro } from 'iztro';
import { addDays } from '../app/services/metaphysics/calendarTime';
import { MARKET_NATAL_CHARTS } from '../app/services/metaphysics/marketNatalCharts.generated';
import { currentDecadalPalace, evaluateZiweiDay, luckStemsOf, MUTAGEN_TABLE, strengthFromPoints } from '../app/services/metaphysics/ziweiTiming';

test('2020–2023 逐日（含 2020 閏四月、2023 閏二月）流年／流月／流日天干與四化和 iztro 一致', () => {
  const astrolabe = astro.bySolar('1962-2-9', 5, '男', true, 'zh-TW');
  for (let date = '2020-01-01'; date <= '2023-12-31'; date = addDays(date, 1)) {
    const horoscope = astrolabe.horoscope(date, 0);
    const stems = luckStemsOf(date);
    assert.equal(stems.流年, horoscope.yearly.heavenlyStem, `${date} 流年`);
    assert.equal(stems.流月, horoscope.monthly.heavenlyStem, `${date} 流月`);
    assert.equal(stems.流日, horoscope.daily.heavenlyStem, `${date} 流日`);
    assert.deepEqual(MUTAGEN_TABLE[stems.流日], horoscope.daily.mutagen, `${date} 四化`);
  }
});

test('台股 2026-11-09：丙年己月丁日，方向 +9、變盤點數 3、強度 1', () => {
  const result = evaluateZiweiDay('TW', '2026-11-09');
  assert.deepEqual(result.stems, { 流年: '丙', 流月: '己', 流日: '丁' });
  assert.equal(result.directionScore, 9);
  assert.equal(result.turningPoints, 3);
  assert.equal(result.turningStrength, 1);
  assert.ok(result.triggers.includes('變盤：流日忌入財帛（+2）'));
  assert.ok(result.triggers.includes('變盤：流日權入命宮（+1）'));
  assert.equal(result.ruleVersion, 'ziwei-v1');
});

test('台股 2026-11-12：流日天同忌入命宮並與流月文曲忌同宮，強度 3', () => {
  const result = evaluateZiweiDay('TW', '2026-11-12');
  assert.equal(result.directionScore, -1);
  assert.equal(result.turningPoints, 5);
  assert.equal(result.turningStrength, 3);
  assert.ok(result.triggers.includes('變盤：流日忌與流年／流月忌疊併（+2）'));
  assert.ok(result.triggers.includes('變盤：祿忌同宮於命宮（+1）'));
});

test('BTC 2026-11-09：流日巨門忌沖官祿計 -15×1.0，方向 +23、強度 0', () => {
  const result = evaluateZiweiDay('CRYPTO', '2026-11-09');
  assert.equal(result.directionScore, 23);
  assert.equal(result.turningStrength, 0);
  assert.ok(result.triggers.includes('流日巨門化忌沖官祿'));
});

test('變盤點數分級：0–2 → 0、3 → 1、4 → 2、≥5 → 3', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(strengthFromPoints), [0, 0, 0, 1, 2, 3, 3]);
});

test('大限：台股 2026 年虛歲 65 在遷移；美股超過 120 歲回傳 null', () => {
  assert.equal(currentDecadalPalace(MARKET_NATAL_CHARTS.TW, 1962, 2026)?.name, '遷移');
  assert.equal(currentDecadalPalace(MARKET_NATAL_CHARTS.US, 1792, 2026), null);
});
