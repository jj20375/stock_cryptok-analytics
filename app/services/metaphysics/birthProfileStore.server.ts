/**
 * @file 生辰加密存取。副作用：讀寫 D1 `user_birth_profiles`、刪除時一併清除該使用者的 AI 解說快取。
 * 生辰屬個人敏感資料，整包加密（含性別）；解密失敗視同未填，不讓頁面崩潰。
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { metaphysicsNarrativeCache, userBirthProfiles } from '../../db/metaphysicsSchema';
import { decryptData, encryptData } from '../../utils/encryption';
import type { BirthInput } from './baziProfile';

/** Cloudflare D1 binding（與 macro/snapshotStore 相同寫法，避免直接依賴 workers-types）。 */
export type D1Binding = Parameters<typeof drizzle>[0];

export async function saveBirthProfile(db: D1Binding, masterKey: string | undefined, userId: number, input: BirthInput, now = Date.now()): Promise<void> {
  if (!masterKey) throw new Error('未設定 MASTER_ENCRYPTION_KEY，無法加密保存生辰');
  const encryptedPayload = await encryptData(JSON.stringify(input), masterKey);
  await drizzle(db).insert(userBirthProfiles).values({ userId, encryptedPayload, updatedAt: now })
    .onConflictDoUpdate({ target: userBirthProfiles.userId, set: { encryptedPayload, updatedAt: now } }).run();
  // 生辰變了，舊的個人解說不再適用。
  await drizzle(db).delete(metaphysicsNarrativeCache).where(eq(metaphysicsNarrativeCache.userId, userId)).run();
}

export async function loadBirthProfile(db: D1Binding, masterKey: string | undefined, userId: number): Promise<BirthInput | null> {
  const row = await drizzle(db).select().from(userBirthProfiles).where(eq(userBirthProfiles.userId, userId)).get();
  if (!row) return null;
  if (!masterKey) { console.error('[Metaphysics] 未設定 MASTER_ENCRYPTION_KEY，無法解密生辰'); return null; }
  try {
    return JSON.parse(await decryptData(row.encryptedPayload, masterKey)) as BirthInput;
  } catch (error) {
    console.error('[Metaphysics] 生辰解密失敗，視同未填', error);
    return null;
  }
}

export async function deleteBirthProfile(db: D1Binding, userId: number): Promise<void> {
  await drizzle(db).delete(userBirthProfiles).where(eq(userBirthProfiles.userId, userId)).run();
  await drizzle(db).delete(metaphysicsNarrativeCache).where(eq(metaphysicsNarrativeCache.userId, userId)).run();
}
