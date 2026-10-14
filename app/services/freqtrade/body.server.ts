/** @file 同步封包串流上限；不信任 Content-Length，避免先把超大內容讀進記憶體。 */
import { FREQTRADE_SYNC_MAX_BODY_BYTES } from './sync';

/** 其他 JSON API 可指定更小的位元組上限，沿用同一串流讀取器。 */
export async function readSyncBody(request: Request, maxBytes = FREQTRADE_SYNC_MAX_BODY_BYTES): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let result = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return result + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RangeError('payload 過大');
      }
      result += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
