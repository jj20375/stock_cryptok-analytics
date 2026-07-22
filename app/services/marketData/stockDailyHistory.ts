/**
 * 【詳細繁體中文註解】：股票日線歷史資料抓取(Yahoo Finance v8 chart API)
 *
 * 通用於美股與台股(原檔名 usStockHistory.ts,因回測範圍擴大到台股一併改名反映實際用途)。
 * 台股代號需先透過 toYahooSymbol() 補上 ".TW" 後綴再查詢;kline_cache 內仍以「不含後綴」的
 * 原始代號(如 "2330")儲存,維持 (symbol, market, interval) 這組 key 的一致性。
 *
 * 為什麼不用既有的 stockService.fetchStockData():
 *   該函式有兩個對「回測」致命的行為 —
 *   1. 會用即時報價「覆寫最後一根日線」→ 造成回測資料隨抓取時間變動、結果不可重現(前視污染)
 *   2. 4h 線是由 1h 線從第 0 根硬聚合,不對齊交易時段
 *   因此回測資料路徑必須走本模組:原樣保存 Yahoo 的日線 OHLCV,不做任何覆寫。
 *
 * 外部 API 副作用註記:Yahoo Finance 為非官方公開端點,可能限流或改版;
 * 失敗時擲出例外,由上層將回測標記為 ERROR,不做替代資料源(避免污染)。
 *
 * 日線特性:週末與假日休市,K 線天然不連續,
 * 因此「缺口偵測」不適用固定週期演算法 — 上層(runner)對股票市場改用「整段重抓 + INSERT OR IGNORE」策略,
 * 一次抓 5 年日線也只是一個 HTTP 請求與 ~1250 根 K 線,成本極低。
 */

import type { Candle } from '../strategy/types';

// 單根日線的毫秒數:用於「排除可能仍在盤中變動的當日 K 線」
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** 將不含後綴的代號轉為 Yahoo 查詢用代號:台股補 ".TW"、美股原樣使用 */
export const toYahooSymbol = (symbol: string, market: 'US' | 'TW'): string =>
  market === 'TW' ? `${symbol}.TW` : symbol;

/**
 * 抓取股票日線歷史(最多 5 年)。
 *
 * @param yahooSymbol Yahoo 查詢用代號(美股如 COIN、台股需已含 .TW 後綴如 2330.TW)
 * @param range  Yahoo range 參數,預設 '5y'
 *
 * 重要:回傳前會排除「開盤時間距今不滿 24 小時」的 K 線 —
 * 該根可能仍在盤中(或剛收盤資料未定版),寫入快取會讓回測不可重現。
 * 被排除的當日 K 線會在隔日的增量更新中自然補齊。
 */
export const fetchStockDailyHistory = async (
  yahooSymbol: string,
  range: string = '5y'
): Promise<{ candles: Candle[]; name: string }> => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=1d`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!response.ok) {
    throw new Error(`[Stock History] Yahoo 回應異常 ${response.status}: ${yahooSymbol}`);
  }

  const json = (await response.json()) as any;
  const result = json?.chart?.result?.[0];
  if (!result || !result.timestamp) {
    throw new Error(`[Stock History] Yahoo 無 ${yahooSymbol} 的日線資料`);
  }

  const timestamps: number[] = result.timestamp;
  const quote = result.indicators?.quote?.[0] ?? {};
  const name: string = result.meta?.shortName || result.meta?.longName || yahooSymbol;

  const now = Date.now();
  const candles: Candle[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];

    // Yahoo 偶有整根 null 的空洞(停牌等),直接略過
    if (open == null || high == null || low == null || close == null) continue;

    const openTime = timestamps[i] * 1000;
    // 排除可能尚未定版的當日 K 線(距開盤不滿 24 小時)
    if (openTime + ONE_DAY_MS > now) continue;

    candles.push({
      openTime,
      open,
      high,
      low,
      close,
      volume: volume ?? 0,
    });
  }

  return { candles, name };
};
