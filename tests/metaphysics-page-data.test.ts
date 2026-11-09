/** @file 頁面資料組裝與 AI 隱私邊界：31 天日曆、八字視圖、送給 AI 的內容不含出生日期與四柱。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBaziView, buildMarketDays, CALENDAR_DAYS } from '../app/services/metaphysics/pageData.server';
import { baziDailyFacts, baziProfileFacts, marketFacts } from '../app/services/metaphysics/narrativeFacts';
import type { BirthInput } from '../app/services/metaphysics/baziProfile';

const birth: BirthInput = { calendar: 'solar', year: 1990, month: 5, day: 20, isLeapMonth: false, hour: 23, minute: 30, hourUnknown: false, gender: 'male' };

test('市場日曆：從今天起連續 31 天，日期遞增', () => {
  const days = buildMarketDays('TW', '2026-11-09');
  assert.equal(days.length, CALENDAR_DAYS);
  assert.equal(days[0].tradeDate, '2026-11-09');
  assert.equal(days[30].tradeDate, '2026-12-09');
});

test('八字視圖：目前大運乙酉、今日流日平、31 天流日', () => {
  const view = buildBaziView(birth, '2026-11-09');
  assert.equal(view.daYun?.ganZhi, '乙酉');
  assert.equal(view.days.length, CALENDAR_DAYS);
  assert.equal(view.days[0].grade5, '平');
  assert.equal(view.yearLuck.grade5, '大凶');
});

test('送給 AI 的八字內容不含出生年份、四柱干支', () => {
  const view = buildBaziView(birth, '2026-11-09');
  const texts = [...baziProfileFacts(view.profile).facts, ...baziDailyFacts(view.days[0], view.yearLuck, view.daYun?.luck ?? null).facts].join('\n');
  assert.equal(texts.includes('1990'), false);
  for (const pillar of Object.values(view.profile.pillars)) {
    if (pillar) assert.equal(texts.includes(`${pillar.stem}${pillar.branch}`), false, `${pillar.stem}${pillar.branch}`);
  }
});

test('市場解說資料：最多 6 條觸發規則，模板含方向分數與強度', () => {
  const [today] = buildMarketDays('TW', '2026-11-09');
  const { facts, fallback } = marketFacts('台股', today);
  assert.ok(facts.length <= 9);
  assert.match(fallback, /方向分數 9、變盤強度 1/);
});
