/**
 * @file AI 解說：把規則層的結果交給既有 aiService 寫成白話，每人每天每種只產生一次並快取。
 * 外部 API 副作用：呼叫 AI 供應商（依 AI_PROVIDER）。逾時或失敗時改回傳模板文字且不寫快取，下次再試。
 * 隱私：送給 AI 的內容只能是衍生標籤，不得包含出生年月日時或四柱干支。
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { metaphysicsNarrativeCache } from '../../db/metaphysicsSchema';
import type { D1Binding } from './birthProfileStore.server';

export type NarrativeKind = 'market_TW' | 'market_CRYPTO' | 'market_US' | 'bazi_profile' | 'bazi_daily';
export type NarrativeSource = 'cache' | 'ai' | 'template';

/** AI 呼叫逾時（毫秒）：解說是附加內容，等太久不如先給模板。 */
const AI_TIMEOUT_MS = 8000;

/** 共用的寫作指示：強調玄學參考、禁止個股與買賣指令。 */
const STYLE_RULES = [
  '請用繁體中文寫 120 字以內的白話解說，語氣平實。',
  '這是玄學參考，不是投資建議；不得提到任何個股、代號、價位，也不得給買進或賣出指示。',
  '只根據下列資料解說，不要自行補充其他命理推論。',
].join('\n');

export function buildNarrativePrompt(kind: NarrativeKind, facts: string[]): string {
  const subject = kind.startsWith('market_') ? '紫微斗數市場本命盤的當日四化' : '使用者八字的命局與運勢等級';
  return `${STYLE_RULES}\n主題：${subject}\n資料：\n${facts.map((f) => `- ${f}`).join('\n')}`;
}

export interface NarrativeRequest {
  db: D1Binding;
  env: Record<string, unknown>;
  /** 市場解說傳 0。 */
  userId: number;
  kind: NarrativeKind;
  /** 台北日期 YYYY-MM-DD。 */
  cacheDate: string;
  ruleVersion: string;
  facts: string[];
  /** AI 失敗時顯示的模板文字。 */
  fallback: string;
  /** 測試時注入假的 AI；預設為 aiService.getAIResponse。 */
  ai?: (prompt: string, env: Record<string, unknown>) => Promise<string>;
}

async function defaultAi(prompt: string, env: Record<string, unknown>): Promise<string> {
  const { getAIResponse } = await import('../aiService');
  return getAIResponse(prompt, {}, env);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('AI 逾時')), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getNarrative(request: NarrativeRequest): Promise<{ text: string; source: NarrativeSource }> {
  const orm = drizzle(request.db);
  const key = and(eq(metaphysicsNarrativeCache.userId, request.userId), eq(metaphysicsNarrativeCache.cacheDate, request.cacheDate),
    eq(metaphysicsNarrativeCache.kind, request.kind), eq(metaphysicsNarrativeCache.ruleVersion, request.ruleVersion));
  const cached = await orm.select().from(metaphysicsNarrativeCache).where(key).get();
  if (cached) return { text: cached.content, source: 'cache' };
  try {
    const text = (await withTimeout((request.ai ?? defaultAi)(buildNarrativePrompt(request.kind, request.facts), request.env), AI_TIMEOUT_MS)).trim();
    if (!text) throw new Error('AI 回傳空白');
    await orm.insert(metaphysicsNarrativeCache).values({ userId: request.userId, cacheDate: request.cacheDate, kind: request.kind,
      ruleVersion: request.ruleVersion, content: text, createdAt: Date.now() }).onConflictDoNothing().run();
    return { text, source: 'ai' };
  } catch (error) {
    console.error('[Metaphysics] AI 解說失敗，改用模板', error);
    return { text: request.fallback, source: 'template' };
  }
}
