/** @file Bitget 股票永續公開商品與行情；只讀固定交易所 API，不使用帳戶金鑰或下單端點。 */
import type { Candle } from '../strategy/types';
import type { Timeframe } from '../../types';

const API_ORIGIN = 'https://api.bitget.com';
const DAY_MS = 86_400_000;
/** 日線提供近一年的觀看區間；策略計算沿用同一批資料，不另抓股票現貨補足歷史。 */
const HISTORY_DAYS = 365;
const HISTORY_PAGE_DAYS = 90;
/** Bitget 日線使用 UTC；其餘週期以毫秒判斷收盤，掃描不讀仍在變動的當根。 */
export const STOCK_PERP_INTERVALS: Record<Timeframe, { granularity: string; duration: number }> = {
  '1d': { granularity: '1Dutc', duration: DAY_MS }, '4h': { granularity: '4H', duration: 14_400_000 },
  '60m': { granularity: '1H', duration: 3_600_000 }, '15m': { granularity: '15m', duration: 900_000 },
};

export interface StockPerpTicker { symbol: string; turnoverUsdt: number; spreadPct: number }

export interface StockPerpContract {
  symbol: string;
  baseCoin: string;
  maxLeverage: number | null;
  fundingIntervalHours: number | null;
}

export interface StockPerpAnalysis {
  contract: StockPerpContract;
  candles: Candle[];
  lastPrice: number;
  markPrice: number | null;
  high24h: number | null;
  low24h: number | null;
  fundingRate: number | null;
  fundingIntervalHours: number | null;
  nextFundingTime: number | null;
  observedAt: number;
}

interface BitgetResponse<T> { code: string; msg?: string; data: T }

async function bitgetPublic<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api/${path}?${new URLSearchParams(params)}`, {
      headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    });
  } catch (error) {
    /** 取消必須保留原因；瀏覽器不透露 TLS 細節，連線失敗要提示使用者檢查網路與憑證。 */
    signal?.throwIfAborted();
    if (error instanceof TypeError) throw new Error('無法連線到 Bitget 公開行情，請確認網路及瀏覽器能正常驗證 api.bitget.com 的憑證，再按重新整理重試。');
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('Bitget 行情連線逾時，請稍後重新整理重試。');
    throw error;
  }
  if (response.status === 403) throw new Error('Bitget 暫時拒絕此執行環境的公開行情請求（403），請稍後重試。');
  const payload = await response.json() as BitgetResponse<T>;
  if (!response.ok || payload.code !== '00000') {
    throw new Error(`Bitget 公開行情暫時無法取得（${payload.code ?? response.status}）`);
  }
  return payload.data;
}

/** 只接受 Bitget 明確標記為 USDT 股票永續且上架的商品，避免將幣合約誤列為股票。 */
export async function listStockPerpContracts(signal?: AbortSignal): Promise<StockPerpContract[]> {
  const rows = await bitgetPublic<Array<Record<string, string>>>('v3/market/instruments', { category: 'USDT-FUTURES' }, signal);
  if (!Array.isArray(rows)) throw new Error('Bitget 商品清單格式錯誤');
  return rows.filter(row => row.category === 'USDT-FUTURES' && row.symbolType === 'stock'
      && row.type === 'perpetual' && row.status === 'online' && /^[A-Z0-9]{1,15}USDT$/.test(row.symbol ?? ''))
    .map(row => ({ symbol: row.symbol, baseCoin: row.baseCoin,
      maxLeverage: Number.isFinite(Number(row.maxLeverage)) ? Number(row.maxLeverage) : null,
      fundingIntervalHours: Number.isFinite(Number(row.fundInterval)) ? Number(row.fundInterval) : null }))
    .sort((a, b) => a.baseCoin.localeCompare(b.baseCoin));
}

/** 一次取得全部商品的 USDT 成交額與雙邊價差，避免為每個候選另抓 ticker。 */
export async function loadStockPerpTickers(signal?: AbortSignal): Promise<StockPerpTicker[]> {
  const rows = await bitgetPublic<Array<Record<string, string>>>('v2/mix/market/tickers', { productType: 'USDT-FUTURES' }, signal);
  if (!Array.isArray(rows)) throw new Error('Bitget 報價清單格式錯誤');
  return rows.flatMap(row => {
    const bid = Number(row.bidPr), ask = Number(row.askPr), turnoverUsdt = Number(row.usdtVolume ?? row.quoteVolume);
    return [bid, ask, turnoverUsdt].every(Number.isFinite) && bid > 0 && ask >= bid && turnoverUsdt > 0
      ? [{ symbol: row.symbol, turnoverUsdt, spreadPct: (ask - bid) / ((ask + bid) / 2) * 100 }] : [];
  });
}

/** 同一套驗證供日線歷史與近期掃描使用；重複 K 線若價量矛盾，直接拒絕評分。 */
function closedCandles(rows: unknown, timeframe: Timeframe, now: number): Candle[] {
  if (!Array.isArray(rows)) throw new Error('Bitget 股票合約 K 線格式錯誤');
  const duration = STOCK_PERP_INTERVALS[timeframe].duration, unique = new Map<number, Candle>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) throw new Error('Bitget 股票合約 K 線格式錯誤');
    const [openTime, open, high, low, close, volume] = row.slice(0, 6).map(Number);
    if (![openTime, open, high, low, close, volume].every(Number.isFinite) || openTime % duration !== 0
      || low <= 0 || volume < 0 || low > Math.min(open, close) || high < Math.max(open, close)) throw new Error('Bitget 股票合約 K 線數值無效');
    if (openTime + duration > now) continue;
    const candle = { openTime, open, high, low, close, volume }, previous = unique.get(openTime);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candle)) throw new Error('Bitget 重複 K 線價量不一致');
    unique.set(openTime, candle);
  }
  return [...unique.values()].sort((a, b) => a.openTime - b.openTime);
}

/** 呼叫端從 stock 商品清單選擇代號；一筆掃描只需一次 K 線請求，不抓帳戶與資金費資料。 */
export async function loadStockPerpCandles(symbol: string, timeframe: Timeframe, limit = 120, signal?: AbortSignal, now = Date.now()) {
  if (!/^[A-Z0-9]{1,15}USDT$/.test(symbol) || !Object.hasOwn(STOCK_PERP_INTERVALS, timeframe)
    || !Number.isInteger(limit) || limit < 2 || limit > 999) throw new Error('股票合約 K 線查詢參數無效');
  const interval = STOCK_PERP_INTERVALS[timeframe];
  const rows = await bitgetPublic<string[][]>('v2/mix/market/candles', { symbol, productType: 'USDT-FUTURES',
    granularity: interval.granularity, endTime: String(Math.floor(now / interval.duration) * interval.duration), limit: String(limit + 1) }, signal);
  return closedCandles(rows, timeframe, now).slice(-limit);
}

/** 分段抓取 365 根 UTC 日線；單次歷史查詢最多 90 天、200 根，策略暖機最多需要 200 根。 */
async function loadClosedDailyCandles(symbol: string, signal?: AbortSignal): Promise<Candle[]> {
  const end = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const start = end - HISTORY_DAYS * DAY_MS;
  const ranges: Array<{ from: number; to: number }> = [];
  for (let from = start; from < end; from += HISTORY_PAGE_DAYS * DAY_MS) {
    ranges.push({ from, to: Math.min(end, from + HISTORY_PAGE_DAYS * DAY_MS) });
  }
  const pages = await Promise.all(ranges.map(({ from, to }) => bitgetPublic<string[][]>('v2/mix/market/history-candles', {
    symbol, productType: 'USDT-FUTURES', granularity: '1Dutc', startTime: String(from), endTime: String(to), limit: '200',
  }, signal)));
  return closedCandles(pages.flat(), '1d', end).filter(candle => candle.openTime >= start && candle.openTime < end);
}

/** 每次查詢重新驗證商品類型，且不接受任意交易所 URL 或非股票永續代號。 */
export async function loadStockPerpAnalysis(symbol: string, timeframe: Timeframe = '1d', signal?: AbortSignal): Promise<StockPerpAnalysis> {
  if (!/^[A-Z0-9]{1,15}USDT$/.test(symbol)) throw new Error('股票合約代號格式錯誤');
  const contracts = await listStockPerpContracts(signal);
  const contract = contracts.find(item => item.symbol === symbol);
  if (!contract) throw new Error('此商品不是 Bitget 正在交易的 USDT 股票永續合約');
  const [candles, tickers, fundingRows] = await Promise.all([
    timeframe === '1d' ? loadClosedDailyCandles(symbol, signal) : loadStockPerpCandles(symbol, timeframe, 320, signal),
    bitgetPublic<Array<Record<string, string>>>('v2/mix/market/ticker', { productType: 'USDT-FUTURES', symbol }, signal),
    bitgetPublic<Array<Record<string, string>>>('v2/mix/market/current-fund-rate', { productType: 'USDT-FUTURES', symbol }, signal)
      .catch(() => [] as Array<Record<string, string>>),
  ]);
  const ticker = tickers.find(row => row.symbol === symbol);
  const lastPrice = Number(ticker?.lastPr);
  if (!ticker || !Number.isFinite(lastPrice) || lastPrice <= 0 || candles.length === 0) {
    throw new Error('Bitget 股票合約缺少有效成交價或已收盤 K 線');
  }
  const optionalNumber = (value: string | undefined) => {
    const number = Number(value);
    return value && Number.isFinite(number) ? number : null;
  };
  const funding = fundingRows.find(row => row.symbol === symbol);
  return {
    contract, candles, lastPrice,
    markPrice: optionalNumber(ticker.markPrice), high24h: optionalNumber(ticker.high24h), low24h: optionalNumber(ticker.low24h),
    fundingRate: optionalNumber(funding?.fundingRate),
    fundingIntervalHours: optionalNumber(funding?.fundingRateInterval) ?? contract.fundingIntervalHours,
    nextFundingTime: optionalNumber(funding?.nextUpdate), observedAt: Date.now(),
  };
}
