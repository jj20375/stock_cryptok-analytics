/** @file TradingView 訊號配對成紙上交易的純邏輯；不碰資料庫、不發通知、絕不下單。 */

/** 進場方向；空單報酬以進場價為分母反向計算。 */
export type TradeDirection = 'LONG' | 'SHORT';

export interface PairingSignal {
  action: string | null;
  price: number | null;
}

export interface OpenTrade {
  id: string;
  direction: TradeDirection;
  entryPrice: number;
}

export type TradeEffect =
  | { kind: 'OPEN'; direction: TradeDirection }
  | { kind: 'CLOSE'; tradeId: string; returnPct: number }
  | { kind: 'IGNORE'; reason: string };

const LONG_ENTRY = new Set(['BUY', 'LONG']);
const SHORT_ENTRY = new Set(['SHORT']);
/** SELL 在多單策略是平倉、在空單策略是進場，因此必須依「當下有無未平倉部位」判斷。 */
const EXIT_ACTIONS = new Set(['SELL', 'CLOSE', 'EXIT']);

/** 報酬率一律以進場價為分母；多單看漲幅、空單看跌幅。 */
export function computeReturnPct(direction: TradeDirection, entryPrice: number, exitPrice: number) {
  const raw = direction === 'LONG'
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  return raw * 100;
}

/**
 * 決定一則訊號對部位的影響。刻意不支援加碼與反手：
 * 同方向重複進場只保留第一筆，避免把同一段行情重複計入績效。
 */
export function resolveTradeEffect(signal: PairingSignal, openTrade: OpenTrade | null): TradeEffect {
  const action = signal.action?.trim().toUpperCase() ?? '';
  if (!action) return { kind: 'IGNORE', reason: '訊號未提供方向，無法納入績效' };
  if (signal.price == null || !Number.isFinite(signal.price) || signal.price <= 0) {
    return { kind: 'IGNORE', reason: '訊號缺少有效價格，無法計算報酬' };
  }

  const close = (): TradeEffect => ({
    kind: 'CLOSE', tradeId: (openTrade as OpenTrade).id,
    returnPct: computeReturnPct((openTrade as OpenTrade).direction, (openTrade as OpenTrade).entryPrice, signal.price as number),
  });

  if (LONG_ENTRY.has(action) || SHORT_ENTRY.has(action)) {
    const direction: TradeDirection = LONG_ENTRY.has(action) ? 'LONG' : 'SHORT';
    if (!openTrade) return { kind: 'OPEN', direction };
    /** 反向訊號視為平倉（例如做空後的 BUY 是回補）；刻意不順勢反手開新倉，避免憑空多算一筆。 */
    if (openTrade.direction !== direction) return close();
    return { kind: 'IGNORE', reason: '已有同方向未平倉部位，忽略重複進場（不支援加碼）' };
  }

  if (EXIT_ACTIONS.has(action)) {
    /** SELL 對空單而言是加碼而非平倉，只有多單才視為出場；CLOSE／EXIT 則平掉任何方向。 */
    if (openTrade && (action !== 'SELL' || openTrade.direction === 'LONG')) return close();
    if (openTrade) return { kind: 'IGNORE', reason: '空單收到 SELL 視為重複做空訊號，未平倉' };
    if (action === 'SELL') return { kind: 'OPEN', direction: 'SHORT' };
    return { kind: 'IGNORE', reason: '沒有對應的未平倉部位可平' };
  }

  return { kind: 'IGNORE', reason: `未知的方向「${action}」，僅支援 BUY／LONG／SELL／SHORT／CLOSE／EXIT` };
}
