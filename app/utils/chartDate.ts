/** @file 圖表與訊號日期顯示繁體中文年月日；呼叫端保留市場時區，避免跨日偏移。 */
/** 時區依市場的交易日界線選擇；US/TW 是現貨，股票永續與加密貨幣採 UTC。 */
export const MARKET_CHART_TIMEZONES = { US: 'America/New_York', TW: 'Asia/Taipei', CRYPTO: 'Etc/UTC' } as const;
/** 顯示名稱保留市場時間語意；實際格式化仍使用 IANA 時區以處理美東夏令時間。 */
export const CHART_TIMEZONE_LABELS: Record<string, string> = { 'America/New_York': '美東時間', 'Asia/Taipei': '台北時間', 'Etc/UTC': 'UTC' };

export function chartDateFormatter(timeZone?: string, includeTime = true): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  });
}
