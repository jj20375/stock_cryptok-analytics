/** @file 直接檢查已安裝 Vela 的日期程式碼，涵蓋時間軸、游標、跨日時區與升級保護。 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { localizeVelaDates } from '../dev/velaDates';
import { chartDateFormatter } from '../app/utils/chartDate';

const dist = 'node_modules/@luxalgo/vela/dist';
const renderer = readdirSync(dist).filter(file => file.startsWith('chunk-') && file.endsWith('.js'))
  .map(file => readFileSync(`${dist}/${file}`, 'utf8')).find(source => source.includes('function formatTimeStamp('));
assert.ok(renderer, '找不到 Vela 原生日期渲染器');
const translated = localizeVelaDates(renderer);
// 使用套件自己的時區與刻度函式，避免只檢查翻譯字串卻漏掉 UTC 與台北跨日。
const dateCode = translated.slice(translated.indexOf('function tzOffsetMs('), translated.indexOf('// src/renderers/native/chrome/countdown.ts'));
const native = vm.runInNewContext(`${dateCode}; ({formatTimeStamp, timeTicks, calendarTicks})`);
const stamp = Date.parse('2026-10-07T16:30:00Z');
assert.equal(native.formatTimeStamp(stamp, 'Asia/Taipei', 3_600_000), '2026年10月8日（週四） 00:30');
assert.equal(native.formatTimeStamp(stamp, 'UTC', 86_400_000), '2026年10月7日（週三）');
assert.equal(native.formatTimeStamp(stamp, 'America/New_York', 3_600_000), '2026年10月7日（週三） 12:30');
const ticks = native.timeTicks(Date.parse('2026-10-07'), Date.parse('2026-10-09'), 2);
assert.equal(ticks[0].label, '10月7日');
assert.equal(ticks[0].time, Date.parse('2026-10-07'));
assert.equal(native.calendarTicks(Date.parse('2026-01-01'), Date.parse('2027-01-01'), 12, 0)[0].label, '2026年');
assert.match(chartDateFormatter('Asia/Taipei').format(stamp), /2026年10月8日.*週四.*00:30/);
assert.match(chartDateFormatter('UTC', false).format(stamp), /2026年10月7日.*週三/);
assert.equal(localizeVelaDates('export const unchanged = 1;'), 'export const unchanged = 1;');
assert.throws(() => localizeVelaDates(renderer.replace('"Jan"', '"January"')), /日期格式已變更/);
console.log('繁體中文日期、時區與 Vela 格式升級保護檢查通過');
