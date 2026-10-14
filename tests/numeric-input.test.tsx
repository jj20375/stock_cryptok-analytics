/** @file 數字草稿、浮點步進與前後端邊界檢查；沒有行情、儲存或送單副作用。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NumericInput } from '../app/components/NumericInput';
import { normalizeNumericText, numericFieldError } from '../app/utils/numericInput';
import { getExecutionFields } from '../app/features/backtest/components/BacktestSettings';
import { strategyParamError } from '../app/services/strategy/parameters';
import { listStrategies, getStrategy } from '../app/services/strategy/registry';

test('整數前導0移除，小數與未完成草稿保留；空字串不是0', () => {
  for (const [raw, expected] of [['0023', '23'], ['000', '0'], ['0.25', '0.25'], ['0.', '0.'], ['', ''], ['-001', '-1']]) assert.equal(normalizeNumericText(raw), expected);
  for (const invalid of ['', '.', 'NaN', 'Infinity', '2abc', '0x0']) assert.ok(numericFieldError(invalid));
  assert.equal(numericFieldError('0.25'), null);
  assert.match(numericFieldError('76', { min: 1, max: 75, step: 1 })!, /75/);
  assert.ok(numericFieldError('2.05', { min: 2, max: 4, step: 0.1 }));
  assert.equal(numericFieldError('2.1', { min: 2, max: 4, step: 0.1 }), null);
});

test('合約0.25%預設符合步進，前後端策略範圍一致且所有預設有效', () => {
  const risk = getExecutionFields(true).find(field => field.key === 'maxRiskPerTradePct')!;
  assert.equal(numericFieldError(0.25, risk), null); assert.ok(numericFieldError(0.26, risk));
  for (const strategy of listStrategies()) assert.equal(strategyParamError(strategy, strategy.defaultParams), null, strategy.id);
  const trend = getStrategy('futures_trend_retest')!;
  assert.match(strategyParamError(trend, { ...trend.defaultParams, targetR: 23 })!, /2～4/);
});

test('文字數字欄位顯示實際上限、關聯提示與無效狀態', () => {
  const html = renderToStaticMarkup(createElement(NumericInput, { label: '目標 R', value: '0023', min: 2, max: 4, step: 0.1 }));
  assert.match(html, /type="text"/); assert.match(html, /value="23"/);
  assert.match(html, /允許範圍：2～4/); assert.match(html, /最大值為 4/); assert.match(html, /aria-invalid="true"/);
});
