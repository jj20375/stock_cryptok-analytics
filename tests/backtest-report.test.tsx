/** @file 零成交報告最小檢查：取消訊號不得被誤稱為沒有訊號；只渲染合成資料，不送單。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BacktestReport } from '../app/features/backtest/components/BacktestReport';
import { computeMetrics } from '../app/services/backtest/metrics';
import type { BacktestDetail } from '../app/features/backtest/types';

test('零成交報告顯示取消次數與原因，期望值不冒充已成交績效', () => {
  const reason = '進場取消：扣成本後目標空間不足';
  const result = computeMetrics([{ time: 0, equity: 1000 }, { time: 3_600_000, equity: 1000 }], [], 1000, 8760);
  const detail = { result: { ...result, futures: { events: [{ cancelled: true, reason }, { cancelled: true, reason }], eventsTruncated: false } } } as BacktestDetail;
  const html = renderToStaticMarkup(createElement(BacktestReport, { detail }));
  assert.match(html, /已記錄 2 次進場取消/);
  assert.ok(html.includes(`${reason}・2 次`));
  assert.match(html, /不能計算勝率、獲利因子或每筆期望值/);
  assert.ok(!html.includes('更短的區間可能完全沒有符合條件的訊號'));
});
