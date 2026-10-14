/** @file 嚴格正規化交易所資料；任何欄位失真都中止該頁，不能跳過後推進游標。 */
import { decimal, units } from './decimal';
import type { Bill, Dialect, Fill, Order, PositionSide, Snapshot } from './types';
type Row = Record<string, unknown>;
export function objectRow(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('交易所物件格式不正確');
  return value as Row;
}
function text(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 200) throw new Error('交易所識別欄位不正確');
  return value;
}
function numberText(value: unknown) { return decimal(units(text(value))); }
function optionalNumber(value: unknown) { return value == null || value === '' ? null : numberText(value); }
function timestamp(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000_000_000_000 || parsed > Date.now() + 86_400_000) throw new Error('交易所時間不正確');
  return parsed;
}
function symbol(value: unknown) {
  const parsed = text(value).toUpperCase();
  if (!/^[A-Z0-9]{2,40}USDT$/.test(parsed)) throw new Error('交易所商品不是 USDT 永續');
  return parsed;
}
function side(value: unknown): 'buy' | 'sell' {
  if (value !== 'buy' && value !== 'sell') throw new Error('交易方向不正確');
  return value;
}
function positionSide(value: unknown): PositionSide {
  if (value === 'long' || value === 'short') return value;
  if (value == null || value === '' || value === 'net') return 'net';
  throw new Error('持倉方向不正確');
}
export function normalizeFill(value: unknown, dialect: Dialect): Fill {
  const r = objectRow(value);
  const isUta = dialect === 'UTA_V3';
  const tradeSide = String(r.tradeSide ?? '');
  const effect = tradeSide === 'open' || tradeSide.startsWith('open_') ? 'open'
    : tradeSide === 'close' || /close|reduce_|burst_|delivery_|adl/.test(tradeSide) ? 'close' : 'unknown';
  let direction = side(r.side);
  let holding = positionSide(r.posSide);
  /** Classic hedge 的 side 指持倉方向，平多 buy 必須轉成實際 sell；UTA side 是成交方向。 */
  if (!isUta && r.posMode === 'hedge_mode') {
    holding = tradeSide.endsWith('_long') ? 'long' : tradeSide.endsWith('_short') ? 'short' : direction === 'buy' ? 'long' : 'short';
    direction = effect === 'close' ? holding === 'long' ? 'sell' : 'buy' : holding === 'long' ? 'buy' : 'sell';
  }
  const quantity = numberText(isUta ? r.execQty : r.baseVolume);
  const price = numberText(isUta ? r.execPrice : r.price);
  if (units(quantity) <= 0n || units(price) <= 0n) throw new Error('成交價量必須大於零');
  let fees: Fill['fees'] = null;
  if (Array.isArray(r.feeDetail) && r.feeDetail.length > 0 && r.feeDetail.every(value => {
    const fee = objectRow(value);
    return fee.feeCoin != null && (isUta ? fee.fee : fee.totalFee) != null;
  })) {
    fees = r.feeDetail.map(value => {
      const fee = objectRow(value);
      const amount = numberText(isUta ? fee.fee : fee.totalFee);
      /** V3 正數是扣款，V2 費用原本有現金流符號；不得 abs 以免吃掉 maker 回饋。 */
      return { coin: text(fee.feeCoin).toUpperCase(), amount: isUta ? decimal(-units(amount)) : amount };
    });
  }
  return {
    exchangeId: text(isUta ? r.execId : r.tradeId), orderId: text(r.orderId),
    clientOid: typeof r.clientOid === 'string' && r.clientOid ? r.clientOid : null,
    symbol: symbol(r.symbol), side: direction, positionSide: holding, effect, price, quantity,
    realizedPnl: optionalNumber(isUta ? r.execPnl : r.profit), fees,
    executedAt: timestamp(isUta ? r.createdTime : r.cTime),
  };
}
export function normalizeOrder(value: unknown, dialect: Dialect): Order {
  const r = objectRow(value), uta = dialect === 'UTA_V3';
  return {
    exchangeId: text(r.orderId), clientOid: typeof r.clientOid === 'string' && r.clientOid ? r.clientOid : null,
    symbol: symbol(r.symbol), side: side(r.side), positionSide: positionSide(r.posSide),
    status: text(uta ? r.orderStatus : r.status), quantity: numberText(uta ? r.qty : r.size),
    filledQuantity: numberText(uta ? r.cumExecQty : r.baseVolume),
    averagePrice: optionalNumber(uta ? r.avgPrice : r.priceAvg), updatedAt: timestamp(uta ? r.updatedTime : r.uTime),
  };
}
export function normalizeBill(value: unknown, dialect: Dialect): Bill {
  const r = objectRow(value), uta = dialect === 'UTA_V3';
  return {
    exchangeId: text(uta ? r.id : r.billId), symbol: r.symbol ? symbol(r.symbol) : null,
    coin: text(r.coin).toUpperCase(), type: text(uta ? r.type : r.businessType),
    amount: numberText(r.amount), balance: optionalNumber(r.balance), occurredAt: timestamp(uta ? r.ts : r.cTime),
  };
}
/** 只白名單合約資金費率；充值、轉帳、股息與交易損益不能再加進淨利造成重算。 */
export const isFundingBill = (bill: Bill) => [
  'contract_settle_fee', 'CONTRACT_MAIN_SETTLE_FEE_USER_IN', 'CONTRACT_MAIN_SETTLE_FEE_USER_OUT',
  'MARGIN_SETTLE_FEE_USER_IN', 'MARGIN_SETTLE_FEE_USER_OUT',
].includes(bill.type);
export function normalizeSnapshot(value: unknown, dialect: Dialect): Snapshot {
  const rows = dialect === 'UTA_V3' ? objectRow(value).list : value;
  if (!Array.isArray(rows)) throw new Error('持倉快照格式不正確');
  return { observedAt: Date.now(), positions: rows.flatMap(value => {
    const r = objectRow(value), quantity = numberText(r.total);
    if (units(quantity) === 0n) return [];
    if (units(quantity) < 0n) throw new Error('持倉數量格式不正確');
    const holding = r.posSide ?? r.holdSide;
    if (holding !== 'long' && holding !== 'short') throw new Error('快照持倉方向不正確');
    return [{ symbol: symbol(r.symbol), side: holding, quantity,
      averagePrice: numberText(r.avgPrice ?? r.openPriceAvg), unrealizedPnl: optionalNumber(r.unrealisedPnl ?? r.unrealizedPL) }];
  }) };
}
