import { isFreshStockNotice } from '../stockSignalFreshness';
/** @file 美股候選的獨立 Slack 通知選擇與內容；不含下單指令或券商操作。 */
import { bigFishLabel } from '../strategy/bigFish';
import { createCryptoSignalCard, serializeSlackCard } from '../slack/cryptoSignalCard';
import { isUsStockCandidate, US_STOCK_PHASE_LABELS,
  type UsStockSnapshot } from './types';

export type UsStockNoticeKey = 'BIG_FISH' | 'BREAKOUT' | 'RETEST' | 'CANDIDATE';

/** 經典吃大魚每個新觸發根都提醒；一般候選只在新入選或突破／回踩升級時提醒。 */
export function selectUsStockNotice(next: UsStockSnapshot, previous: UsStockSnapshot | null): UsStockNoticeKey | null {
  if (!next.signal || next.error || !isUsStockCandidate(next.signal)) return null;
  // 掃描重試不得將尚未收盤或過時事件當成即時進場；使用快照時間確保離線重算一致。
  if (!isFreshStockNotice(next.signal.closedAt, next.checkedAt)) return null;
  if (previous?.signal?.barTime === next.signal.barTime) return null;
  if (next.signal.bigFish.entry) return 'BIG_FISH';
  if (next.signal.phase === 'BREAKOUT' && previous?.signal?.phase !== 'BREAKOUT') return 'BREAKOUT';
  if (next.signal.phase === 'RETEST' && previous?.signal?.phase !== 'RETEST') return 'RETEST';
  return previous?.signal && isUsStockCandidate(previous.signal) ? null : 'CANDIDATE';
}

/** 訊息明示收盤時間、研究失效價與風險，避免把雷達排名解讀為保證獲利。 */
export function formatUsStockMessage(snapshot: UsStockSnapshot) {
  const signal = snapshot.signal!;
  const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: value >= 100 ? 2 : 4 });
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const closedAt = new Date(signal.closedAt).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false,
  });
  const label = signal.bigFish.entry ? `經典${bigFishLabel(signal.bigFish)}` : US_STOCK_PHASE_LABELS[signal.phase];
  return `📈 *美股潛力雷達｜${snapshot.symbol} ${snapshot.name}｜${label}*\n` +
    `*4 小時收盤* ${closedAt}（台北）｜進場參考 $${number(signal.price)}｜當日 ${signed(signal.changeDay)}\n` +
    `*品質分數* ${signal.score}/100｜量能 ${signal.volumeRatio.toFixed(2)} 倍｜20 日相對 SPY ${signed(signal.relative20d)}\n` +
    `*趨勢* 個股日線 ${signal.dailyTrendUp ? '多頭' : '未確認'}｜SPY ${signal.marketTrendUp ? '多頭' : '市場逆風'}\n` +
    `*依據* ${signal.reasons.join('；')}\n` +
    `*結構失效參考* $${number(signal.invalidation)}\n` +
    `*風控提示* ${signal.risks.length ? signal.risks.join('；') : '尚未偵測到額外風控提示'}\n` +
    '此為已收盤公開行情觀察，非下單指令；美股可能跳空，槓桿 ETF 另有波動耗損。';
}

/** 新通知以精簡卡片保存；沿用 D1 message 欄位，舊純文字佇列仍可相容補送。 */
export function formatUsStockCard(snapshot: UsStockSnapshot) {
  const signal = snapshot.signal!;
  const number = (value: number) => value.toLocaleString('en-US', {
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: value >= 100 ? 2 : 4,
  });
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const closedAt = new Date(signal.closedAt).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false,
  });
  const label = signal.bigFish.entry ? `經典${bigFishLabel(signal.bigFish)}` : US_STOCK_PHASE_LABELS[signal.phase];
  const icon = signal.bigFish.entry ? '⭐' : signal.phase === 'BREAKOUT' ? '🚀' : '📈';
  const trend = `個股日線 ${signal.dailyTrendUp ? '偏多' : '未確認'}｜SPY ${signal.marketTrendUp ? '偏多' : '逆風'}`;
  const risks = signal.risks.length ? signal.risks.join('；') : '未偵測到額外風控提示';
  /** 美股可能隔夜跳空，槓桿 ETF 另有每日重設與波動耗損，卡片固定保留此風險。 */
  const leverageRisk = /(?:2X|3X|ULTRA|BULL|BEAR)/i.test(`${snapshot.symbol} ${snapshot.name}`)
    ? '；槓桿 ETF 有每日重設與波動耗損' : '';

  return serializeSlackCard(createCryptoSignalCard({
    icon,
    title: `${snapshot.symbol} · ${snapshot.name}`,
    signal: `${label}｜${US_STOCK_PHASE_LABELS[signal.phase]}`,
    price: `$${number(signal.price)}`,
    closedAt: `${closedAt}（台北）`,
    closedLabel: '4 小時收盤',
    invalidation: `$${number(signal.invalidation)}`,
    strength: `品質 ${signal.score}/100｜量能 ${signal.volumeRatio.toFixed(2)}x｜相對 SPY ${signed(signal.relative20d)}｜當日 ${signed(signal.changeDay)}`,
    risk: `${trend}｜${risks}；美股可能跳空${leverageRisk}`,
    source: '系統自算 · Yahoo Finance 美股公開行情',
  }));
}
