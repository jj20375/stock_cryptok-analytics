/** @file 台股股票／ETF 白名單；在排行與策略取樣前排除權證，避免高槓桿漲幅污染股票日報。 */
export function isTwStockOrEtfCode(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  /** 股票四碼；ETF 為 00 開頭，可含主動／槓桿／反向尾碼。六碼權證及售權證尾碼不在此白名單。 */
  return /^(?:[1-9]\d{3}|00\d{2,4}[A-Z]?)$/.test(value.trim().toUpperCase());
}
