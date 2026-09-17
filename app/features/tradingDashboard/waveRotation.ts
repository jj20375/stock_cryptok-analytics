/** @file 波段雷達相對 BTC 強勢排序；只用同一根已收盤 4h 快照，不推估未來報酬。 */
import type { WaveSnapshot } from '../../services/waveRadar/state';

export interface WaveRotation {
  relative4h: number | null;
  relative24h: number | null;
  score: number | null;
  rank: number | null;
  candidate: boolean;
}

const returnPct = (values: number[] | undefined, bars: number) => {
  if (!values || values.length <= bars || !values.every(value => Number.isFinite(value) && value > 0)) return null;
  return (values.at(-1)! / values[values.length - 1 - bars] - 1) * 100;
};

/** 24h 權重較高以降低單根雜訊；分數只是排序，不是勝率或進場訊號。 */
export function buildWaveRotation(snapshots: Map<string, WaveSnapshot>, healthySymbols: Set<string>) {
  const btc = snapshots.get('BTCUSDT');
  // BTC 快照也必須新鮮且無錯誤；基準失效時整榜留空，不能拿舊 BTC 對比新幣價。
  const btcHealthy = healthySymbols.has('BTCUSDT');
  const btc4h = btcHealthy ? returnPct(btc?.analysis?.closes, 1) : null;
  const btc24h = btcHealthy ? returnPct(btc?.analysis?.closes, 6) : null;
  const result = new Map<string, WaveRotation>();
  const ranked: { symbol: string; score: number }[] = [];

  for (const [symbol, snapshot] of snapshots) {
    const sameBar = btc?.signal.barTime === snapshot.signal.barTime;
    const coin4h = sameBar ? returnPct(snapshot.analysis?.closes, 1) : null;
    const coin24h = sameBar ? returnPct(snapshot.analysis?.closes, 6) : null;
    const relative4h = coin4h == null || btc4h == null ? null : coin4h - btc4h;
    const relative24h = coin24h == null || btc24h == null ? null : coin24h - btc24h;
    const score = relative4h == null || relative24h == null ? null : relative4h * 0.35 + relative24h * 0.65;
    result.set(symbol, { relative4h, relative24h, score, rank: null, candidate: false });
    // 輪動榜只收日線多頭且沒有過度延伸／失效的標的，避免把「跌得較少」誤標成強勢機會。
    if (score != null && symbol !== 'BTCUSDT' && healthySymbols.has(symbol) && snapshot.signal.dailyTrend &&
        !['EXTENDED', 'EXIT'].includes(snapshot.signal.phase) && relative4h > 0 && relative24h > 0) ranked.push({ symbol, score });
  }

  ranked.sort((a, b) => b.score - a.score).forEach(({ symbol }, index) => {
    const value = result.get(symbol)!;
    value.rank = index + 1;
    // 前五名進入輪動觀察，不會改變正式波段 phase，也不會建立模擬持倉。
    value.candidate = index < 5;
  });
  return result;
}
