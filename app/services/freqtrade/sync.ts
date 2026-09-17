/**
 * Freqtrade 同步資料的驗證與正規化。
 *
 * 同步端點只接受獨立主機送來的「研究／模擬結果」，絕不接受下單指令。HMAC 訊息包含
 * 原始 body 與毫秒時間戳，避免內容被改寫；五分鐘有效期則降低舊封包重放的風險。
 */

const textEncoder = new TextEncoder();
export const FREQTRADE_SYNC_MAX_BODY_BYTES = 32_768;
export const FREQTRADE_SYNC_MAX_AGE_MS = 5 * 60 * 1000;

export type FreqtradeMode = 'BACKTEST' | 'DRY_RUN';
export type FreqtradeStatus = 'RUNNING' | 'STOPPED' | 'ERROR';

export interface FreqtradeMetrics {
  totalTrades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number | null;
  netProfitPct: number | null;
  openTrades: number;
}

export interface FreqtradeSyncPayload {
  schemaVersion: 1;
  runId: string;
  mode: FreqtradeMode;
  strategyVersion: string;
  strategyName: string;
  exchange: string;
  timeframe: '5m' | '15m' | '1h' | '4h' | '1d';
  status: FreqtradeStatus;
  generatedAt: number;
  metrics: FreqtradeMetrics;
  research?: FreqtradeResearchContext;
}

/** 研究範圍與成本假設必須跟績效一起保存，不能把不同策略的勝率混用。 */
export interface FreqtradeResearchContext {
  pairs: string[];
  periodStart: number | null;
  periodEnd: number;
  engineVersion: string;
  configurationId: string;
  feeRate: number | null;
  slippageBps: number | null;
}

type RecordValue = Record<string, unknown>;
const MODES = new Set<FreqtradeMode>(['BACKTEST', 'DRY_RUN']);
const STATUSES = new Set<FreqtradeStatus>(['RUNNING', 'STOPPED', 'ERROR']);
const TIMEFRAMES = new Set<FreqtradeSyncPayload['timeframe']>(['5m', '15m', '1h', '4h', '1d']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

function readSafeText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} 格式不正確`);
  }
  return value.trim();
}

function readInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} 必須是有效整數`);
  }
  return value;
}

function readFiniteOrNull(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} 超出允許範圍`);
  }
  return value;
}

/** 將不可信任 JSON 縮成 UI 需要的有限欄位，避免外部主機把任意內容寫進 D1。 */
export function parseFreqtradeSyncPayload(value: unknown, now = Date.now()): FreqtradeSyncPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('payload 必須是物件');
  const body = value as RecordValue;
  if (body.schemaVersion !== 1) throw new Error('不支援的 schemaVersion');
  const runId = readSafeText(body.runId, 'runId', 128);
  if (!SAFE_IDENTIFIER.test(runId)) throw new Error('runId 含有不允許字元');
  const mode = body.mode;
  if (typeof mode !== 'string' || !MODES.has(mode as FreqtradeMode)) throw new Error('mode 不支援');
  const status = body.status;
  if (typeof status !== 'string' || !STATUSES.has(status as FreqtradeStatus)) throw new Error('status 不支援');
  const timeframe = body.timeframe;
  if (typeof timeframe !== 'string' || !TIMEFRAMES.has(timeframe as FreqtradeSyncPayload['timeframe'])) {
    throw new Error('timeframe 不支援');
  }
  const generatedAt = readInteger(body.generatedAt, 'generatedAt', now - 365 * 86400000, now + 5 * 60 * 1000);
  if (!body.metrics || typeof body.metrics !== 'object' || Array.isArray(body.metrics)) throw new Error('metrics 格式不正確');
  const metrics = body.metrics as RecordValue;
  const totalTrades = readInteger(metrics.totalTrades, 'metrics.totalTrades', 0, 1_000_000);
  const research = body.research == null ? undefined : parseResearch(body.research, generatedAt);
  return {
    schemaVersion: 1,
    runId,
    mode: mode as FreqtradeMode,
    strategyVersion: readSafeText(body.strategyVersion, 'strategyVersion', 80),
    strategyName: readSafeText(body.strategyName, 'strategyName', 120),
    exchange: readSafeText(body.exchange, 'exchange', 40),
    timeframe: timeframe as FreqtradeSyncPayload['timeframe'],
    status: status as FreqtradeStatus,
    generatedAt,
    metrics: {
      totalTrades,
      winRatePct: readFiniteOrNull(metrics.winRatePct, 'metrics.winRatePct', 0, 100),
      profitFactor: readFiniteOrNull(metrics.profitFactor, 'metrics.profitFactor', 0, 10_000),
      maxDrawdownPct: readFiniteOrNull(metrics.maxDrawdownPct, 'metrics.maxDrawdownPct', 0, 100),
      netProfitPct: readFiniteOrNull(metrics.netProfitPct, 'metrics.netProfitPct', -100, 1_000_000),
      openTrades: readInteger(metrics.openTrades, 'metrics.openTrades', 0, 1_000),
    },
    ...(research ? { research } : {}),
  };
}

function parseResearch(value: unknown, generatedAt: number): FreqtradeResearchContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('research 格式不正確');
  const r = value as RecordValue;
  if (!Array.isArray(r.pairs) || r.pairs.length > 100 || !r.pairs.every(pair => typeof pair === 'string' && /^[A-Z0-9]{1,20}\/USDT$/.test(pair))) {
    throw new Error('research.pairs 格式不正確');
  }
  const periodEnd = readInteger(r.periodEnd, 'periodEnd', 0, generatedAt);
  return {
    pairs: [...new Set(r.pairs as string[])],
    periodStart: r.periodStart === null ? null : readInteger(r.periodStart, 'periodStart', 0, periodEnd),
    periodEnd,
    engineVersion: readSafeText(r.engineVersion, 'engineVersion', 80),
    configurationId: readSafeText(r.configurationId, 'configurationId', 128),
    feeRate: readFiniteOrNull(r.feeRate, 'feeRate', 0, 1),
    slippageBps: readFiniteOrNull(r.slippageBps, 'slippageBps', 0, 10_000),
  };
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** HMAC 使用十六進位字串，方便最小化 Python 橋接器的相依套件。 */
export async function createFreqtradeSignature(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(`${timestamp}.${rawBody}`)));
}

/** 固定長度逐字比較，避免直接比較字串暴露過多簽章比對時間差。 */
function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyFreqtradeSignature(
  secret: string | undefined,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  now = Date.now(),
): Promise<boolean> {
  if (!secret || !timestamp || !/^\d{13}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > FREQTRADE_SYNC_MAX_AGE_MS) return false;
  return timingSafeEqual(await createFreqtradeSignature(secret, timestamp, rawBody), signature);
}
