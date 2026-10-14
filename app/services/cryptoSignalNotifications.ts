/** @file 虛擬幣觀察訊號的共用通知政策；成交與既有持倉停損通知不受此開關影響。 */
export interface CryptoSignalNotificationEnv {
  /** 預設停用；只有明確設為 true 才允許虛擬幣觀察訊號對外推播。 */
  CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED?: string;
  CRYPTO_ENTRY_SLACK_CHANNEL_ID?: string;
}

/** 同時約束新通知建立與舊佇列補送，避免只停新訊號卻繼續送歷史訊息。 */
export function cryptoSignalSlackChannel(env: CryptoSignalNotificationEnv): string | null {
  if (env.CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED !== 'true') return null;
  return env.CRYPTO_ENTRY_SLACK_CHANNEL_ID?.trim() || null;
}
