/** @file Gate 現貨公開行情備援；整輪鎖定來源，不與 Bybit 的量能、BTC 或深度混用。 */
import { closedFourHourSeries, closedSeries } from './analysis';
import { FOUR_HOUR_MS, QUARTER_MS, RADAR_RULES, type MarketTicker, type RadarCandle, type RadarDepth } from './types';

/** 吃大魚 4 小時線抓 300 根（約 50 天），足夠 EMA200 的 201 根並保留暖機餘裕，回應也維持精簡。 */
const FOUR_HOUR_BARS = 300;

async function getMarket<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`https://api.gateio.ws/api/v4/spot/${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Gate 現貨行情暫時無法取得（${response.status}）`);
  return response.json() as Promise<T>;
}

export async function gateUniverse(excludedBases: Set<string>): Promise<MarketTicker[]> {
  const [pairs, tickers] = await Promise.all([
    getMarket<{ id: string; base: string; quote: string; trade_status: string }[]>('currency_pairs'),
    getMarket<{ currency_pair: string; last: string; quote_volume: string; change_percentage: string; highest_bid: string; lowest_ask: string }[]>('tickers'),
  ]);
  const tradable = new Set(pairs.filter(p => p.trade_status === 'tradable' && p.quote === 'USDT' &&
    !excludedBases.has(p.base) && !/(?:[235][LS]|UP|DOWN|BULL|BEAR)$/.test(p.base)).map(p => p.id));
  return tickers.filter(t => tradable.has(t.currency_pair)).map(t => {
    const bid = Number(t.highest_bid), ask = Number(t.lowest_ask);
    return { symbol: t.currency_pair.replace('_', ''), price: Number(t.last), turnover24h: Number(t.quote_volume),
      change24h: Number(t.change_percentage), spreadPct: bid > 0 && ask >= bid ? (ask - bid) / ((ask + bid) / 2) * 100 : Infinity };
  }).filter(t => Object.values(t).slice(1).every(Number.isFinite) && t.price > 0 &&
    t.turnover24h >= RADAR_RULES.minTurnover && t.spreadPct <= RADAR_RULES.maxSpreadPct);
}

const pairName = (symbol: string) => `${symbol.slice(0, -4)}_USDT`;

export async function gateCandles(symbol: string, cutoff: number): Promise<RadarCandle[]> {
  /** 明確限制 1000 根已收盤時間格，不傳互斥的 limit；成交額使用原生 quote volume。 */
  const rows = await getMarket<string[][]>('candlesticks', { currency_pair: pairName(symbol), interval: '15m',
    from: String((cutoff - 1000 * QUARTER_MS) / 1000), to: String(Math.floor((cutoff - 1) / 1000)) });
  return closedSeries(rows.filter(r => r[7] !== 'false').map(r => ({ openTime: Number(r[0]) * 1000,
    open: Number(r[5]), high: Number(r[3]), low: Number(r[4]), close: Number(r[2]), volume: Number(r[6]), turnover: Number(r[1]) })), cutoff);
}

/** 吃大魚專用的 4 小時 K 線；與 15 分量價同一 Gate 現貨來源，不跨所拼接。 */
export async function gateFourHourCandles(symbol: string, fourHourCutoff: number): Promise<RadarCandle[]> {
  const rows = await getMarket<string[][]>('candlesticks', { currency_pair: pairName(symbol), interval: '4h',
    from: String((fourHourCutoff - FOUR_HOUR_BARS * FOUR_HOUR_MS) / 1000), to: String(Math.floor((fourHourCutoff - 1) / 1000)) });
  return closedFourHourSeries(rows.filter(r => r[7] !== 'false').map(r => ({ openTime: Number(r[0]) * 1000,
    open: Number(r[5]), high: Number(r[3]), low: Number(r[4]), close: Number(r[2]), volume: Number(r[6]), turnover: Number(r[1]) })), fourHourCutoff);
}

export async function gateDepth(symbol: string): Promise<RadarDepth> {
  const book = await getMarket<{ bids: string[][]; asks: string[][]; current: number; update: number }>('order_book',
    { currency_pair: pairName(symbol), limit: '50', with_id: 'true' });
  /** 即時快照與掛單最後更新皆須新鮮；舊掛單不能冒充目前流動性。 */
  if (![book.current, book.update].every(t => Number.isFinite(t) && Math.abs(Date.now() - t) <= 60_000)) throw new Error('Gate 掛單深度已過期');
  const bid = Number(book.bids[0]?.[0]), ask = Number(book.asks[0]?.[0]);
  if (!(bid > 0 && ask >= bid)) throw new Error('Gate 掛單缺少有效買賣價');
  const mid = (bid + ask) / 2;
  const sum = (levels: string[][]) => levels.reduce((total, [p, q]) => {
    const price = Number(p), amount = Number(q);
    if (![price, amount].every(Number.isFinite) || price <= 0 || amount < 0) throw new Error('Gate 掛單數值無效');
    return total + (Math.abs(price / mid - 1) <= 0.01 ? price * amount : 0);
  }, 0);
  return { bid: sum(book.bids), ask: sum(book.asks), spreadPct: (ask - bid) / mid * 100 };
}
