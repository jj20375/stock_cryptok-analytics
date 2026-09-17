/** @file Gate 永續吃大魚訊號的 Slack 文案；明確區分原始觸發與趨勢確認。 */
import { bigFishLabel } from '../potentialRadar/bigFish';
import { PERP_QUARTER_MS, type PerpSignalEvent } from './types';
import { createCryptoSignalCard, serializeSlackCard } from '../slack/cryptoSignalCard';

/** 價格與百分比只呈現已驗證的有限數值，避免外部異常內容進入 Slack。 */
export function formatPerpSignalMessage(event: PerpSignalEvent) {
  const { quality, signal, ticker } = event;
  const number = (value: number) => Number.isFinite(value) ? value.toPrecision(7) : '尚無';
  const percent = (value: number | null) => value === null || !Number.isFinite(value) ? '歷史不足' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const closedAt = new Date(signal.barTime + PERP_QUARTER_MS).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false,
  });
  const trigger = bigFishLabel(signal);
  const conflict = signal.exitLong ? '｜⚠ 同根仍為 ST 紅色，等待方向確認' : '';
  const grade = quality.grade === 'BEST' ? '⭐ 最佳型 · 底部紅轉綠'
    : quality.grade === 'TREND_FLIP' ? '🟢 趨勢翻綠型' : '🟣 一般 MACD 提早型';
  const icon = quality.grade === 'BEST' ? '⭐' : quality.grade === 'TREND_FLIP' ? '🟢' : '🟣';
  return `${icon} *${ticker.symbol}.P｜${trigger}*\n` +
    `進場參考 ${number(event.markPrice)} USDT｜失效參考 ${number(signal.supertrend)} USDT\n` +
    `${grade}｜距 EMA200 ${percent(quality.emaDistancePct)}｜前紅 ${quality.priorRedBars} 根${conflict}\n` +
    `15 分收盤 ${closedAt}（台北）｜Gate Mark Price\n` +
    '已收盤觀察，非下單指令。';
}

/** 新通知保存為 Block Kit 卡片；text 保留精簡 fallback，供手機通知與舊 Slack 用戶端顯示。 */
export function formatPerpSignalCard(event: PerpSignalEvent) {
  const { quality, signal, ticker } = event;
  const number = (value: number) => Number.isFinite(value) ? value.toPrecision(7) : '尚無';
  const percent = (value: number | null) => value == null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const closedAt = new Date(signal.barTime + PERP_QUARTER_MS).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const grade = quality.grade === 'BEST' ? '最佳型 · 底部紅轉綠' : quality.grade === 'TREND_FLIP' ? '趨勢翻綠型' : 'MACD 提早型';
  const icon = quality.grade === 'BEST' ? '⭐' : quality.grade === 'TREND_FLIP' ? '🟢' : '🟣';
  return serializeSlackCard(createCryptoSignalCard({
    icon, title: `${ticker.symbol}.P｜經典吃大魚`, signal: `${bigFishLabel(signal)} · ${grade}`,
    price: `${number(event.markPrice)} USDT`, closedAt: `${closedAt}（台北）`,
    invalidation: `${number(signal.supertrend)} USDT（ST）`,
    strength: `距 EMA200 ${percent(quality.emaDistancePct)}｜觸發前紅色 ${quality.priorRedBars} 根｜前 4h ${percent(quality.prior4hChangePct)}`,
    risk: signal.exitLong ? '同根仍為 Supertrend 紅色，等待方向確認' : '未經現貨深度與 4h／日線共振確認',
    source: 'Gate USDT 永續 Mark Price',
  }));
}
