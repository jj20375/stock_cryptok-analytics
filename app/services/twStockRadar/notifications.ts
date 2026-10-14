import { isFreshStockNotice } from '../stockSignalFreshness';
/** @file 台股候選的獨立 Slack 通知選擇與精簡卡片；不含下單指令。 */
import { bigFishLabel } from '../strategy/bigFish';
import { createCryptoSignalCard, serializeSlackCard } from '../slack/cryptoSignalCard';
import { US_STOCK_PHASE_LABELS } from '../usStockRadar/types';
import { isTwStockCandidate, type TwStockSnapshot } from './types';

export type TwStockNoticeKey = 'BIG_FISH' | 'BREAKOUT' | 'RETEST' | 'CANDIDATE';

export function selectTwStockNotice(next: TwStockSnapshot, previous: TwStockSnapshot | null): TwStockNoticeKey | null {
  if (!next.signal || next.error || !isTwStockCandidate(next.signal)) return null;
  // 掃描重試不得將尚未收盤或過時事件當成即時進場；使用快照時間確保離線重算一致。
  if (!isFreshStockNotice(next.signal.closedAt, next.checkedAt)) return null;
  if (previous?.signal?.barTime === next.signal.barTime) return null;
  if (next.signal.bigFish.entry) return 'BIG_FISH';
  if (next.signal.phase === 'BREAKOUT' && previous?.signal?.phase !== 'BREAKOUT') return 'BREAKOUT';
  if (next.signal.phase === 'RETEST' && previous?.signal?.phase !== 'RETEST') return 'RETEST';
  return previous?.signal && isTwStockCandidate(previous.signal) ? null : 'CANDIDATE';
}

export function formatTwStockCard(snapshot: TwStockSnapshot) {
  const signal = snapshot.signal!;
  const number = (value: number) => value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const closedAt = new Date(signal.closedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const label = signal.bigFish.entry ? `經典${bigFishLabel(signal.bigFish)}` : US_STOCK_PHASE_LABELS[signal.phase];
  const icon = signal.bigFish.entry ? '⭐' : signal.phase === 'BREAKOUT' ? '🚀' : '📈';
  const code = snapshot.symbol.replace(/\.(TW|TWO)$/i, '');
  return serializeSlackCard(createCryptoSignalCard({
    icon, title: `${code} · ${snapshot.name}`,
    signal: `${label}｜${US_STOCK_PHASE_LABELS[signal.phase]}`,
    price: `NT$${number(signal.price)}`, closedAt: `${closedAt}（台北）`, closedLabel: '4 小時收盤',
    invalidation: `NT$${number(signal.invalidation)}`,
    strength: `品質 ${signal.score}/100｜量能 ${signal.volumeRatio.toFixed(2)}x｜相對 0050 ${signed(signal.relative20d)}｜當日 ${signed(signal.changeDay)}`,
    risk: `個股日線 ${signal.dailyTrendUp ? '偏多' : '未確認'}｜0050 ${signal.marketTrendUp ? '偏多' : '逆風'}｜${signal.risks.join('；') || '未偵測到額外風控提示'}；注意漲跌停與隔日跳空`,
    source: '系統自算 · Yahoo Finance／臺灣證券交易所公開行情',
  }));
}
