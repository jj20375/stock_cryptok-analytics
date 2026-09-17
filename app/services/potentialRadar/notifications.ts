/** @file 潛力幣候選的通知選擇與 Slack 內容；只處理已收盤的公開現貨觀察訊號。 */
import { bigFishLabel } from './bigFish';
import { DERIVATIVE_LABELS } from './derivatives';
import { PHASE_LABELS, QUARTER_MS, isTrendConfirmedCandidate, type RadarSnapshot } from './types';
import { createCryptoSignalCard, serializeSlackCard } from '../slack/cryptoSignalCard';

export interface PotentialNotice { key: 'CANDIDATE' | 'BIG_FISH'; }

/**
 * 僅趨勢共振的候選才提醒；吃大魚是單根事件，即使仍在候選清單中也值得再提醒。
 * 流動性不足與過熱會被既有候選判斷排除，不能透過 Slack 繞過既有風控。
 */
export function selectPotentialNotice(next: RadarSnapshot, previous: RadarSnapshot | null): PotentialNotice | null {
  if (next.error || !next.signal || !isTrendConfirmedCandidate(next.signal)) return null;
  const isNewBigFish = next.signal.bigFish?.entry === true && previous?.signal?.bigFish?.entry !== true;
  if (isNewBigFish) return { key: 'BIG_FISH' };
  return previous?.signal && isTrendConfirmedCandidate(previous.signal) ? null : { key: 'CANDIDATE' };
}

/** Slack 僅傳送可由畫面回查的收盤資訊與風控參考，不包含下單指令或勝率暗示。 */
export function formatPotentialMessage(snapshot: RadarSnapshot) {
  const signal = snapshot.signal!;
  const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '尚無' : value.toPrecision(6);
  const closedAt = new Date(signal.barTime + QUARTER_MS).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const source = signal.source === 'GATE_SPOT' ? 'Gate 現貨' : 'Bybit 現貨';
  const label = signal.bigFish?.entry ? bigFishLabel(signal.bigFish) : PHASE_LABELS[signal.phase];
  const derivative = signal.derivatives && signal.derivatives.status !== 'UNAVAILABLE'
    ? DERIVATIVE_LABELS[signal.derivatives.status] : '永續籌碼待確認';
  return `🟢 *${snapshot.symbol}｜${label}*\n` +
    `進場參考 ${number(signal.price)} USDT｜失效參考 ${number(signal.invalidation)} USDT\n` +
    `${PHASE_LABELS[signal.phase]}｜量能 ${number(signal.volumeRatio)} 倍｜${derivative}\n` +
    `15 分收盤 ${closedAt}（台北）｜${source}\n` +
    '已收盤觀察，非下單指令。';
}

/** 新候選使用精簡 Block Kit 卡片；詳細指標仍可回雷達頁查看。 */
export function formatPotentialCard(snapshot: RadarSnapshot) {
  const signal = snapshot.signal!;
  const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '尚無' : value.toPrecision(6);
  const closedAt = new Date(signal.barTime + QUARTER_MS).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const source = signal.source === 'GATE_SPOT' ? 'Gate 現貨' : 'Bybit 現貨';
  const label = signal.bigFish?.entry ? `經典${bigFishLabel(signal.bigFish)}` : PHASE_LABELS[signal.phase];
  const derivative = signal.derivatives && signal.derivatives.status !== 'UNAVAILABLE'
    ? DERIVATIVE_LABELS[signal.derivatives.status] : '永續籌碼待確認';
  return serializeSlackCard(createCryptoSignalCard({
    icon: signal.bigFish?.entry ? '🐟' : '🟢', title: `${snapshot.symbol}｜潛力幣雷達`, signal: label,
    price: `${number(signal.price)} USDT`, closedAt: `${closedAt}（台北）`,
    invalidation: `${number(signal.invalidation)} USDT`,
    strength: `量能 ${number(signal.volumeRatio)} 倍｜4h＋日線共振｜${derivative}`,
    risk: signal.risks[0] ?? '未偵測到額外風控提示；仍須留意滑價與行情反轉', source,
  }));
}
