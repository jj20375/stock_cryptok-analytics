import type { Candle } from '../../app/services/strategy/types';
import { WAVE_INTERVAL_MS } from '../../app/services/strategy/strategies/cryptoWave';

/** 合成行情只驗證邏輯，不當成歷史績效或真實行情展示。 */
export function waveFixture(lastOpen = Date.UTC(2026, 8, 6, 20)): Candle[] {
  const candles = Array.from({ length: 360 }, (_, i) => {
    const close = 100 + Math.min(i, 338) * 0.05;
    return { openTime: lastOpen - (359 - i) * WAVE_INTERVAL_MS, open: close, close, high: close + 1, low: close - 1, volume: 100000 };
  });
  const level = Math.max(...candles.slice(-21, -1).map(c => c.high));
  candles[359] = { ...candles[359], close: level + 0.4, high: level + 0.7, volume: 250000 };
  return candles;
}
