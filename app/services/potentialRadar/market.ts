/** @file Bybit 現貨公開行情；固定來源、逾時與新鮮度檢查，失敗時不以舊資料冒充訊號。 */
import { closedSeries } from './analysis';
import { gateUniverse, gateCandles, gateDepth } from './gateMarket';
import { QUARTER_MS, RADAR_RULES, type MarketTicker, type RadarCandle, type RadarDepth } from './types';

/** 第一版限定 Bybit USDT 現貨；穩定幣及槓桿代幣不納入潛力榜。 */
const STABLE_BASES = new Set(['USDT', 'USDC', 'DAI', 'USDE', 'USD1', 'FDUSD', 'TUSD', 'USDD', 'PYUSD', 'BUSD', 'EUR', 'EURC', 'XAUT', 'PAXG']);

async function publicMarket<T>(path: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(`https://api.bybit.com/v5/market/${path}?${new URLSearchParams({ category: 'spot', ...params })}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('Bybit 行情暫時無法取得');
  const payload = await response.json() as { retCode: number; time: number; result: T };
  if (payload.retCode !== 0 || !Number.isFinite(payload.time) || Math.abs(Date.now() - payload.time) > 120_000) {
    throw new Error('Bybit 回應異常或行情已過期');
  }
  return payload.result;
}

/** 兩個批次請求發現當前可交易市場；不把名單外或已下架幣當作正常候選。 */
export async function fetchUniverse(source: 'BYBIT_SPOT' | 'GATE_SPOT' = 'BYBIT_SPOT'): Promise<MarketTicker[]> {
  if (source === 'GATE_SPOT') return gateUniverse(STABLE_BASES);
  const [instruments, tickers] = await Promise.all([
    publicMarket<{ list: { symbol: string; baseCoin: string; quoteCoin: string; status: string }[] }>('instruments-info', {}),
    publicMarket<{ list: { symbol: string; lastPrice: string; turnover24h: string; price24hPcnt: string; bid1Price: string; ask1Price: string }[] }>('tickers', {}),
  ]);
  const tradable = new Set(instruments.list.filter(i => i.status === 'Trading' && i.quoteCoin === 'USDT' &&
    !STABLE_BASES.has(i.baseCoin) && !/(?:[235][LS]|UP|DOWN|BULL|BEAR)$/.test(i.baseCoin)).map(i => i.symbol));
  return tickers.list.filter(t => tradable.has(t.symbol)).map(t => {
    const bid = Number(t.bid1Price);
    const ask = Number(t.ask1Price);
    return { symbol: t.symbol, price: Number(t.lastPrice), turnover24h: Number(t.turnover24h),
      change24h: Number(t.price24hPcnt) * 100,
      spreadPct: bid > 0 && ask >= bid ? (ask - bid) / ((ask + bid) / 2) * 100 : Infinity };
  }).filter(t => [t.price, t.turnover24h, t.change24h, t.spreadPct].every(Number.isFinite) && t.price > 0 &&
    t.turnover24h >= RADAR_RULES.minTurnover && t.spreadPct <= RADAR_RULES.maxSpreadPct);
}

/** 1000 根約十天，單次請求同時供多週期分析與七天觀察補算；不跨來源拼接。 */
export async function fetchRadarCandles(symbol: string, cutoff: number, source: 'BYBIT_SPOT' | 'GATE_SPOT' = 'BYBIT_SPOT'): Promise<RadarCandle[]> {
  if (source === 'GATE_SPOT') return gateCandles(symbol, cutoff);
  const result = await publicMarket<{ list: string[][] }>('kline', {
    symbol, interval: '15', limit: '1000', end: String(cutoff - 1),
  });
  const candles = result.list.map(row => ({ openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
    low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), turnover: Number(row[6]) }));
  return closedSeries(candles, cutoff);
}

/** 深度是當下掛單快照；不代表歷史收盤時的深度，也不能保證實際成交。 */
export async function fetchRadarDepth(symbol: string, source: 'BYBIT_SPOT' | 'GATE_SPOT' = 'BYBIT_SPOT'): Promise<RadarDepth> {
  if (source === 'GATE_SPOT') return gateDepth(symbol);
  const book = await publicMarket<{ b: string[][]; a: string[][]; ts: number }>('orderbook', { symbol, limit: '50' });
  if (!Number.isFinite(book.ts) || Math.abs(Date.now() - book.ts) > 60_000) throw new Error('掛單深度已過期');
  const bid = Number(book.b[0]?.[0]);
  const ask = Number(book.a[0]?.[0]);
  if (!(bid > 0 && ask >= bid)) throw new Error('掛單深度缺少有效買賣價');
  const mid = (bid + ask) / 2;
  const depth = (levels: string[][]) => levels.reduce((total, [p, q]) => {
    const price = Number(p);
    const quantity = Number(q);
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity < 0) throw new Error('掛單深度資料無效');
    return total + (Math.abs(price / mid - 1) <= 0.01 ? price * quantity : 0);
  }, 0);
  return { bid: depth(book.b), ask: depth(book.a), spreadPct: (ask - bid) / mid * 100 };
}

/** 十二檔初篩：四檔漲幅、四檔成交額、四檔輪替探索，避免只追逐已暴漲標的。 */
export function selectCandidates(universe: MarketTicker[], cutoff: number): MarketTicker[] {
  const moves = [...universe].sort((a, b) => b.change24h - a.change24h || a.symbol.localeCompare(b.symbol));
  const liquid = [...universe].sort((a, b) => b.turnover24h - a.turnover24h || a.symbol.localeCompare(b.symbol));
  const chosen = new Map<string, MarketTicker>();
  for (const coin of moves.filter(c => c.change24h > 0).slice(0, 4)) chosen.set(coin.symbol, coin);
  for (const coin of liquid.filter(c => !chosen.has(c.symbol)).slice(0, 4)) chosen.set(coin.symbol, coin);
  const remaining = universe.filter(c => !chosen.has(c.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const offset = remaining.length ? (Math.floor(cutoff / QUARTER_MS) * 4) % remaining.length : 0;
  const rotated = [...remaining.slice(offset), ...remaining.slice(0, offset)];
  for (const coin of rotated.slice(0, 12 - chosen.size)) chosen.set(coin.symbol, coin);
  return [...chosen.values()];
}
