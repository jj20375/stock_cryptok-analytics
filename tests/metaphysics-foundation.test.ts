/** @file 命理基礎表與時間換算：十神、六沖、台灣舊時制修正、時區日期。純函式測試，不連網路與資料庫。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchesClash, elementGroup, tenGodGroup, tenGodOf } from '../app/services/metaphysics/ganzhi';
import { addDays, localDateOf, toTaipeiStandardTime } from '../app/services/metaphysics/calendarTime';

test('十神：以丙火日主為例，五類十神陰陽正偏都正確', () => {
  assert.equal(tenGodOf('丙', '丙'), '比肩');
  assert.equal(tenGodOf('丙', '丁'), '劫財');
  assert.equal(tenGodOf('丙', '戊'), '食神');
  assert.equal(tenGodOf('丙', '己'), '傷官');
  assert.equal(tenGodOf('丙', '庚'), '偏財');
  assert.equal(tenGodOf('丙', '辛'), '正財');
  assert.equal(tenGodOf('丙', '壬'), '七殺');
  assert.equal(tenGodOf('丙', '癸'), '正官');
  assert.equal(tenGodOf('丙', '甲'), '偏印');
  assert.equal(tenGodOf('丙', '乙'), '正印');
  assert.equal(tenGodGroup('傷官'), '食傷');
  assert.equal(elementGroup('火', '金'), '財');
  assert.equal(elementGroup('火', '木'), '印');
});

test('六沖：子午、巳亥相沖，子丑不沖', () => {
  assert.equal(branchesClash('子', '午'), true);
  assert.equal(branchesClash('亥', '巳'), true);
  assert.equal(branchesClash('子', '丑'), false);
});

test('台灣舊時制：1975 夏季減 1 小時並可跨日，冬季與 1976 不修正，日治 UTC+9 也修正', () => {
  assert.deepEqual(toTaipeiStandardTime({ year: 1975, month: 6, day: 15, hour: 0, minute: 30 }),
    { wall: { year: 1975, month: 6, day: 14, hour: 23, minute: 30 }, corrected: true });
  assert.equal(toTaipeiStandardTime({ year: 1975, month: 12, day: 15, hour: 0, minute: 30 }).corrected, false);
  assert.equal(toTaipeiStandardTime({ year: 1976, month: 6, day: 15, hour: 9, minute: 30 }).corrected, false);
  assert.deepEqual(toTaipeiStandardTime({ year: 1940, month: 1, day: 1, hour: 12, minute: 0 }).wall,
    { year: 1940, month: 1, day: 1, hour: 11, minute: 0 });
});

test('時區日期：同一瞬間在台北與紐約是不同日期；日期加減跨月', () => {
  const instant = Date.UTC(2026, 10, 9, 1, 0); // 2026-11-09 01:00 UTC
  assert.equal(localDateOf(instant, 'Asia/Taipei'), '2026-11-09');
  assert.equal(localDateOf(instant, 'America/New_York'), '2026-11-08');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
