/** @file Gate USDT 永續公開行情；限制合約種類、資料格式、逾時與已收盤時間。 */
import type { Candle } from '../strategy/types';
import { BINANCE_PERP_RULES, PERP_QUARTER_MS, type PerpTicker } from './types';

/** 穩定幣、貴金屬與常見槓桿代幣不作為加密貨幣趨勢候選。 */
const EXCLUDED_BASES = new Set([
  'USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'XUSD', 'EUR', 'EURC', 'XAUT', 'PAXG',
]);
const SAFE_SYMBOL = /^[A-Z0-9]{2,24}USDT$/;

async function publicFutures<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`https://api.gateio.ws/api/v4/futures/usdt/${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(BINANCE_PERP_RULES.requestTimeoutMs),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Gate 永續行情 HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

interface Ticker24h {
  contract?: unknown;
  mark_price?: unknown;
  change_percentage?: unknown;
  volume_24h_quote?: unknown;
}

interface ContractInfo {
  name?: unknown;
  status?: unknown;
  in_delisting?: unknown;
  contract_type?: unknown;
}

/** 一次交叉核對完整合約 metadata 與 ticker，排除停牌、下架中及 Gate 股票型永續。 */
export async function fetchPerpUniverse(): Promise<PerpTicker[]> {
  const [contracts, tickers] = await Promise.all([
    /** 不傳 limit 時 Gate 目前回傳完整清單；傳入超過 100 反而會被官方端點拒絕。 */
    publicFutures<ContractInfo[]>('contracts'),
    publicFutures<Ticker24h[]>('tickers'),
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
    if (!SAFE_SYMBOL.test(symbol) || EXCLUDED_BASES.has(baseAsset) || /(?:[235][LS]|UP|DOWN|BULL|BEAR)$/.test(baseAsset)) continue;
    const price = Number(ticker.mark_price);
    const change24h = Number(ticker.change_percentage);
    const quoteVolume24h = Number(ticker.volume_24h_quote);
    if (![price, change24h, quoteVolume24h].every(Number.isFinite) || price <= 0 ||
      quoteVolume24h < BINANCE_PERP_RULES.minQuoteVolume) continue;
    result.push({ symbol, baseAsset, price, change24h, quoteVolume24h });
  }
  return result;
}

/** 三十二檔有限掃描：同時涵蓋強勢上漲與深跌反轉，其餘用成交額與固定輪替補足。 */
export function selectPerpCandidates(universe: PerpTicker[], cutoff: number): PerpTicker[] {
  const gainers = universe.filter(item => item.change24h > 0)
    .sort((a, b) => b.change24h - a.change24h || a.symbol.localeCompare(b.symbol));
  const decliners = universe.filter(item => item.change24h < 0)
    .sort((a, b) => a.change24h - b.change24h || a.symbol.localeCompare(b.symbol));
  const liquid = [...universe].sort((a, b) => b.quoteVolume24h - a.quoteVolume24h || a.symbol.localeCompare(b.symbol));
  const selected = new Map<string, PerpTicker>();
  for (const ticker of gainers.slice(0, BINANCE_PERP_RULES.topGainerSlots)) selected.set(ticker.symbol, ticker);
  /** 深跌標的只取得掃描資格；是否進場仍須逐根符合 MACD／Supertrend 原始條件。 */
  for (const ticker of decliners.slice(0, BINANCE_PERP_RULES.topDeclinerSlots)) selected.set(ticker.symbol, ticker);
  const fixedSlots = BINANCE_PERP_RULES.topGainerSlots + BINANCE_PERP_RULES.topDeclinerSlots + BINANCE_PERP_RULES.topVolumeSlots;
  for (const ticker of liquid) {
    if (selected.size >= fixedSlots) break;
    selected.set(ticker.symbol, ticker);
  }
  const remaining = universe.filter(item => !selected.has(item.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const rotationSlots = BINANCE_PERP_RULES.scanLimit - selected.size;
  const offset = remaining.length ? (Math.floor(cutoff / PERP_QUARTER_MS) * rotationSlots) % remaining.length : 0;
  const rotated = [...remaining.slice(offset), ...remaining.slice(0, offset)];
  for (const ticker of rotated) {
    if (selected.size >= BINANCE_PERP_RULES.scanLimit) break;
    selected.set(ticker.symbol, ticker);
  }
  return [...selected.values()].slice(0, BINANCE_PERP_RULES.scanLimit);
}

interface GateMarkCandle { t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown }

/** Gate 以 mark_ 合約前綴回傳 Mark Price；它沒有真實成交量，因此 volume 固定為零。 */
export async function fetchMarkPriceCandles(symbol: string, cutoff: number): Promise<Candle[]> {
  if (!SAFE_SYMBOL.test(symbol)) throw new Error('永續合約代號格式無效');
  const contract = `${symbol.slice(0, -4)}_USDT`;
  const rows = await publicFutures<GateMarkCandle[]>('candlesticks', {
    contract: `mark_${contract}`,
    interval: '15m',
    limit: String(BINANCE_PERP_RULES.requestedBars),
  });
  if (!Array.isArray(rows)) throw new Error('Mark Price K 線格式異常');
  const candles = rows.map(row => {
    if (!row || typeof row !== 'object') throw new Error('Mark Price K 線欄位不足');
    return { openTime: Number(row.t) * 1000, open: Number(row.o), high: Number(row.h), low: Number(row.l), close: Number(row.c), volume: 0 };
  }).filter(candle => candle.openTime < cutoff).sort((a, b) => a.openTime - b.openTime);
  if (candles.length < BINANCE_PERP_RULES.minimumBars) throw new Error('Mark Price K 線歷史不足');
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    if (![candle.openTime, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
      candle.openTime % PERP_QUARTER_MS !== 0 || candle.open <= 0 || candle.close <= 0 ||
      candle.low <= 0 || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
      throw new Error('Mark Price K 線包含無效資料');
    }
    if (index && candle.openTime - candles[index - 1].openTime !== PERP_QUARTER_MS) throw new Error('Mark Price K 線有缺口或重複');
  }
  if (candles.at(-1)!.openTime !== cutoff - PERP_QUARTER_MS) throw new Error('Mark Price 最新已收盤 K 線尚未就緒');
  return candles;
}
