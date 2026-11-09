/** @file 八字規則 bazi-v1：四柱（含子時換日、台灣舊時制、農曆閏月、時辰不明）、強弱、喜用、性格標籤、大運與運勢評分。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBaziProfile, favorOf, investorLabels, strengthOf, type BirthInput } from '../app/services/metaphysics/baziProfile';
import { currentDaYun, dailyLuckRange, flowPillarsOf, gradePillar } from '../app/services/metaphysics/baziLuck';
import { combinedHint } from '../app/services/metaphysics/combinedHint';

const base: BirthInput = { calendar: 'solar', year: 1990, month: 5, day: 20, isLeapMonth: false, hour: 23, minute: 30, hourUnknown: false, gender: 'male' };
const sample = buildBaziProfile(base);

test('1990-05-20 23:30 男：子時 23:00 換日，四柱為庚午 辛巳 丙戌 戊子', () => {
  assert.deepEqual(sample.pillars, {
    year: { stem: '庚', branch: '午' }, month: { stem: '辛', branch: '巳' },
    day: { stem: '丙', branch: '戌' }, hour: { stem: '戊', branch: '子' },
  });
  const beforeMidnight = buildBaziProfile({ ...base, hour: 22 });
  assert.deepEqual(beforeMidnight.pillars.day, { stem: '乙', branch: '酉' });
  assert.deepEqual(beforeMidnight.pillars.hour, { stem: '丁', branch: '亥' });
});

test('強弱與喜用：得令 3＋得地 2.5＋得勢 0 = 5.5 → 身強，喜財官食傷', () => {
  assert.equal(sample.strengthScore, 5.5);
  assert.equal(sample.strength, '身強');
  assert.deepEqual(sample.favorableGroups, ['財', '官殺', '食傷']);
  assert.deepEqual(sample.unfavorableGroups, ['印', '比劫']);
  assert.equal(strengthOf(5), '身強');
  assert.equal(strengthOf(2), '身弱');
  assert.equal(strengthOf(3.5), '中和');
  assert.deepEqual(favorOf('中和'), { favorable: ['財', '食傷'], unfavorable: [] });
});

test('性格標籤：偏財透干 → 機會型；食傷與財並見 → 研究型；只有正財 → 穩健型', () => {
  assert.deepEqual(sample.labels, ['機會型', '研究型']);
  const steady = investorLabels({
    year: { stem: '辛', branch: '酉' }, month: { stem: '甲', branch: '午' },
    day: { stem: '丙', branch: '寅' }, hour: { stem: '乙', branch: '未' },
  }, '中和');
  assert.deepEqual(steady, ['穩健型', '研究型']);
});

test('大運：男命順行，首步壬午 1995–2004；女命逆行首步庚辰', () => {
  assert.deepEqual(sample.daYun[0], { ganZhi: '壬午', stem: '壬', branch: '午', startYear: 1995, endYear: 2004, startAge: 6 });
  assert.equal(buildBaziProfile({ ...base, gender: 'female' }).daYun[0].ganZhi, '庚辰');
  assert.equal(currentDaYun(sample, 2026)?.ganZhi, '乙酉');
});

test('台灣日光節約：1975-06-15 09:30 修正為 08:30 辰時；1976 同時刻為巳時', () => {
  const dst = buildBaziProfile({ ...base, year: 1975, month: 6, day: 15, hour: 9 });
  assert.equal(dst.dstCorrected, true);
  assert.equal(dst.pillars.hour?.branch, '辰');
  const normal = buildBaziProfile({ ...base, year: 1976, month: 6, day: 15, hour: 9 });
  assert.equal(normal.dstCorrected, false);
  assert.equal(normal.pillars.hour?.branch, '巳');
});

test('時辰不明：只排三柱、以正午定日柱、不做時制修正', () => {
  const unknown = buildBaziProfile({ ...base, hour: 0, hourUnknown: true });
  assert.equal(unknown.pillars.hour, null);
  assert.deepEqual(unknown.pillars.day, { stem: '乙', branch: '酉' });
  assert.equal(unknown.dstCorrected, false);
  assert.equal(unknown.strength, '身弱');
});

test('農曆閏月：1990 閏五月初三 10:00 → 庚午 壬午 辛酉 癸巳', () => {
  const leap = buildBaziProfile({ ...base, calendar: 'lunar', month: 5, day: 3, isLeapMonth: true, hour: 10, minute: 0 });
  assert.deepEqual(leap.pillars, {
    year: { stem: '庚', branch: '午' }, month: { stem: '壬', branch: '午' },
    day: { stem: '辛', branch: '酉' }, hour: { stem: '癸', branch: '巳' },
  });
});

test('流年以立春換年、流月以節氣換月；2026-11-09 為丙午年己亥月丁亥日', () => {
  assert.deepEqual(flowPillarsOf('2026-11-09'), {
    year: { stem: '丙', branch: '午' }, month: { stem: '己', branch: '亥' }, day: { stem: '丁', branch: '亥' },
  });
  assert.deepEqual(flowPillarsOf('2026-02-03').year, { stem: '乙', branch: '巳' });
  assert.deepEqual(flowPillarsOf('2026-02-04').year, { stem: '丙', branch: '午' });
});

test('運勢評分：丙午流年大凶且破財風險；己亥流月大吉；壬辰日沖戌日支加註變動', () => {
  const flow = flowPillarsOf('2026-11-09');
  const year = gradePillar(sample, flow.year);
  assert.equal(year.grade5, '大凶');
  assert.deepEqual(year.flags, ['破財風險']);
  assert.equal(gradePillar(sample, flow.month).grade5, '大吉');
  const days = dailyLuckRange(sample, '2026-11-09', 12);
  assert.equal(days.length, 12);
  assert.deepEqual(days.map((d) => d.grade5).slice(0, 3), ['平', '大吉', '大吉']);
  const clashDay = days.find((d) => d.date === '2026-11-14')!;
  assert.deepEqual(clashDay.pillar, { stem: '壬', branch: '辰' });
  assert.ok(clashDay.flags.includes('變動'));
});

test('疊加提示：市場強度 ≥2 且個人凶 → 宜守；平穩且吉 → 順勢；平 → 平常心', () => {
  assert.equal(combinedHint(3, '大凶').tone, '宜守');
  assert.equal(combinedHint(2, '吉').tone, '動中有機');
  assert.equal(combinedHint(1, '大吉').tone, '順勢');
  assert.equal(combinedHint(0, '凶').tone, '少動');
  assert.equal(combinedHint(3, '平').tone, '平常心');
});
