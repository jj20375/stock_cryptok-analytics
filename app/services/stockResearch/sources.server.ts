/** @file 只讀免登入固定來源；不存取會員圖卡、字幕、Cookie 或私人資料。 */
import type { PublicSourceStatus } from './types';

export const PUBLIC_SOURCES = {
  programs: { label: '錢線百分百公開單元標題', url: 'https://news.ustv.com.tw/' },
  twRevenue: { label: '證交所月營收', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L' },
  twIncome: { label: '證交所一般業綜合損益表', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci' },
  otcRevenue: { label: '櫃買中心月營收', url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O' },
  otcIncome: { label: '櫃買中心一般業綜合損益表', url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ci' },
} as const;
type SourceKey = keyof typeof PUBLIC_SOURCES;
interface SourceResponse { text: string; source: PublicSourceStatus }
/** 僅五個固定來源的 isolate 記憶體快取；冷啟動可重抓，不當作歷史證據庫。 */
const cached = new Map<SourceKey, { expiresAt: number; response: SourceResponse }>();
const pending = new Map<SourceKey, Promise<SourceResponse>>();
/** 公開首頁約 2 MB；4 MiB 上限避免改版或惡意回應耗盡 Worker 記憶體。 */
const maxBytes = 4 * 1024 * 1024;

async function readBounded(response: Response): Promise<string> {
  if (!response.body) throw new Error('沒有內容');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error('來源內容超出大小限制');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function requestSource(key: SourceKey): Promise<SourceResponse> {
  const definition = PUBLIC_SOURCES[key];
  const source: PublicSourceStatus = { ...definition, fetchedAt: new Date().toISOString(), status: 'ok' };
  /** 逾時涵蓋讀取本文；拒絕重新導向，避免公開端點將請求帶到登入或非預期主機。 */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let result: SourceResponse;
  try {
    const response = await fetch(definition.url, {
      redirect: 'error', signal: controller.signal,
      headers: { Accept: key === 'programs' ? 'text/html' : 'application/json' },
    });
    if (!response.ok) throw new Error('公開來源暫時無法讀取');
    result = { text: await readBounded(response), source };
  } catch {
    /** 單一來源失敗只降級該來源，不以舊數字、零或 AI 推測補值。 */
    result = { text: '', source: { ...source, status: 'unavailable', message: '公開來源暫時無法讀取，請稍後重試。' } };
  } finally {
    clearTimeout(timer);
  }
  /** 成功快取 15 分鐘，失敗快取 1 分鐘；避免使用者連點對來源造成重複請求。 */
  cached.set(key, { expiresAt: Date.now() + (result.source.status === 'ok' ? 900_000 : 60_000), response: result });
  return result;
}

export async function fetchPublicSource(key: SourceKey): Promise<SourceResponse> {
  const existing = cached.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.response;
  const running = pending.get(key);
  if (running) return running;
  const request = requestSource(key).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
