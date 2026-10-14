/** @file 憑證只解密於伺服器；帳戶指紋隔離金鑰輪替前後的帳本。 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users, bitgetLedgerAccounts } from '../../db/schema';
import { decryptData } from '../../utils/encryption';
import type { CryptoFuturesTradingEnv } from '../cryptoAutoTrading/types';
import type { Credentials, Scope } from './types';
export type LedgerEnv = CryptoFuturesTradingEnv & { GEMINI_API_KEY?: string; GEMINI_REVIEW_MODEL?: string };
export async function digestText(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function loadLedgerCredentials(env: LedgerEnv, userId: number, environment: Scope['environment']) {
  const user = await drizzle(env.DB).select().from(users).where(eq(users.id, userId)).get();
  if (!user || !env.MASTER_ENCRYPTION_KEY) throw new Error('帳戶或系統加密設定未完成');
  const encrypted = environment === 'DEMO'
    ? [user.bitgetDemoApiKey, user.bitgetDemoApiSecret, user.bitgetDemoPassphrase]
    : [user.bitgetFuturesLiveApiKey, user.bitgetFuturesLiveApiSecret, user.bitgetFuturesLivePassphrase];
  if (!encrypted.every(Boolean)) throw new Error(`請先在設定填妥 Bitget ${environment} 合約憑證`);
  const decrypted = await Promise.all(encrypted.map(value => decryptData(value!, env.MASTER_ENCRYPTION_KEY!)));
  const credentials: Credentials = { apiKey: decrypted[0], apiSecret: decrypted[1], passphrase: decrypted[2] };
  const scope: Scope = { id: await digestText(`${userId}:${environment}:${credentials.apiKey}`), userId, environment };
  return { scope, credentials };
}
/** 在送單之前登記範圍；沒有憑證的排程不會掃描其他使用者帳戶。 */
export async function registerLedgerAccount(env: LedgerEnv, scope: Scope) {
  await drizzle(env.DB).insert(bitgetLedgerAccounts).values({ ...scope, createdAt: Date.now() }).onConflictDoNothing().run();
}
