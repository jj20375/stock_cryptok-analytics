/** @file 波段通知選擇與內容；階段事件和額外品質分析合併成一則，不重複洗版。 */
import { WAVE_INTERVAL_MS, WAVE_LABELS } from '../strategy/strategies/cryptoWave';
import { waveSourceLabel } from '../cryptoUniverse';
import { SETUP_LABELS, type WaveSetup } from './analysis';
import type { WaveSnapshot } from './state';
import { createCryptoSignalCard, serializeSlackCard } from '../slack/cryptoSignalCard';

/** 同幣同類品質通知至少間隔六根 4h；失效事件不受冷卻限制。 */
const ANALYSIS_COOLDOWN_MS = 6 * WAVE_INTERVAL_MS;
export function selectWaveNotice(next: WaveSnapshot, previous: WaveSnapshot | null) {
  if (next.error) return null;
  const setup = next.analysis?.setup ?? 'NONE';
  const last = previous?.analysisNotifiedAt?.[setup];
  const qualityChanged = setup !== 'NONE' && (last == null || next.signal.barTime - last >= ANALYSIS_COOLDOWN_MS);
  const phaseChanged = next.signal.phase !== 'WAIT' && next.signal.phase !== previous?.signal.phase;
  if (!qualityChanged && !phaseChanged) return null;
  if (qualityChanged) next.analysisNotifiedAt = { ...next.analysisNotifiedAt, [setup]: next.signal.barTime };
  return { key: `${next.signal.phase}:${qualityChanged ? setup : 'PHASE'}`, setup: qualityChanged ? setup : 'NONE' as WaveSetup };
}

export function formatWaveMessage(symbol: string, snapshot: WaveSnapshot) {
  const s = snapshot.signal;
  const a = snapshot.analysis;
  const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '尚無' : value.toPrecision(6);
  const closed = new Date(s.barTime + WAVE_INTERVAL_MS).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const label = a && a.setup !== 'NONE' ? SETUP_LABELS[a.setup] : WAVE_LABELS[s.phase];
  const icon = s.phase === 'EXIT' ? '🔴' : s.phase === 'EXTENDED' ? '🟠' : a?.setup && a.setup !== 'NONE' ? '🟢' : '🔎';
  return `${icon} *${symbol}｜${label}*\n` +
    `進場參考 ${number(s.price)} USDT｜失效參考 ${number(snapshot.tracking?.stopPrice)} USDT\n` +
    `${WAVE_LABELS[s.phase]}｜量能 ${s.volumeRatio?.toFixed(2) ?? '—'} 倍｜${s.reason}\n` +
    `4 小時收盤 ${closed}（台北）｜${waveSourceLabel(snapshot.source)}\n` +
    '已收盤觀察，非下單指令。';
}

export function formatWaveCard(symbol: string, snapshot: WaveSnapshot) {
  const s = snapshot.signal;
  const a = snapshot.analysis;
  const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '尚無' : value.toPrecision(6);
  const closed = new Date(s.barTime + WAVE_INTERVAL_MS).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const label = a && a.setup !== 'NONE' ? SETUP_LABELS[a.setup] : WAVE_LABELS[s.phase];
  const icon = s.phase === 'EXIT' ? '🔴' : s.phase === 'EXTENDED' ? '🟠' : '🌊';
  return serializeSlackCard(createCryptoSignalCard({
    icon, title: `${symbol}｜波段雷達`, signal: label,
    price: `${number(s.price)} USDT`, closedAt: `${closed}（台北）`, closedLabel: '4 小時收盤',
    invalidation: `${number(snapshot.tracking?.stopPrice)} USDT`,
    strength: `量能 ${s.volumeRatio?.toFixed(2) ?? '—'} 倍｜${s.reason}`,
    risk: a?.nextStep ?? (s.phase === 'EXIT' ? '趨勢已失效，勿把舊進場價當成目前訊號' : '波段條件尚待更多樣本驗證'),
    source: `${waveSourceLabel(snapshot.source)} 現貨`,
  }));
}
