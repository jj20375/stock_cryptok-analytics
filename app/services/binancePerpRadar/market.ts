/** @file USDT 永續公開行情；優先對齊 Binance Mark Price，Cloudflare 遭擋時整批改用 Gate。 */
import type { Candle } from '../strategy/types';
import {
  BINANCE_PERP_RULES,
  PERP_BAR_MS,
  type PerpMarketSource,
  type PerpTicker,
  type PerpUniverse,
} from './types';

/** 交易所 K 線週期參數；Binance 與 Gate 的 4 小時字串相同，且皆以 UTC 4 小時邊界開盤。 */
const PERP_INTERVAL = '4h';

/**
 * 歷史不足是新上市合約的永久狀態（4 小時線要約 34 天才夠 201 根），和逾時、缺根等暫時錯誤分開，
 * 讓排程把它記為略過，而不是讓整個分片永遠「未完成」而每 15 分鐘重試。
 */
export class PerpHistoryTooShortError extends Error {
  constructor() { super('Mark Price K 線歷史不足'); }
}

/** 穩定幣、貴金屬與常見槓桿代幣不作為加密貨幣趨勢候選。 */
const EXCLUDED_BASES = new Set([
  'USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'XUSD', 'EUR', 'EURC', 'XAUT', 'PAXG',
]);
const SAFE_SYMBOL = /^[A-Z0-9]{2,24}USDT$/;

async function publicJson<T>(origin: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${origin}${path}${query ? `?${query}` : ''}`, {
    signal: AbortSignal.timeout(BINANCE_PERP_RULES.requestTimeoutMs),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${new URL(origin).hostname} 公開行情 HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function validCryptoSymbol(symbol: string, baseAsset: string) {
  return SAFE_SYMBOL.test(symbol) && !EXCLUDED_BASES.has(baseAsset) &&
    !/(?:[235][LS]|UP|DOWN|BULL|BEAR)$/.test(baseAsset);
}

interface BinanceExchangeInfo {
  symbols?: Array<{
    symbol?: unknown;
    baseAsset?: unknown;
    quoteAsset?: unknown;
    status?: unknown;
    contractType?: unknown;
  }>;
}
interface BinanceTicker24h {
  symbol?: unknown;
  lastPrice?: unknown;
  priceChangePercent?: unknown;
  quoteVolume?: unknown;
}

/** Binance 與 TradingView 的 `.P Mark Price` 最接近，能連線時優先採用。 */
export async function fetchBinancePerpUniverse(): Promise<PerpUniverse> {
  const origin = 'https://fapi.binance.com';
  const [exchangeInfo, tickers] = await Promise.all([
    publicJson<BinanceExchangeInfo>(origin, '/fapi/v1/exchangeInfo'),
    publicJson<BinanceTicker24h[]>(origin, '/fapi/v1/ticker/24hr'),
  ]);
  if (!Array.isArray(exchangeInfo.symbols) || !Array.isArray(tickers)) throw new Error('Binance 永續市場清單格式異常');
  const tradable = new Map<string, string>();
  for (const contract of exchangeInfo.symbols) {
    const symbol = typeof contract.symbol === 'string' ? contract.symbol : '';
    const baseAsset = typeof contract.baseAsset === 'string' ? contract.baseAsset : '';
    if (contract.quoteAsset === 'USDT' && contract.status === 'TRADING' && contract.contractType === 'PERPETUAL' &&
      validCryptoSymbol(symbol, baseAsset)) tradable.set(symbol, baseAsset);
  }
  const result: PerpTicker[] = [];
  for (const ticker of tickers) {
    const symbol = typeof ticker.symbol === 'string' ? ticker.symbol : '';
    const baseAsset = tradable.get(symbol);
    if (!baseAsset) continue;
    const price = Number(ticker.lastPrice);
    const change24h = Number(ticker.priceChangePercent);
    const quoteVolume24h = Number(ticker.quoteVolume);
    if (![price, change24h, quoteVolume24h].every(Number.isFinite) || price <= 0 ||
      quoteVolume24h < BINANCE_PERP_RULES.minQuoteVolume) continue;
    result.push({ symbol, baseAsset, price, change24h, quoteVolume24h });
  }
  if (!result.length) throw new Error('Binance 永續市場沒有合格標的');
  return { source: 'BINANCE', tickers: result };
}

interface GateTicker24h {
  contract?: unknown;
  mark_price?: unknown;
  change_percentage?: unknown;
  volume_24h_quote?: unknown;
}
interface GateContractInfo {
  name?: unknown;
  status?: unknown;
  in_delisting?: unknown;
  contract_type?: unknown;
}

/** Gate 是 Cloudflare 可用的公開備援；切換時整個分片使用同一來源，避免資料混算。 */
export async function fetchGatePerpUniverse(): Promise<PerpUniverse> {
  const origin = 'https://api.gateio.ws';
  const [contracts, tickers] = await Promise.all([
    /** 不傳 limit 時 Gate 回傳完整清單；傳入超過 100 會被官方端點拒絕。 */
    publicJson<GateContractInfo[]>(origin, '/api/v4/futures/usdt/contracts'),
    publicJson<GateTicker24h[]>(origin, '/api/v4/futures/usdt/tickers'),
  ]);
  if (!Array.isArray(contracts) || !Array.isArray(tickers)) throw new Error('Gate 永續市場清單格式異常');
  const tradableCrypto = new Set(contracts.filter(contract => typeof contract.name === 'string' &&
    contract.status === 'trading' && contract.in_delisting !== true && contract.contract_type !== 'stocks')
    .map(contract => contract.name as string));
  const result: PerpTicker[] = [];
  for (const ticker of tickers) {
    const contract = typeof ticker.contract === 'string' ? ticker.contract : '';
    if (!tradableCrypto.has(contract)) continue;
    const match = /^([A-Z0-9]+)_USDT$/.exec(contract);
    if (!match) continue;
    const baseAsset = match[1];
    const symbol = `${baseAsset}USDT`;
    if (!validCryptoSymbol(symbol, baseAsset)) continue;
    const price = Number(ticker.mark_price);
    const change24h = Number(ticker.change_percentage);
    const quoteVolume24h = Number(ticker.volume_24h_quote);
    if (![price, change24h, quoteVolume24h].every(Number.isFinite) || price <= 0 ||
      quoteVolume24h < BINANCE_PERP_RULES.minQuoteVolume) continue;
    result.push({ symbol, baseAsset, price, change24h, quoteVolume24h });
  }
  if (!result.length) throw new Error('Gate 永續市場沒有合格標的');
  return { source: 'GATE', tickers: result };
}

/** Cloudflare 若被 Binance 地區限制或暫時拒絕，直接改用已驗證可連線的 Gate。 */
export async function fetchPerpUniverse(): Promise<PerpUniverse> {
  try {
    return await fetchBinancePerpUniverse();
  } catch {
    return fetchGatePerpUniverse();
  }
}

function rankedPerpCandidates(universe: PerpTicker[], cutoff: number): PerpTicker[] {
  const gainers = universe.filter(item => item.change24h > 0)
    .sort((a, b) => b.change24h - a.change24h || a.symbol.localeCompare(b.symbol));
  const decliners = universe.filter(item => item.change24h < 0)
    .sort((a, b) => a.change24h - b.change24h || a.symbol.localeCompare(b.symbol));
  const liquid = [...universe].sort((a, b) => b.quoteVolume24h - a.quoteVolume24h || a.symbol.localeCompare(b.symbol));
  const selected = new Map<string, PerpTicker>();
  for (const ticker of gainers.slice(0, BINANCE_PERP_RULES.topGainerSlots)) selected.set(ticker.symbol, ticker);
  /** 深跌標的只取得掃描優先權；是否進場仍須逐根符合 MACD／Supertrend 原始條件。 */
  for (const ticker of decliners.slice(0, BINANCE_PERP_RULES.topDeclinerSlots)) selected.set(ticker.symbol, ticker);
  const fixedSlots = BINANCE_PERP_RULES.topGainerSlots + BINANCE_PERP_RULES.topDeclinerSlots + BINANCE_PERP_RULES.topVolumeSlots;
  for (const ticker of liquid) {
    if (selected.size >= fixedSlots) break;
    selected.set(ticker.symbol, ticker);
  }
  const remaining = universe.filter(item => !selected.has(item.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const rotationStep = Math.max(1, BINANCE_PERP_RULES.scanLimit - selected.size);
  const offset = remaining.length ? (Math.floor(cutoff / PERP_BAR_MS) * rotationStep) % remaining.length : 0;
  for (const ticker of [...remaining.slice(offset), ...remaining.slice(0, offset)]) selected.set(ticker.symbol, ticker);
  return [...selected.values()];
}

/** 同一根 K 線用穩定雜湊分成四組；即使各分鐘漲幅排名變動，也不會跨分片重複掃同一幣。 */
export function getPerpShardIndex(symbol: string, cutoff: number): number {
  let hash = 2166136261;
  const input = `${Math.floor(cutoff / PERP_BAR_MS)}:${symbol}`;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return (hash >>> 0) % BINANCE_PERP_RULES.shardCount;
}

/** 單次 Worker 最多掃 32 檔；四個分片合計最多覆蓋 128 檔。 */
export function selectPerpShard(universe: PerpTicker[], cutoff: number, shardIndex: number): PerpTicker[] {
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= BINANCE_PERP_RULES.shardCount) {
    throw new Error('永續掃描分片索引無效');
  }
  return rankedPerpCandidates(universe, cutoff)
    .filter(ticker => getPerpShardIndex(ticker.symbol, cutoff) === shardIndex)
    .slice(0, BINANCE_PERP_RULES.shardSize);
}

/** 供測試與診斷查看整根 K 線的四批候選；正式排程只呼叫當分鐘對應的單一分片。 */
export function selectPerpCandidates(universe: PerpTicker[], cutoff: number): PerpTicker[] {
  return Array.from({ length: BINANCE_PERP_RULES.shardCount }, (_, shardIndex) =>
    selectPerpShard(universe, cutoff, shardIndex)).flat();
}

interface GateMarkCandle { t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown }

function validateCandles(candles: Candle[], cutoff: number): Candle[] {
  const closed = candles.filter(candle => candle.openTime < cutoff).sort((a, b) => a.openTime - b.openTime);
  if (closed.length < BINANCE_PERP_RULES.minimumBars) throw new PerpHistoryTooShortError();
  for (let index = 0; index < closed.length; index++) {
    const candle = closed[index];
    if (![candle.openTime, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
      candle.openTime % PERP_BAR_MS !== 0 || candle.open <= 0 || candle.close <= 0 || candle.low <= 0 ||
      candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
      throw new Error('Mark Price K 線包含無效資料');
    }
    if (index && candle.openTime - closed[index - 1].openTime !== PERP_BAR_MS) throw new Error('Mark Price K 線有缺口或重複');
  }
  if (closed.at(-1)!.openTime !== cutoff - PERP_BAR_MS) throw new Error('Mark Price 最新已收盤 K 線尚未就緒');
  return closed;
}

async function fetchBinanceMarkPriceCandles(symbol: string, cutoff: number): Promise<Candle[]> {
  const rows = await publicJson<unknown[][]>('https://fapi.binance.com', '/fapi/v1/markPriceKlines', {
    symbol, interval: PERP_INTERVAL, limit: String(BINANCE_PERP_RULES.requestedBars),
  });
  if (!Array.isArray(rows)) throw new Error('Binance Mark Price K 線格式異常');
  return validateCandles(rows.map(row => {
    if (!Array.isArray(row) || row.length < 5) throw new Error('Binance Mark Price K 線欄位不足');
    return { openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: 0 };
  }), cutoff);
}

async function fetchGateMarkPriceCandles(symbol: string, cutoff: number): Promise<Candle[]> {
  const contract = `${symbol.slice(0, -4)}_USDT`;
  const rows = await publicJson<GateMarkCandle[]>('https://api.gateio.ws', '/api/v4/futures/usdt/candlesticks', {
    contract: `mark_${contract}`, interval: PERP_INTERVAL, limit: String(BINANCE_PERP_RULES.requestedBars),
  });
  if (!Array.isArray(rows)) throw new Error('Gate Mark Price K 線格式異常');
  return validateCandles(rows.map(row => {
    if (!row || typeof row !== 'object') throw new Error('Gate Mark Price K 線欄位不足');
    return { openTime: Number(row.t) * 1000, open: Number(row.o), high: Number(row.h), low: Number(row.l), close: Number(row.c), volume: 0 };
  }), cutoff);
}

/** Mark Price 沒有真實成交量；吃大魚只用 OHLC，volume 固定為零且不冒充成交量。 */
export async function fetchMarkPriceCandles(symbol: string, cutoff: number, source: PerpMarketSource): Promise<Candle[]> {
  if (!SAFE_SYMBOL.test(symbol)) throw new Error('永續合約代號格式無效');
  return source === 'BINANCE'
    ? fetchBinanceMarkPriceCandles(symbol, cutoff)
    : fetchGateMarkPriceCandles(symbol, cutoff);
}
