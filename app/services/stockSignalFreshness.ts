/** @file 股票即時通知時效：與雷達行情新鮮度一致，避免休市補送過時進場價。 */
/** 最多允許收盤後 35 分鐘，涵蓋 15 分鐘排程及 Yahoo 定版延遲；不代表買進有效期限。 */
export const STOCK_NOTICE_WINDOW_MS = 35 * 60_000;
export function isFreshStockNotice(closedAt: number, now: number) {
  return Number.isFinite(closedAt) && now >= closedAt && now - closedAt < STOCK_NOTICE_WINDOW_MS;
}
