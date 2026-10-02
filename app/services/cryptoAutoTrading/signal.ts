/** @file 外部 TradingView payload 的交易專用正規化；通知顯示仍可保留原始文字。 */
import type { CryptoAutoTradeSignal } from './types';

/** 只接受 Bitget USDT 永續可表達的代號，移除 TradingView 常見交易所與永續後綴。 */
export function normalizeCryptoSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutExchange = value.trim().toUpperCase().split(':').at(-1) || '';
  const normalized = withoutExchange
    .replace(/_MPRICE$/, '')
    .replace(/\.P$/, '')
    .replace(/PERP$/, '')
    .replaceAll('/', '')
    .replaceAll('-', '');
  return /^[A-Z0-9]{2,20}USDT$/.test(normalized) ? normalized : null;
}

function parseSignalTime(value: unknown, receivedAt: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return receivedAt;
}

/** 未列入白名單的 action 仍可通知，但絕不進入自動交易。SHORT 僅能觸發平多，不會開空。 */
export function tradingViewPayloadToAutoSignal(
  payload: Record<string, unknown>,
  receivedAt: number,
): CryptoAutoTradeSignal | null {
  const symbol = normalizeCryptoSymbol(payload.symbol);
  const actionRaw = typeof payload.action === 'string' ? payload.action.trim().toUpperCase() : '';
  const action = ['BUY', 'LONG'].includes(actionRaw)
    ? 'BUY'
    : ['SELL', 'CLOSE', 'EXIT', 'SHORT'].includes(actionRaw) ? 'SELL' : null;
  const numericPrice = typeof payload.price === 'number' ? payload.price : Number(payload.price);
  if (!symbol || !action || !Number.isFinite(numericPrice) || numericPrice <= 0) return null;
  const signalAt = parseSignalTime(payload.time ?? payload.bar_time ?? payload.timestamp, receivedAt);
  const eventId = typeof payload.event_id === 'string' && payload.event_id.trim()
    ? payload.event_id.trim().slice(0, 120)
    : `tv:${symbol}:${action}:${Math.floor(signalAt / 900_000)}`;
  return {
    id: eventId,
    source: 'TRADINGVIEW',
    symbol,
    action,
    signalAt,
    referencePrice: numericPrice,
    label: typeof payload.note === 'string' ? payload.note.slice(0, 160) : 'TradingView 吃大魚訊號',
  };
}
