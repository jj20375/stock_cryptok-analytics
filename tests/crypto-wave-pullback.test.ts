import assert from 'node:assert/strict';
import { test } from 'node:test';
import cryptoWave, { analyzeWave, WAVE_PARAMS, WAVE_INTERVAL_MS } from '../app/services/strategy/strategies/cryptoWave';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import type { Candle, StrategyContext } from '../app/services/strategy/types';
import { waveFixture } from './helpers/waveFixture';

const contextFor = (candles: Candle[], params: Record<string, number>): StrategyContext => ({
  candles,
  index: candles.length - 1,
  indicators: new IndicatorCache(candles),
  position: null,
  params,
});

/**
 * 以既有的上升趨勢 fixture 為底，把最後兩根改成「前一根下探均線、當根收回均線上並突破前根高點」，
 * 用來驗證新增的 PULLBACK 進場訊號。
 */
function buildPullbackCandles(): { candles: Candle[]; ma: number } {
  const candles = waveFixture().map(c => ({ ...c }));
  const maPeriod = 20;
  // 先算出倒數第二根當下的 MA20，作為回踩基準
  const closesForMa = candles.slice(-1 - maPeriod, -1).map(c => c.close);
  const ma = closesForMa.reduce((sum, v) => sum + v, 0) / closesForMa.length;

  const prevIndex = candles.length - 2;
  const lastIndex = candles.length - 1;
  // 前一根：最低價下探到均線附近（確實回踩過），收在均線下方一點
  candles[prevIndex] = {
    ...candles[prevIndex],
    open: ma * 1.005, high: ma * 1.008, low: ma * 0.995, close: ma * 0.999,
  };
  // 當根：收盤站回均線之上、且突破前一根高點（轉強確認），但不放大量避免觸發 BREAKOUT
  candles[lastIndex] = {
    ...candles[lastIndex],
    open: ma * 0.999, high: ma * 1.012, low: ma * 0.998, close: ma * 1.01,
    volume: 100000,
  };
  return { candles, ma };
}

test('啟用 pullbackMa 後，回踩均線並轉強會產生 PULLBACK 進場訊號', () => {
  const { candles } = buildPullbackCandles();

  // 預設 pullbackMa = 0（關閉）→ 不得出現 PULLBACK
  const disabled = analyzeWave(contextFor(candles, { ...WAVE_PARAMS }));
  assert.notEqual(disabled.phase, 'PULLBACK');

  // 啟用 MA20 回踩 → 應辨識為 PULLBACK，且 evaluate 會轉成進場
  const params = { ...WAVE_PARAMS, pullbackMa: 20, pullbackTolerancePct: 2 };
  const enabled = analyzeWave(contextFor(candles, params));
  assert.equal(enabled.phase, 'PULLBACK');
  assert.ok(enabled.stopLossPct && enabled.stopLossPct > 0);

  const action = cryptoWave.evaluate(contextFor(candles, params));
  assert.equal(action.type, 'ENTRY');
  assert.equal(action.type === 'ENTRY' && action.side, 'LONG');
});

test('回踩訊號預設關閉，且非法的 pullbackMa 不會誤觸發', () => {
  const { candles } = buildPullbackCandles();

  // 預設值必須是關閉狀態，避免未經回測就悄悄多出一批交易
  assert.equal(WAVE_PARAMS.pullbackMa, 0);

  // 非整數或超出範圍的均線期數一律不啟用此訊號
  for (const pullbackMa of [3, 12.5, 500, NaN]) {
    const signal = analyzeWave(contextFor(candles, { ...WAVE_PARAMS, pullbackMa }));
    assert.notEqual(signal.phase, 'PULLBACK');
  }
});

test('價格離均線過遠或未實際回踩時不產生 PULLBACK', () => {
  const { candles, ma } = buildPullbackCandles();
  const params = { ...WAVE_PARAMS, pullbackMa: 20, pullbackTolerancePct: 2 };

  // 收盤距均線過遠（超過容忍度）→ 不算貼著均線整理
  const farAway = candles.map(c => ({ ...c }));
  farAway[farAway.length - 1] = { ...farAway[farAway.length - 1], close: ma * 1.2, high: ma * 1.25 };
  assert.notEqual(analyzeWave(contextFor(farAway, params)).phase, 'PULLBACK');

  // 前一根沒有下探到均線（沒真的回踩過）→ 不算回踩轉強
  const noTouch = candles.map(c => ({ ...c }));
  const prevIndex = noTouch.length - 2;
  noTouch[prevIndex] = { ...noTouch[prevIndex], low: ma * 1.15, high: ma * 1.2, close: ma * 1.18, open: ma * 1.16 };
  assert.notEqual(analyzeWave(contextFor(noTouch, params)).phase, 'PULLBACK');
});

test('新增訊號不影響既有 K 線時間軸假設', () => {
  // 確保 fixture 與策略共用同一組 4h 週期常數，避免測試與實作漂移
  const { candles } = buildPullbackCandles();
  assert.equal(candles[1].openTime - candles[0].openTime, WAVE_INTERVAL_MS);
});
