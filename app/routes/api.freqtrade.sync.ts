/**
 * Freqtrade 結果同步入口。
 *
 * 此端點不可控制 Freqtrade 或交易所；它只讓獨立主機把已正規化的回測／模擬績效寫入
 * 戰情室。請勿把 Freqtrade REST API 密碼或交易所 API 金鑰傳到這裡。
 */
import type { ActionFunctionArgs } from 'react-router';
import { drizzle } from 'drizzle-orm/d1';
import { lt } from 'drizzle-orm';
import { readSyncBody } from '../services/freqtrade/body.server';
import { freqtradeRuns } from '../db/freqtradeSchema';
import {
  FREQTRADE_SYNC_MAX_BODY_BYTES,
  parseFreqtradeSyncPayload,
  verifyFreqtradeSignature,
} from '../services/freqtrade/sync';

const jsonError = (message: string, status: number) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') return jsonError('僅支援 POST', 405);
  const env = (context as any).cloudflare.env as { DB?: D1Database; FREQTRADE_SYNC_SECRET?: string };
  if (!env.DB || !env.FREQTRADE_SYNC_SECRET) {
    console.error('[Freqtrade Sync] 同步金鑰或資料庫尚未設定');
    return jsonError('同步服務尚未設定', 503);
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > FREQTRADE_SYNC_MAX_BODY_BYTES) return jsonError('payload 過大', 413);
  let rawBody: string;
  try { rawBody = await readSyncBody(request); }
  catch (error) { return jsonError('payload 無法讀取', error instanceof RangeError ? 413 : 400); }
  const isValid = await verifyFreqtradeSignature(
    env.FREQTRADE_SYNC_SECRET,
    request.headers.get('x-freqtrade-timestamp'),
    request.headers.get('x-freqtrade-signature'),
    rawBody,
  );
  if (!isValid) return jsonError('驗證失敗', 401);
  let payload;
  try { payload = parseFreqtradeSyncPayload(JSON.parse(rawBody)); }
  catch { return jsonError('payload 格式不正確', 400); }
  try {
    const syncedAt = Date.now();
    const values = {
      runId: payload.runId,
      mode: payload.mode,
      strategyVersion: payload.strategyVersion,
      strategyName: payload.strategyName,
      exchange: payload.exchange,
      timeframe: payload.timeframe,
      status: payload.status,
      generatedAt: payload.generatedAt,
      metricsJson: JSON.stringify(payload.metrics),
      researchJson: JSON.stringify(payload.research ?? {}),
      syncedAt,
    };
    /** 舊封包與重送不能倒退快照，也不能刷新心跳來偽裝服務仍在線。 */
    const changed = await drizzle(env.DB).insert(freqtradeRuns).values(values).onConflictDoUpdate({
      target: freqtradeRuns.runId,
      set: values,
      setWhere: lt(freqtradeRuns.generatedAt, payload.generatedAt),
    }).returning({ runId: freqtradeRuns.runId });
    return Response.json({ accepted: true, updated: changed.length > 0, runId: payload.runId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Freqtrade Sync] 資料庫寫入失敗');
    return jsonError('同步暫時失敗，請稍後重試', 503);
  }
}
