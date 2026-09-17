/** @file 波段快照呈現模型；壞 JSON、未收盤與過期訊號一律不能列為有效機會。 */
import { WAVE_SYMBOLS } from '../../services/cryptoUniverse';
import { WAVE_INTERVAL_MS } from '../../services/strategy/strategies/cryptoWave';
import type { WaveSnapshot } from '../../services/waveRadar/state';
import { buildWaveRotation } from './waveRotation';

export function buildWaveCards(rows: { symbol: string; snapshotJson: string }[], now: number) {
  const rank: Record<string, number> = { BREAKOUT: 0, RETEST: 1, PULLBACK: 2, WATCH: 3, EXTENDED: 4, EXIT: 5, WAIT: 6 };
  const parsed = new Map<string, WaveSnapshot>();
  for (const row of rows) {
    try {
      const value = JSON.parse(row.snapshotJson) as WaveSnapshot;
      if (value?.signal && Number.isFinite(value.signal.barTime) && Number.isFinite(value.signal.price) && value.signal.phase in rank) parsed.set(row.symbol, value);
    } catch { /** 單一快照損壞不能使整頁雷達失效。 */ }
  }
  const healthySymbols = new Set([...parsed].filter(([, snapshot]) => !snapshot.error &&
    now - snapshot.signal.barTime < 2 * WAVE_INTERVAL_MS && snapshot.signal.barTime + WAVE_INTERVAL_MS <= now).map(([symbol]) => symbol));
  const rotations = buildWaveRotation(parsed, healthySymbols);
  return WAVE_SYMBOLS.map(coin => {
    const row = rows.find(item => item.symbol === coin.symbol);
    const snapshot = row ? parsed.get(coin.symbol) ?? null : null;
    const signal = snapshot?.signal;
    const stale = !signal || now - signal.barTime >= 2 * WAVE_INTERVAL_MS || signal.barTime + WAVE_INTERVAL_MS > now;
    const healthy = !!snapshot && !snapshot.error && !stale;
    const rotation = rotations.get(coin.symbol) ?? { relative4h: null, relative24h: null, score: null, rank: null, candidate: false };
    const pullbackCandidate = healthy && snapshot?.analysis?.pullbackStage !== undefined && snapshot.analysis.pullbackStage !== 'NONE';
    return { coin, snapshot, signal, stale, healthy, rotation, pullbackCandidate,
      active: healthy && (signal?.phase === 'BREAKOUT' || signal?.phase === 'RETEST' || signal?.phase === 'PULLBACK') };
  }).sort((a, b) => Number(b.healthy) - Number(a.healthy) || Number(b.active) - Number(a.active) ||
    Number(b.pullbackCandidate) - Number(a.pullbackCandidate) || Number(b.rotation.candidate) - Number(a.rotation.candidate) ||
    (b.rotation.score ?? -Infinity) - (a.rotation.score ?? -Infinity) || (a.healthy ? rank[a.signal!.phase] : 9) - (b.healthy ? rank[b.signal!.phase] : 9));
}
export type WaveCardData = ReturnType<typeof buildWaveCards>[number];
