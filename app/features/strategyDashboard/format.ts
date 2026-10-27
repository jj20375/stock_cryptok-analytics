/** @file 即時戰略 Dashboard 的顯示格式工具；只做數字與時間轉換，不含任何行情計算。 */
import type { DashboardMarket } from '../../services/strategyDashboard/types';

export const MARKET_LABELS: Record<DashboardMarket, string> = { TW: '台股', US: '美股', CRYPTO: '虛擬幣' };
/** 報價幣別：台股新台幣、美股美元、虛擬幣以 USDT 計價。 */
export const CURRENCY_PREFIX: Record<DashboardMarket, string> = { TW: 'NT$', US: '$', CRYPTO: '' };
export const CURRENCY_SUFFIX: Record<DashboardMarket, string> = { TW: '', US: '', CRYPTO: ' USDT' };

/** 價格位數依價位調整：虛擬幣小幣可能低於 0.01，需保留有效位數，避免進場區間顯示成 0。 */
export function formatPrice(market: DashboardMarket, value: number) {
  const digits = value >= 100 ? 2 : value >= 1 ? 3 : 6;
  const text = value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: value >= 100 ? 2 : 0 });
  return `${CURRENCY_PREFIX[market]}${text}${CURRENCY_SUFFIX[market]}`;
}

export const formatPct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

/** 所有時間一律以台北時間顯示，避免與排程（Asia/Taipei）對不上。 */
export const formatTaipei = (time: number, withSeconds = false) => new Date(time).toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  ...(withSeconds ? { second: '2-digit' } : {}),
});

/** 相對時間（例如「12 分鐘前」）；now 由畫面每 30 秒更新一次。 */
export function formatAgo(time: number, now: number) {
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}
