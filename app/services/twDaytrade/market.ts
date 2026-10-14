/** @file 當沖研究動態股票池與公開 15 分 K；只抓四碼普通股票，失敗明確揭露，不補假行情。 */
import { CURATED_TW_STOCKS, fetchTwStockUniverse } from '../twStockRadar/market';
import { DAYTRADE_RULES, isDaytradePriceEligible } from './types';
import { parseDaytradeChart } from './candles';

export async function daytradeUniverse(fetchUniverse = fetchTwStockUniverse) {
  const universe = await fetchUniverse();
  const knownPrices = new Map(universe.map(stock => [stock.symbol, stock.price]));
  const liquid = universe.filter(stock => /^[1-9]\d{3}\.TW$/.test(stock.symbol) && isDaytradePriceEligible(stock.price))
    .sort((a, b) => b.price * b.volume - a.price * a.volume);
  const pool = new Map<string, { symbol: string; name: string }>();
  /** 動態成交額前 24 檔加核心上市／上櫃股票，最後補到 36 檔；此榜不是全台股全市場排名。 */
  for (const stock of [...liquid.slice(0, 24), ...CURATED_TW_STOCKS, ...liquid]) {
    if (pool.size >= DAYTRADE_RULES.poolLimit) break;
    /** 核心池也遵守價格上限；缺報價的上櫃股仍須由本輪 Yahoo 最新收盤驗證，不能直接入榜。 */
    const knownPrice = knownPrices.get(stock.symbol);
    if (knownPrice != null && !isDaytradePriceEligible(knownPrice)) continue;
    pool.set(stock.symbol, { symbol: stock.symbol, name: stock.name });
  }
  return { pool: [...pool.values()], source: universe.length ? '證交所成交額初篩＋核心上市／上櫃股票' : '證交所資料未就緒，改用核心股票池' };
}

export async function fetchDaytradeCandles(symbol: string, now: number) {
  if (!/^[1-9]\d{3}\.(TW|TWO)$/.test(symbol)) throw new Error('當沖研究僅支援台股四碼普通股票');
  /** 向來源要求 60d 的 15 分歷史，實際起訖依供應商回傳；不改拿日線冒充 15 分。 */
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=60d&interval=15m&includePrePost=false`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`Yahoo 15 分行情回應 ${response.status}`);
  const candles = parseDaytradeChart(await response.json(), now);
  if (!candles.length) throw new Error('沒有已收盤 15 分 K 線');
  return candles;
}
