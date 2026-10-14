/** @file 確認批次路徑保留趨勢斷點、同根訊號，以及獨立圖表的註冊清理。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getNativeIndicator } from '@luxalgo/vela/plugin';
import { buildStrategyOutput, createStrategyOverlay } from '../app/features/home/vela-strategy-overlay';
import type { StrategyOverlayLayer } from '../app/features/home/types';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import type { NativeIndicatorContext, NativeIndicatorOutput } from '@luxalgo/vela/plugin';
const segment = (from: number, to: number, color = '#22c55e') => ({
  fromTimestamp: from, toTimestamp: to, fromPrice: from + 100, toPrice: to + 100, color, label: '趨勢',
});
const layer: StrategyOverlayLayer = { strategyId: 'big_fish', strategyName: '吃大魚', shortName: '吃大魚',
  color: '#a855f7', icon: 'fish', lines: [], events: [] };

test('線段維持各自端點，歷史價格不會藉長路徑拉大近期縮放，缺口與轉色仍保留', () => {
  const out = buildStrategyOutput([{ ...layer, lines: [segment(1, 2), segment(2, 3), segment(5, 6), segment(6, 7, '#ef4444')] }]);
  assert.equal(out.lines?.length, 4);
  assert.deepEqual(out.lines?.map(line => [line.x1, line.x2]), [[1, 2], [2, 3], [5, 6], [6, 7]]);
  assert.equal(out.lines?.[3].color, '#ef4444');
  assert.equal(out.polylines, undefined);
});

test('同根進場同列，平倉仍位於上方，完整原因與圖示都保留', () => {
  const entry = { timestamp: 1000, price: 10, type: 'ENTRY' as const, icon: '▲', label: '進場', reason: '確認突破' };
  const other: StrategyOverlayLayer = { ...layer, strategyId: 'trend', shortName: '趨勢', events: [entry] };
  const out = buildStrategyOutput([{ ...layer, events: [entry, { ...entry, type: 'EXIT', label: '平倉', reason: '反轉' }] }, other]);
  assert.equal(out.labels?.length, 2);
  const below = out.labels?.find(label => label.yloc === 'belowbar');
  assert.equal(below?.text, '大魚・進場\n趨勢・進場');
  assert.equal(below?.style, 'label_up');
  assert.match(below?.tooltip ?? '', /吃大魚.*確認突破/);
  assert.match(below?.tooltip ?? '', /趨勢.*確認突破/);
  assert.equal(out.labels?.find(label => label.yloc === 'abovebar')?.text, '大魚・平倉');
  assert.deepEqual(buildStrategyOutput([]), { lines: [], labels: [] });
});

test('每圖獨立一次發送資料，不建立互動繪圖，卸載會解除註冊', () => {
  const types: string[] = [], outputs: NativeIndicatorOutput[][] = [];
  const fake = { getVisibleRange: () => null, addNativeIndicator(type: string) {
    types.push(type);
    const descriptor = getNativeIndicator(type)!;
    const instance = descriptor.create(), emitted: NativeIndicatorOutput[] = [];
    outputs.push(emitted);
    /** 此生命週期測試只替代 emit，不建立行情來源或 renderer。 */
    instance.start({ emit: (out: NativeIndicatorOutput) => { emitted.push(out); } } as unknown as NativeIndicatorContext, {});
    return { remove: () => instance.stop() };
  } } as unknown as VelaWorkspace['chart'];
  const first = createStrategyOverlay(fake), second = createStrategyOverlay(fake);
  first.update([{ ...layer, lines: [segment(1, 2)] }]);
  second.update([]);
  assert.notEqual(types[0], types[1]);
  assert.equal(outputs[0].at(-1)?.lines?.length, 1);
  assert.equal(outputs[1].at(-1)?.lines?.length, 0);
  first.destroy(); second.destroy();
  assert.equal(getNativeIndicator(types[0]), undefined);
  assert.equal(getNativeIndicator(types[1]), undefined);
});

test('密集訊號合併不漏原因，放大後展開且不包含視窗外訊號', () => {
  const events = [100, 110, 300].map(timestamp => ({ timestamp, price: 10, type: 'ENTRY' as const,
    icon: '▲', label: '進場', reason: `原因 ${timestamp}` }));
  const layers = [{ ...layer, events }];
  const wide = buildStrategyOutput(layers, { from: 0, to: 500 }, 1000);
  assert.equal(wide.labels?.length, 2);
  assert.equal(wide.labels?.[0].text, '大魚・進場\n共 2 筆進場');
  assert.match(wide.labels?.[0].tooltip ?? '', /原因 100[\s\S]*原因 110/);
  const zoomed = buildStrategyOutput(layers, { from: 95, to: 125 }, 1000);
  assert.equal(zoomed.labels?.length, 2);
  assert.ok(zoomed.labels?.every(label => label.text === '大魚・進場'));
  assert.deepEqual(zoomed.labels?.map(label => label.x), [100, 110]);
});
