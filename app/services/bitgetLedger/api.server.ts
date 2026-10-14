/** @file 固定 Bitget 官方 GET 端點，不接受任意 URL、下單或提領指令。 */
import { BitgetApiError, bitgetSignedGet } from '../bitgetService';
import { normalizeBill, normalizeFill, normalizeOrder, normalizeSnapshot, objectRow } from './normalize';
import type { Credentials, Dialect, Order, Scope, Stream, SyncCursor } from './types';
export function ledgerGet(path: string, credentials: Credentials, scope: Scope) {
  return bitgetSignedGet(path, credentials.apiKey, credentials.apiSecret, credentials.passphrase, { demo: scope.environment === 'DEMO' });
}
export async function detectLedgerDialect(credentials: Credentials, scope: Scope): Promise<Dialect> {
  try {
    await ledgerGet('/api/v3/account/settings', credentials, scope);
    return 'UTA_V3';
  } catch (error) {
    /** 40084 明確表示 Classic 不能使用 UTA；保留 40099 舊相容分支，其他錯誤不能降級掩蓋。 */
    if (!(error instanceof BitgetApiError) || !['40084', '40099'].includes(error.code)) throw error;
    await ledgerGet('/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT', credentials, scope);
    return 'CLASSIC_V2';
  }
}
const endpoints = {
  UTA_V3: { orders: '/api/v3/trade/history-orders', fills: '/api/v3/trade/fills', bills: '/api/v3/account/financial-records' },
  CLASSIC_V2: { orders: '/api/v2/mix/order/orders-history', fills: '/api/v2/mix/order/fills', bills: '/api/v2/mix/account/bill' },
} as const;
export async function fetchLedgerPage(stream: Stream, cursor: SyncCursor, dialect: Dialect, credentials: Credentials, scope: Scope) {
  const params = new URLSearchParams({ [dialect === 'UTA_V3' ? 'category' : 'productType']: 'USDT-FUTURES',
    startTime: String(cursor.start), endTime: String(cursor.end), limit: '100' });
  const previous = cursor.pages[stream].cursor;
  if (previous) params.set(dialect === 'UTA_V3' ? 'cursor' : 'idLessThan', previous);
  const data = objectRow(await ledgerGet(`${endpoints[dialect][stream]}?${params}`, credentials, scope));
  const raw = dialect === 'UTA_V3' ? data.list : data[stream === 'orders' ? 'entrustedList' : stream === 'fills' ? 'fillList' : 'bills'];
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('交易所分頁格式不正確');
  const next = data[dialect === 'UTA_V3' ? 'cursor' : 'endId'];
  if (raw.length && next && (typeof next !== 'string' || next === previous)) throw new Error('交易所游標未推進');
  if (raw.length === 100 && !next) throw new Error('交易所缺少下一頁游標');
  return { rows: raw.map(row => stream === 'fills' ? normalizeFill(row, dialect) : stream === 'orders' ? normalizeOrder(row, dialect) : normalizeBill(row, dialect)),
    next: typeof next === 'string' && next ? next : null, done: raw.length === 0 || !next };
}
export async function fetchLedgerSnapshot(dialect: Dialect, credentials: Credentials, scope: Scope) {
  const path = dialect === 'UTA_V3' ? '/api/v3/position/current-position?category=USDT-FUTURES'
    : '/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT';
  return normalizeSnapshot(await ledgerGet(path, credentials, scope), dialect);
}
/** 未成交與部分成交不一定出現在 history；每輪讀取並明示上限，不以缺席推定撤單。 */
export async function fetchOpenLedgerOrders(dialect: Dialect, credentials: Credentials, scope: Scope) {
  const statuses = dialect === 'UTA_V3' ? [null] : ['live', 'partially_filled'];
  const orders: Order[] = [];
  for (const status of statuses) {
    const params = new URLSearchParams({ [dialect === 'UTA_V3' ? 'category' : 'productType']: 'USDT-FUTURES', limit: '100' });
    if (status) params.set('status', status);
    const path = dialect === 'UTA_V3' ? '/api/v3/trade/unfilled-orders' : '/api/v2/mix/order/orders-pending';
    const data = objectRow(await ledgerGet(`${path}?${params}`, credentials, scope));
    const rows = data[dialect === 'UTA_V3' ? 'list' : 'entrustedList'];
    if (!Array.isArray(rows) || rows.length >= 100) throw new Error('待成交委託超出單輪完整讀取上限');
    orders.push(...rows.map(row => normalizeOrder(row, dialect)));
  }
  return [...new Map(orders.map(order => [order.exchangeId, order])).values()];
}
