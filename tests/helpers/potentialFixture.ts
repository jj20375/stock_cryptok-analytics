/** @file 合成現貨量價；只供離線測試，不代表任何真實幣種或歷史績效。 */
import { QUARTER_MS, type DerivativeSignal, type RadarCandle } from '../../app/services/potentialRadar/types';

/** barMs 預設 15 分；4 小時線測試傳入 4 小時毫秒數，產生對齊 UTC 4 小時邊界的序列。 */
export function potentialFixture(cutoff: number, burst = true, count = 400, barMs = QUARTER_MS): RadarCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = burst && i === count - 1 ? 101.2 : 100;
    const volume = burst && i === count - 1 ? 3000 : 1000;
    return { openTime: cutoff - (count - i) * barMs, open: 100, high: Math.max(close, 101), low: 99,
      close, volume, turnover: volume * close };
  });
}
export const healthyDepth = { bid: 100_000, ask: 100_000, spreadPct: 0.05 };

export const healthyDerivatives: DerivativeSignal = {
  version: 'gate-perp-crowding-v1', source: 'GATE_USDT_PERP', status: 'HEALTHY_TREND', checkedAt: 0,
  openInterestUsd: 100_000_000, openInterestChange1hPct: 2, fundingRate: 0.0001, fundingPercentile: 50,
  takerLongShortRatio: 1.1, accountLongShortRatio: 1.05, topLongShortRatio: 1.2,
  longLiquidationUsd1h: 20_000, shortLiquidationUsd1h: 80_000, reasons: ['合成健康趨勢'], risks: [],
};
