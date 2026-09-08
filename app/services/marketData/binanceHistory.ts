/**
 * 【詳細繁體中文註解】：加密貨幣歷史 K 線分頁抓取(多資料源備援)
 *
 * 與 binanceService.getKlines() 的差異:
 *   - getKlines 只能抓「最近 N 根」(無 startTime/endTime),供 live 引擎即時評估用
 *   - 本模組支援任意時間區間的分頁抓取(單頁上限 1000 根),供回測與波段雷達使用
 *
 * 資料來源優先序(每個標的一組,依序嘗試,第一個成功者鎖定整趟抓取):
 *   一般幣種:Bybit 現貨 → Gate.io 現貨
 *   HYPE:  Binance.US 現貨 → Gate.io 現貨(HYPE 在 Bybit 現貨不穩定)
 *   原 Binance 主站端點會依 Cloudflare Worker 機房位置回傳 451,不列入來源。
 *
 * 為什麼需要備援:實測發現單一來源會出現兩類故障 —
 *   (1) 回傳的最新 K 線過期(該交易所該幣流動性低,長時間沒有新 K 線)
 *   (2) 資料含缺口或未收盤 K 線
 * 兩者都會讓波段雷達整檔停擺,因此改為「來源失敗或資料不夠新就換下一個來源」。
 *
 * 資料一致性鐵則:同一趟抓取只會使用單一來源(不會 A 來源抓一半、B 來源抓一半),
 * 回傳的 source 欄位讓呼叫端(回測快取層)得以鎖定來源,避免不同交易所的價量混入同一份資料。
 *
 * 外部 API 副作用註記:每個來源單頁上限 1000 根、逾時 10 秒;
 * 單次 Worker 請求受 subrequest 上限約束,因此以 maxPages 限制單趟抓取量,
 * 未完成時回傳游標由呼叫端續抓。
 */

import type { Candle } from '../strategy/types';
import { WAVE_PRIMARY_SOURCES } from '../cryptoUniverse';

const BYBIT_KLINE_URL = 'https://api.bybit.com/v5/market/kline';
const BINANCE_US_KLINE_URL = 'https://api.binance.us/api/v3/klines';
const GATE_KLINE_URL = 'https://api.gateio.ws/api/v4/spot/candlesticks';

// 單頁最大根數(三個來源的上限皆為 1000)
const PAGE_LIMIT = 1000;

/** K 線來源名稱會回傳給呼叫端,確保單一回測不混合不同交易所的行情與成交量。 */
export type CryptoKlineSource = 'BYBIT_SPOT' | 'BINANCE_US_SPOT' | 'GATE_SPOT';

/** 全部可用來源;優先序由標的的主要來源決定,其餘依此順序作為備援。 */
const ALL_SOURCES: CryptoKlineSource[] = ['BYBIT_SPOT', 'GATE_SPOT', 'BINANCE_US_SPOT'];

/**
 * 取得標的的資料來源優先序(依序嘗試)。
 * 主要來源取自觀察名單的實測結果(WAVE_PRIMARY_SOURCES);名單外的標的預設 Bybit 優先。
 * 主來源之後會接上其餘來源作為備援,確保單一交易所故障時仍能取得資料。
 */
export const getCryptoKlineSources = (symbol: string): CryptoKlineSource[] => {
  const primary = (WAVE_PRIMARY_SOURCES[symbol] as CryptoKlineSource | undefined) ?? 'BYBIT_SPOT';
  return [primary, ...ALL_SOURCES.filter((s) => s !== primary)];
};

/** 取得標的的主要資料來源(優先序第一個) */
export const getCryptoKlineSource = (symbol: string): CryptoKlineSource =>
  getCryptoKlineSources(symbol)[0];

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

/** BTCUSDT → BTC_USDT(Gate.io 交易對格式);僅支援 USDT 計價 */
const toGateSymbol = (symbol: string): string => {
  if (!symbol.endsWith('USDT')) throw new Error(`Gate.io 僅支援 USDT 計價交易對: ${symbol}`);
  return `${symbol.slice(0, -4)}_USDT`;
};

/** 單頁抓取;各來源回傳格式不同,此處統一轉成 Candle 並依時間升冪排序。 */
const fetchOnePage = async (
  source: CryptoKlineSource,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> => {
  if (source === 'GATE_SPOT') {
    // Gate.io 時間單位為「秒」,且欄位順序為 [時間, 計價幣成交額, 收, 高, 低, 開, 基礎幣成交量, 是否已收盤]
    const query = new URLSearchParams({
      currency_pair: toGateSymbol(symbol),
      interval,
      from: String(Math.floor(startTime / 1000)),
      to: String(Math.floor(endTime / 1000)),
      limit: String(PAGE_LIMIT),
    });
    const response = await fetch(`${GATE_KLINE_URL}?${query}`, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`GATE_SPOT 歷史行情回應異常: ${response.status} ${response.statusText}`);
    const payload = await response.json() as any;
    if (!Array.isArray(payload)) throw new Error('GATE_SPOT 歷史行情格式不正確');
    return payload
      // Gate.io 明確標示該根是否已收盤,直接濾掉未收盤的 K 線最可靠
      .filter((k: string[]) => k[7] !== 'false')
      .map((k: string[]) => ({
        openTime: Number(k[0]) * 1000,
        open: Number(k[5]),
        high: Number(k[3]),
        low: Number(k[4]),
        close: Number(k[2]),
        volume: Number(k[6]),
      }))
      .sort((a: Candle, b: Candle) => a.openTime - b.openTime);
  }

  const query = source === 'BYBIT_SPOT'
    ? new URLSearchParams({ category: 'spot', symbol, interval: toBybitInterval(interval), start: String(startTime), end: String(endTime), limit: String(PAGE_LIMIT) })
    : new URLSearchParams({ symbol, interval, startTime: String(startTime), endTime: String(endTime), limit: String(PAGE_LIMIT) });
  const url = `${source === 'BYBIT_SPOT' ? BYBIT_KLINE_URL : BINANCE_US_KLINE_URL}?${query}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
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
  /** 整趟請求唯一的資料來源;快取層據此避免跨交易所混用。 */
  source: CryptoKlineSource;
  /** 本趟抓到的已收盤 K 線(依 openTime 升冪) */
  candles: Candle[];
  /** 是否已抓完整個要求區間 */
  complete: boolean;
  /** 未完成時的續抓游標(下一根 K 線的 openTime);complete 為 true 時為 null */
  nextCursor: number | null;
}

export interface FetchRangeOptions {
  /**
   * 指定必須使用的來源(不做備援切換)。
   * 回測續抓時由呼叫端帶入首次鎖定的來源,避免同一份快取混入不同交易所資料。
   */
  forcedSource?: CryptoKlineSource;
  /**
   * 要求最新一根 K 線的 openTime 至少要到這個時間,否則視為該來源資料過期並改用下一個來源。
   * 波段雷達需要最新已收盤 K 線,會帶入此參數;歷史回測不需要,省略即可。
   */
  minLatestOpenTime?: number;
}

/** 以單一來源抓取整個區間(不做備援切換),供 fetchBinanceRange 逐一嘗試各來源。 */
const fetchRangeWithSource = async (
  source: CryptoKlineSource,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  maxPages: number,
  intervalMs: number
): Promise<{ candles: Candle[]; complete: boolean; nextCursor: number | null }> => {
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

  return { candles: closedCandles, complete, nextCursor: complete ? null : cursor };
};

/**
 * 分頁抓取指定區間的歷史 K 線,依來源優先序自動備援。
 *
 * @param symbol   交易對,如 BTCUSDT
 * @param interval K 線週期,如 15m / 1h / 4h / 1d
 * @param startTime 區間起點(毫秒 UTC,含)
 * @param endTime   區間終點(毫秒 UTC,含)
 * @param maxPages  單趟最多抓幾頁(每頁 1000 根)。用來控制 Workers subrequest 用量,
 *                  超過時回傳 nextCursor 由呼叫端(前端輪詢)續抓。
 * @param options   forcedSource:鎖定來源不做備援;minLatestOpenTime:資料需新於此時間否則換源
 *
 * 重要:僅回傳「已收盤」的 K 線 — 進行中的 K 線資料會隨時間變動,
 * 寫入快取會造成回測結果不可重現,因此在此直接過濾。
 */
export const fetchBinanceRange = async (
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  maxPages: number = 40,
  options: FetchRangeOptions = {}
): Promise<FetchRangeResult> => {
  const intervalMs = intervalToMs(interval);
  const sources = options.forcedSource ? [options.forcedSource] : getCryptoKlineSources(symbol);

  let lastError: unknown = null;
  for (const source of sources) {
    try {
      const result = await fetchRangeWithSource(source, symbol, interval, startTime, endTime, maxPages, intervalMs);

      // 資料過期(該來源該幣流動性不足或延遲)時改用下一個來源,而不是讓整檔停擺
      if (options.minLatestOpenTime != null) {
        const latest = result.candles.at(-1)?.openTime ?? -Infinity;
        if (latest < options.minLatestOpenTime) {
          lastError = new Error(`${source} 最新 K 線過期(需要 ${new Date(options.minLatestOpenTime).toISOString()} 之後的資料)`);
          continue;
        }
      }

      return { source, ...result };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `[Crypto History] ${symbol} ${interval} 所有資料來源(${sources.join(', ')})皆無法取得可用資料: ${(lastError as any)?.message ?? lastError}`
  );
};
