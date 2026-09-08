/**
 * 【詳細繁體中文註解】：Binance 歷史 K 線分頁抓取
 *
 * 與 binanceService.getKlines() 的差異:
 *   - getKlines 只能抓「最近 N 根」(無 startTime/endTime),供 live 引擎即時評估用
 *   - 本模組支援任意時間區間的分頁抓取(單頁上限 1000 根),供回測補歷史資料用
 *
 * 資料來源固定為 Bybit 現貨，HYPE 例外固定為 Binance.US 現貨。
 * 原 Binance 資料端點會依 Cloudflare Worker 機房位置回傳 451，無法穩定供正式回測使用。
 * 同一個交易對與週期由快取層鎖定單一來源；切換來源時會清除舊快取再完整重抓，
 * 因此不會把不同交易所的價格與成交量混入一份回測資料。
 *
 * 外部 API 副作用註記:
 *   Bybit Spot Kline API 支援 start/end、每頁最多 1000 根且回傳基礎幣成交量；
 *   HYPE 使用 Binance.US Spot Kline API。單次 Worker 請求受 subrequest 上限約束，
 *   因此 fetchBinanceRange 以 maxPages 限制單趟抓取量,未完成時回傳游標由呼叫端續抓。
 */

import type { Candle } from '../strategy/types';

const BYBIT_KLINE_URL = 'https://api.bybit.com/v5/market/kline';
const BINANCE_US_KLINE_URL = 'https://api.binance.us/api/v3/klines';

// 單頁最大根數(Binance API 上限 1000)
const PAGE_LIMIT = 1000;

/** K 線來源名稱會寫入快取，確保單一回測不混合不同交易所的行情與成交量。 */
export type CryptoKlineSource = 'BYBIT_SPOT' | 'BINANCE_US_SPOT';

/** HYPE 無法可靠取得 Bybit 現貨 K 線，固定使用 Binance.US；其他監控幣固定用 Bybit。 */
export const getCryptoKlineSource = (symbol: string): CryptoKlineSource =>
  symbol === 'HYPEUSDT' ? 'BINANCE_US_SPOT' : 'BYBIT_SPOT';

/** K 線週期字串 → 毫秒 */
export const intervalToMs = (interval: string): number => {
  const map: Record<string, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  const ms = map[interval];
  if (!ms) throw new Error(`不支援的 K 線週期: ${interval}`);
  return ms;
};

/** 將本系統支援的週期轉為 Bybit Spot API 週期。 */
const toBybitInterval = (interval: string): string => {
  const mapping: Record<string, string> = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };
  const value = mapping[interval];
  if (!value) throw new Error(`Bybit 不支援的 K 線週期: ${interval}`);
  return value;
};

/** 單頁抓取；Bybit 回傳新到舊，統一排序後才交給回測。 */
const fetchOnePage = async (
  source: CryptoKlineSource,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> => {
  const query = source === 'BYBIT_SPOT'
    ? new URLSearchParams({ category: 'spot', symbol, interval: toBybitInterval(interval), start: String(startTime), end: String(endTime), limit: String(PAGE_LIMIT) })
    : new URLSearchParams({ symbol, interval, startTime: String(startTime), endTime: String(endTime), limit: String(PAGE_LIMIT) });
  const url = `${source === 'BYBIT_SPOT' ? BYBIT_KLINE_URL : BINANCE_US_KLINE_URL}?${query}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${source} 歷史行情回應異常: ${response.status} ${response.statusText}`);
  const payload = await response.json() as any;
  if (source === 'BYBIT_SPOT') {
    if (payload.retCode !== 0 || !Array.isArray(payload.result?.list)) {
      throw new Error(`BYBIT_SPOT 歷史行情回應異常: ${payload.retMsg ?? '格式不正確'}`);
    }
    return payload.result.list.map((k: string[]) => ({
      openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
    })).sort((a: Candle, b: Candle) => a.openTime - b.openTime);
  }
  if (!Array.isArray(payload)) throw new Error('BINANCE_US_SPOT 歷史行情格式不正確');
  return payload.map((k: unknown[]) => ({
    openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
  }));
};

export interface FetchRangeResult {
  /** 整趟請求唯一的資料來源；快取層據此避免跨交易所混用。 */
  source: CryptoKlineSource;
  /** 本趟抓到的已收盤 K 線(依 openTime 升冪) */
  candles: Candle[];
  /** 是否已抓完整個要求區間 */
  complete: boolean;
  /** 未完成時的續抓游標(下一根 K 線的 openTime);complete 為 true 時為 null */
  nextCursor: number | null;
}

/**
 * 分頁抓取指定區間的歷史 K 線。
 *
 * @param symbol   交易對,如 BTCUSDT
 * @param interval K 線週期,如 15m / 1h / 4h / 1d
 * @param startTime 區間起點(毫秒 UTC,含)
 * @param endTime   區間終點(毫秒 UTC,含)
 * @param maxPages  單趟最多抓幾頁(每頁 1000 根)。用來控制 Workers subrequest 用量,
 *                  超過時回傳 nextCursor 由呼叫端(前端輪詢)續抓。
 *
 * 重要:僅回傳「已收盤」的 K 線 — 進行中的 K 線資料會隨時間變動,
 * 寫入快取會造成回測結果不可重現,因此在此直接過濾。
 */
export const fetchBinanceRange = async (
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  maxPages: number = 40
): Promise<FetchRangeResult> => {
  const intervalMs = intervalToMs(interval);
  const source = getCryptoKlineSource(symbol);
  const candles: Candle[] = [];
  let cursor = startTime;

  for (let page = 0; page < maxPages; page++) {
    if (cursor > endTime) break;

    const pageData = await fetchOnePage(source, symbol, interval, cursor, endTime);
    // 空頁代表該區間已無資料(例如標的上市日之前),視為抓取完成 —
    // 若不這樣處理,呼叫端會拿到永遠補不完的游標而無限輪詢
    if (pageData.length === 0) {
      cursor = endTime + 1;
      break;
    }

    candles.push(...pageData);
    const lastOpenTime = pageData[pageData.length - 1].openTime;

    // 不足一整頁代表區間內資料已抓完
    if (pageData.length < PAGE_LIMIT) {
      cursor = endTime + 1;
      break;
    }
    // 游標推進到最後一根的下一根,避免重複抓取
    cursor = lastOpenTime + intervalMs;
  }

  // 過濾掉尚未收盤的 K 線(openTime + intervalMs > 現在時間 代表還在走)
  const now = Date.now();
  const closedCandles = candles.filter((c) => c.openTime + intervalMs <= now);

  const complete = cursor > endTime;
  return {
    source,
    candles: closedCandles,
    complete,
    nextCursor: complete ? null : cursor,
  };
};
