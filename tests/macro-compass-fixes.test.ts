/**
 * @file 羅盤 10/22 預判失準檢討後的修正：台幣與美元背離、VIX 低檔但升溫、抓取失敗不得產生假訊號、
 * 期貨文案正負號，以及台股開盤前快照排程時間。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMacroPillarsAndOutlook, type MacroRawInput } from '../app/services/macroService';
import { isTwPreopenSnapshotTime } from '../app/services/scheduledJobs';

/** 各維度皆為中性的基準輸入，個別測試只覆寫要驗證的欄位 */
function baseInput(overrides: Partial<MacroRawInput> = {}): MacroRawInput {
  return {
    // 10Y 位於 4.5% 以上且略低於 10MA → 高息區中性
    us10y: { value: 5.0, prevValue: 5.01, changePct: -0.2, ma10: 5.05, trend: 'DOWN' },
    us5y: { value: 4.9, prevValue: 4.9, ma10: 4.92, trend: 'DOWN' },
    // 美元略低於均線、台幣僅貼著均線上方（偏離 0.03% 未達背離門檻）→ 台股匯率中性
    dxy: { value: 101.9, prevValue: 101.9, changePct: 0, ma10: 102.0, trend: 'DOWN' },
    usdTwd: { value: 32.3, prevValue: 32.3, changePct: 0, ma10: 32.29, trend: 'UP' },
    // NQ 站上均線但小跌、ES 平盤 → 期貨中性
    nq: { value: 30100, prevValue: 30110, changePct: -0.03, ma10: 30000, trend: 'UP' },
    es: { value: 7800, prevValue: 7800, changePct: 0, ma10: 7790, trend: 'UP' },
    // VIX 18.5 低於均線 → 非低檔、非升溫，中性
    vix: { value: 18.5, prevValue: 18.6, changePct: -0.5, ma10: 18.8, trend: 'DOWN' },
    yieldSpread10Y3M: 1.0,
    ...overrides,
  };
}

test('美元走弱但台幣逆勢貶值超過 0.15% 門檻時，台股匯率維度判為看跌', () => {
  const tw = buildMacroPillarsAndOutlook(baseInput({
    dxy: { value: 101.68, prevValue: 101.78, changePct: -0.1, ma10: 102.0, trend: 'DOWN' },
    usdTwd: { value: 32.45, prevValue: 32.37, changePct: 0.25, ma10: 32.23, trend: 'UP' },
  })).marketViews.TW;
  assert.equal(tw.pillars.fx.signal, 'BEARISH');
  assert.match(tw.pillars.fx.explanation, /台幣逆勢貶值/);
});

test('台幣僅貼著 10MA 上方（未達背離門檻）時維持中性', () => {
  const tw = buildMacroPillarsAndOutlook(baseInput({
    dxy: { value: 101.68, prevValue: 101.78, changePct: -0.1, ma10: 102.0, trend: 'DOWN' },
    usdTwd: { value: 32.25, prevValue: 32.24, changePct: 0.03, ma10: 32.23, trend: 'UP' },
  })).marketViews.TW;
  assert.equal(tw.pillars.fx.signal, 'NEUTRAL');
});

test('美元走強但台幣逆勢升值時，台股匯率維度判為看漲', () => {
  const tw = buildMacroPillarsAndOutlook(baseInput({
    dxy: { value: 102.6, prevValue: 102.4, changePct: 0.2, ma10: 102.2, trend: 'UP' },
    usdTwd: { value: 32.1, prevValue: 32.2, changePct: -0.31, ma10: 32.25, trend: 'DOWN' },
  })).marketViews.TW;
  assert.equal(tw.pillars.fx.signal, 'BULLISH');
  assert.match(tw.pillars.fx.explanation, /台幣逆勢升值/);
});

test('VIX 低檔但已站上 10MA（10/22 實況 16.68 > 16.65）時不得判為看漲', () => {
  const view = buildMacroPillarsAndOutlook(baseInput({
    vix: { value: 16.68, prevValue: 17.31, changePct: -3.6, ma10: 16.65, trend: 'UP' },
  })).marketViews.TW;
  assert.equal(view.pillars.bondSpreadAndVix.signal, 'NEUTRAL');
  assert.match(view.pillars.bondSpreadAndVix.explanation, /避險情緒正在升溫/);
});

test('VIX 低於 10MA 但單日跳升 5% 以上時同樣視為升溫中性', () => {
  const view = buildMacroPillarsAndOutlook(baseInput({
    vix: { value: 16.4, prevValue: 15.5, changePct: 5.8, ma10: 16.9, trend: 'DOWN' },
  })).marketViews.TW;
  assert.equal(view.pillars.bondSpreadAndVix.signal, 'NEUTRAL');
});

test('VIX 低檔、低於 10MA 且未跳升時仍判為看漲', () => {
  const view = buildMacroPillarsAndOutlook(baseInput({
    vix: { value: 15.2, prevValue: 15.6, changePct: -2.6, ma10: 16.1, trend: 'DOWN' },
  })).marketViews.TW;
  assert.equal(view.pillars.bondSpreadAndVix.signal, 'BULLISH');
});

test('那指期貨抓取失敗時，期貨維度標為資料暫缺且不得產生看漲分數', () => {
  const tw = buildMacroPillarsAndOutlook(baseInput({ nq: null, es: null })).marketViews.TW;
  assert.equal(tw.pillars.futures.dataUnavailable, true);
  assert.equal(tw.pillars.futures.signal, 'NEUTRAL');
  assert.equal(tw.outlook.score, 0);
  assert.equal(tw.outlook.unavailableCount, 1);
  assert.equal(tw.outlook.neutralCount, 3);
  assert.match(tw.outlook.summary, /報價暫缺，未納入評分/);
});

test('新台幣匯率抓取失敗時，台股匯率維度標為資料暫缺；美股不受影響', () => {
  const result = buildMacroPillarsAndOutlook(baseInput({ usdTwd: null }));
  assert.equal(result.marketViews.TW.pillars.fx.dataUnavailable, true);
  assert.equal(result.marketViews.TW.pillars.fx.primaryMetric, '—');
  assert.equal(result.marketViews.US.pillars.fx.dataUnavailable, undefined);
});

test('只缺標普期貨時僅依那指判讀，且不把 ES 當成 0% 參與判斷', () => {
  const tw = buildMacroPillarsAndOutlook(baseInput({
    nq: { value: 29800, prevValue: 29700, changePct: 0.34, ma10: 30000, trend: 'DOWN' },
    es: null,
  })).marketViews.TW;
  // NQ 位於均線下方但上漲、ES 缺資料 → 不滿足看跌也不滿足看漲，維持中性
  assert.equal(tw.pillars.futures.signal, 'NEUTRAL');
  assert.match(tw.pillars.futures.secondaryMetric, /標普 ES —/);
});

test('那指期貨小漲但位於 10MA 下方而被判看跌時，文案不得寫成「下跌」', () => {
  // 對應使用者截圖：NQ +0.22%、ES -0.35%、NQ 29,205 低於 10MA 29,916
  const tw = buildMacroPillarsAndOutlook(baseInput({
    nq: { value: 29205, prevValue: 29141, changePct: 0.22, ma10: 29916, trend: 'DOWN' },
    es: { value: 7675, prevValue: 7702, changePct: -0.35, ma10: 7760, trend: 'DOWN' },
  })).marketViews.TW;
  assert.equal(tw.pillars.futures.signal, 'BEARISH');
  assert.match(tw.pillars.futures.explanation, /那指期貨上漲 0\.22% 且位於 10MA/);
  assert.doesNotMatch(tw.pillars.futures.explanation, /下跌 0\.22/);
  assert.doesNotMatch(tw.outlook.summary, /下挫 0\.22|下跌 0\.22/);
});

test('台股開盤前快照只在台北週一至週五 08:30（UTC 00:30）觸發', () => {
  assert.equal(isTwPreopenSnapshotTime(Date.parse('2026-10-22T00:30:00Z')), true); // 週四
  assert.equal(isTwPreopenSnapshotTime(Date.parse('2026-10-22T00:31:00Z')), false);
  assert.equal(isTwPreopenSnapshotTime(Date.parse('2026-10-24T00:30:00Z')), false); // 週六
  assert.equal(isTwPreopenSnapshotTime(Date.parse('2026-10-26T00:30:00Z')), true); // 週一
});

test('台股匯率權重為 10 分：只有匯率看跌時，台股評分為 -10 且維持多空震盪', () => {
  const tw = buildMacroPillarsAndOutlook(baseInput({
    dxy: { value: 101.68, prevValue: 101.78, changePct: -0.1, ma10: 102.0, trend: 'DOWN' },
    usdTwd: { value: 32.45, prevValue: 32.37, changePct: 0.25, ma10: 32.23, trend: 'UP' },
  })).marketViews.TW;
  assert.equal(tw.pillars.fx.signal, 'BEARISH');
  assert.equal(tw.outlook.score, -10);
  assert.equal(tw.outlook.direction, 'NEUTRAL');
});
