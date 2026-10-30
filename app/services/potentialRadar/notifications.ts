/** @file 潛力幣候選的通知選擇與 Slack 內容；只處理已收盤的公開現貨觀察訊號。 */
import { bigFishLabel } from './bigFish';
import { DERIVATIVE_LABELS, evaluateDerivativeTradeFilter } from './derivatives';
import { FOUR_HOUR_MS, PHASE_LABELS, QUARTER_MS, RADAR_RULES, isTrendConfirmedCandidate, type RadarSignal, type RadarSnapshot } from './types';
import { createCryptoSignalCard, serializeSlackCard } from '../slack/cryptoSignalCard';

export interface PotentialNotice { key: 'CANDIDATE' | 'BIG_FISH'; }

/** 4 小時吃大魚以該根收盤時間標示；舊 15 分快照沿用原本的 15 分收盤時間。 */
function signalClose(signal: RadarSignal) {
  const fish = signal.bigFish;
  if (fish?.entry && fish.timeframe === '4h') return { at: fish.barTime + FOUR_HOUR_MS, label: '4 小時收盤' };
  return { at: signal.barTime + QUARTER_MS, label: '15 分收盤' };
}

/**
 * 僅趨勢共振的候選才提醒；吃大魚是單根事件，即使仍在候選清單中也值得再提醒。
 * 流動性不足與過熱會被既有候選判斷排除，不能透過 Slack 繞過既有風控。
 * 4 小時吃大魚在整根 4 小時內每 15 分鐘都會沿用同一結果，因此以 barTime 判斷是否為新事件，
 * 並只在收盤後一小時內通知，避免輪替較晚才算到的標的用過時的進場價推播。
 */
export function selectPotentialNotice(next: RadarSnapshot, previous: RadarSnapshot | null): PotentialNotice | null {
  if (next.error || !next.signal || !isTrendConfirmedCandidate(next.signal)) return null;
  const fish = next.signal.bigFish;
  const previousFish = previous?.signal?.bigFish;
  const alreadyNotified = previousFish?.entry === true && previousFish.barTime === fish?.barTime;
  const fresh = fish?.timeframe !== '4h' ||
    next.checkedAt - (fish.barTime + FOUR_HOUR_MS) <= RADAR_RULES.bigFishNoticeWindowMs;
  if (fish?.entry === true && !alreadyNotified && fresh) return { key: 'BIG_FISH' };
  // 【詳細繁體中文註解】：一般候選推播前，若永續籌碼已確認為「多頭擁擠（CROWDED_LONG）」或「新增空單（NEW_SHORTS）」，
  // 直接阻擋一般候選通知，避免在多頭極度擁擠或空方建倉時推播追高訊號。
  const derivativeCheck = evaluateDerivativeTradeFilter(next.signal.derivatives, 'LONG');
  if (!derivativeCheck.allowTrade) return null;
  return previous?.signal && isTrendConfirmedCandidate(previous.signal) ? null : { key: 'CANDIDATE' };
}

/** Slack 僅傳送可由畫面回查的收盤資訊與風控參考，不包含下單指令或勝率暗示。 */
export function formatPotentialMessage(snapshot: RadarSnapshot) {
  const signal = snapshot.signal!;
  const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '尚無' : value.toPrecision(6);
  const close = signalClose(signal);
  const closedAt = new Date(close.at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const source = signal.source === 'GATE_SPOT' ? 'Gate 現貨' : 'Bybit 現貨';
  const label = signal.bigFish?.entry ? bigFishLabel(signal.bigFish) : PHASE_LABELS[signal.phase];
  const derivative = signal.derivatives && signal.derivatives.status !== 'UNAVAILABLE'
    ? DERIVATIVE_LABELS[signal.derivatives.status] : '永續籌碼待確認';
  return `🟢 *${snapshot.symbol}｜${label}*\n` +
    `進場參考 ${number(signal.price)} USDT｜失效參考 ${number(signal.invalidation)} USDT\n` +
    `${PHASE_LABELS[signal.phase]}｜量能 ${number(signal.volumeRatio)} 倍｜${derivative}\n` +
    `${close.label} ${closedAt}（台北）｜${source}\n` +
    '已收盤觀察，非下單指令。';
}

/** 新候選使用精簡 Block Kit 卡片；詳細指標仍可回雷達頁查看。 */
export function formatPotentialCard(snapshot: RadarSnapshot) {
  const signal = snapshot.signal!;
  const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '尚無' : value.toPrecision(6);
  const close = signalClose(signal);
  const closedAt = new Date(close.at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const source = signal.source === 'GATE_SPOT' ? 'Gate 現貨' : 'Bybit 現貨';
  const label = signal.bigFish?.entry ? `經典${bigFishLabel(signal.bigFish)}` : PHASE_LABELS[signal.phase];
  const derivative = signal.derivatives && signal.derivatives.status !== 'UNAVAILABLE'
    ? DERIVATIVE_LABELS[signal.derivatives.status] : '永續籌碼待確認';
  return serializeSlackCard(createCryptoSignalCard({
    icon: signal.bigFish?.entry ? '🐟' : '🟢', title: `${snapshot.symbol}｜潛力幣雷達`, signal: label,
    price: `${number(signal.price)} USDT`, closedAt: `${closedAt}（台北）`, closedLabel: close.label,
    invalidation: `${number(signal.invalidation)} USDT`,
    strength: `量能 ${number(signal.volumeRatio)} 倍｜4h＋日線共振｜${derivative}`,
    risk: signal.risks[0] ?? '未偵測到額外風控提示；仍須留意滑價與行情反轉', source,
  }));
}
