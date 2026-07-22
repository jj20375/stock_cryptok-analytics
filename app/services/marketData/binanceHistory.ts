/**
 * 【詳細繁體中文註解】：Binance 歷史 K 線分頁抓取
 *
 * 與 binanceService.getKlines() 的差異:
 *   - getKlines 只能抓「最近 N 根」(無 startTime/endTime),供 live 引擎即時評估用
 *   - 本模組支援任意時間區間的分頁抓取(單頁上限 1000 根),供回測補歷史資料用
 *
 * 資料來源刻意「只用 Binance、不用 OKX fallback」:
 *   OKX 的成交量單位與計價方式與 Binance 不同,混用會污染量能類策略的回測資料;
 *   抓不到就讓上層把回測標記為 ERROR,寧可失敗也不要餵髒資料。
 *
 * 外部 API 副作用註記:
 *   使用 data-api.binance.vision(幣安官方公開行情域名,對 Cloudflare Workers 機房 IP 較友善),
 *   失敗時 fallback 到 api.binance.com。單次 Worker 請求受 subrequest 數量上限約束,
 *   因此 fetchBinanceRange 以 maxPages 限制單趟抓取量,未完成時回傳游標由呼叫端續抓。
 */

import type { Candle } from '../strategy/types';

// 公開行情專用域名(官方提供,無需金鑰;api.binance.com 對雲端機房 IP 較常拒絕連線)
const BINANCE_VISION_URL = 'https://data-api.binance.vision';
const BINANCE_MAIN_URL = 'https://api.binance.com';

// 單頁最大根數(Binance API 上限 1000)
const PAGE_LIMIT = 1000;

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

/** 單頁抓取:先打 data-api.binance.vision,失敗再 fallback api.binance.com */
const fetchOnePage = async (
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> => {
  const query = `symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${PAGE_LIMIT}`;
  const urls = [
    `${BINANCE_VISION_URL}/api/v3/klines?${query}`,
    `${BINANCE_MAIN_URL}/api/v3/klines?${query}`,
  ];

  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastError = new Error(`Binance 歷史行情回應異常: ${response.status} ${response.statusText}`);
        continue;
      }
      const data = (await response.json()) as any[];
      return data.map((k) => ({
        openTime: k[0] as number,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`[Binance History] 無法取得 ${symbol} ${interval} 歷史資料: ${(lastError as any)?.message ?? lastError}`);
};

export interface FetchRangeResult {
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
  const candles: Candle[] = [];
  let cursor = startTime;

  for (let page = 0; page < maxPages; page++) {
    if (cursor > endTime) break;

    const pageData = await fetchOnePage(symbol, interval, cursor, endTime);
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
    candles: closedCandles,
    complete,
    nextCursor: complete ? null : cursor,
  };
};
