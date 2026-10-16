/** @file 選股資料的有界讀取與短期快取；僅服務端建立的固定公開網址可作為來源。 */
import type { PublicSourceStatus } from '../stockResearch/types';

export interface BriefSource { text: string; source: PublicSourceStatus }
const cache = new Map<string, { expiresAt: number; value: BriefSource }>();
const pending = new Map<string, Promise<BriefSource>>();
/** 每筆最多 4 MiB；快取總文字上限約 12 MB，避免不同股票回應占滿 Worker 記憶體。 */
const maxBytes = 4 * 1024 * 1024;

async function readSource(label: string, url: string): Promise<BriefSource> {
  const source: PublicSourceStatus = { label, url, fetchedAt: new Date().toISOString(), status: 'ok' };
  const controller = new AbortController();
  /** 10 秒限制涵蓋下載本文，單一來源失敗會回傳缺資料而不拖住整個分析頁。 */
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    /**
     * Cloudflare Workers 不支援 redirect: 'error'（會在送出請求前就丟 TypeError，導致正式環境全部來源失敗）；
     * 改用 'manual'，3xx 不是 ok，下一行會一併視為來源無法讀取，仍不跟隨重新導向。
     */
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok || !response.body) throw new Error('來源無法讀取');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let size = 0, text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new Error('來源超出大小限制');
        text += decoder.decode(chunk.value, { stream: true });
      }
      return { text: text + decoder.decode(), source };
    } finally { await reader.cancel().catch(() => undefined); }
  } catch {
    return { text: '', source: { ...source, status: 'unavailable', message: '來源暫時無法讀取，請稍後重試。' } };
  } finally { clearTimeout(timeout); }
}

export async function fetchBriefSource(label: string, url: string): Promise<BriefSource> {
  const existing = cache.get(url);
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const running = pending.get(url);
  if (running) return running;
  const task = readSource(label, url).then(value => {
    let characters = [...cache.values()].reduce((sum, item) => sum + item.value.text.length, 0);
    while (cache.size && (cache.size >= 64 || characters + value.text.length > 6_000_000)) {
      const key = cache.keys().next().value!;
      characters -= cache.get(key)!.value.text.length;
      cache.delete(key);
    }
    /** 成功快取 5 分鐘，失敗 1 分鐘；切換股票不會為每張選股卡重抓整份官方資料。 */
    cache.set(url, { value, expiresAt: Date.now() + (value.source.status === 'ok' ? 300_000 : 60_000) });
    return value;
  }).finally(() => pending.delete(url));
  pending.set(url, task);
  return task;
}

export function sourceJson(response: BriefSource): any {
  try { return JSON.parse(response.text); }
  catch {
    if (response.source.status === 'ok') response.source = { ...response.source, status: 'unavailable', message: '來源資料格式無法辨識。' };
    return null;
  }
}
