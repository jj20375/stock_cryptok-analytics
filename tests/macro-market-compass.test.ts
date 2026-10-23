/**
 * @file 測試首頁與美股頁「市場漲跌走勢羅盤（美債・匯率・期貨・債券利差）」的美股/台股專屬多空判定邏輯
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMacroPillarsAndOutlook } from '../app/services/macroService';

test('四大宏觀維度同步偏多時，美股與台股走向均應判定為 BULLISH (偏多看漲)', () => {
  const result = buildMacroPillarsAndOutlook({
    us10y: { value: 4.05, prevValue: 4.12, changePct: -1.7, ma10: 4.18, trend: 'DOWN' },
    us5y: { value: 3.88, prevValue: 3.92, ma10: 3.95, trend: 'DOWN' },
    dxy: { value: 102.1, prevValue: 102.6, changePct: -0.48, ma10: 103.0, trend: 'DOWN' },
    usdTwd: { value: 31.65, prevValue: 31.82, changePct: -0.53, ma10: 31.95, trend: 'DOWN' },
    nq: { value: 20650, prevValue: 20420, changePct: 1.12, ma10: 20300, trend: 'UP' },
    es: { value: 5880, prevValue: 5840, changePct: 0.68, ma10: 5810, trend: 'UP' },
    vix: { value: 15.2, prevValue: 16.4, changePct: -7.3, ma10: 16.8, trend: 'DOWN' },
    yieldSpread10Y3M: 0.25,
  });

  const usView = result.marketViews.US;
  assert.equal(usView.pillars.treasury.signal, 'BULLISH');
  assert.equal(usView.pillars.fx.signal, 'BULLISH');
  assert.equal(usView.pillars.futures.signal, 'BULLISH');
  assert.equal(usView.pillars.bondSpreadAndVix.signal, 'BULLISH');
  // 美股匯率卡應專注顯示 DXY 美元指數，不混入新台幣字樣
  assert.doesNotMatch(usView.pillars.fx.primaryMetric, /台幣/);
  assert.match(usView.pillars.fx.signalLabel, /利多美股看漲/);

  assert.equal(usView.outlook.direction, 'BULLISH');
  assert.equal(usView.outlook.bullishCount, 4);
  assert.equal(usView.outlook.score, 100);
  assert.match(usView.outlook.label, /美股偏多看漲/);
});

test('當那指期貨重挫 (-1.83%)、VIX 高於 10MA (18.46 > 16.83) 且 10Y 殖利率高於 5% 時，美股絕不可誤判為偏多看漲', () => {
  // 對應使用者截圖真實情境：NQ -1.83%、ES -1.05%、10Y 5.117%、DXY 101.60、VIX 18.46 (10MA 16.83)
  const result = buildMacroPillarsAndOutlook({
    us10y: { value: 5.117, prevValue: 5.136, changePct: -0.37, ma10: 5.18, trend: 'DOWN' },
    us5y: { value: 4.93, prevValue: 4.95, ma10: 4.98, trend: 'DOWN' },
    dxy: { value: 101.6, prevValue: 101.8, changePct: -0.2, ma10: 102.08, trend: 'DOWN' },
    usdTwd: { value: 32.53, prevValue: 32.45, changePct: 0.25, ma10: 32.24, trend: 'UP' },
    nq: { value: 29458, prevValue: 30007, changePct: -1.83, ma10: 30138, trend: 'DOWN' },
    es: { value: 5750, prevValue: 5811, changePct: -1.05, ma10: 5830, trend: 'DOWN' },
    vix: { value: 18.46, prevValue: 17.9, changePct: 3.1, ma10: 16.83, trend: 'UP' },
    yieldSpread10Y3M: 1.04,
  });

  const usView = result.marketViews.US;
  // 1. 10Y 殖利率雖略低於 10MA 但絕對值 > 5%，屬高息區間，應為 NEUTRAL 而非盲目看漲
  assert.equal(usView.pillars.treasury.signal, 'NEUTRAL');
  // 2. VIX (18.46) 高於 10MA (16.83)，避險升溫，應為 NEUTRAL 而非看漲
  assert.equal(usView.pillars.bondSpreadAndVix.signal, 'NEUTRAL');
  // 3. 那指期貨 (-1.83%) 跌破 10MA，應為 BEARISH
  assert.equal(usView.pillars.futures.signal, 'BEARISH');
  // 4. 美股總研判應為 BEARISH (偏空看跌)，且摘要必須反映那指期貨下跌，絕不出現「期貨維持多頭結構」的矛盾描述
  assert.equal(usView.outlook.direction, 'BEARISH');
  assert.match(usView.outlook.label, /美股偏空看跌/);
  assert.match(usView.outlook.summary, /那指期貨下跌 1\.83% 且位於 10MA/);
});

test('台股視角 (marketViews.TW) 會納入新台幣匯率判讀外資資金流向', () => {
  const result = buildMacroPillarsAndOutlook({
    us10y: { value: 4.42, prevValue: 4.35, changePct: 1.6, ma10: 4.30, trend: 'UP' },
    us5y: { value: 4.15, prevValue: 4.12, ma10: 4.10, trend: 'UP' },
    dxy: { value: 104.5, prevValue: 104.1, changePct: 0.38, ma10: 103.8, trend: 'UP' },
    usdTwd: { value: 32.45, prevValue: 32.35, changePct: 0.31, ma10: 32.20, trend: 'UP' },
    nq: { value: 20450, prevValue: 20300, changePct: 0.74, ma10: 20150, trend: 'UP' },
    es: { value: 5850, prevValue: 5820, changePct: 0.51, ma10: 5790, trend: 'UP' },
    vix: { value: 16.1, prevValue: 16.8, changePct: -4.1, ma10: 17.2, trend: 'DOWN' },
    yieldSpread10Y3M: 0.15,
  });

  const twView = result.marketViews.TW;
  assert.match(twView.pillars.fx.primaryMetric, /台幣/);
  assert.equal(twView.pillars.fx.signal, 'BEARISH');
  assert.equal(twView.outlook.direction, 'NEUTRAL');
});
