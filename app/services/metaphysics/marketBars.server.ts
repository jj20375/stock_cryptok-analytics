/**
 * @file 抓三個市場的日線並換成「市場當地日期」的收盤序列，供回填與回測使用。
 * 外部 API 副作用：Yahoo（台股、美股指數）與 Bybit／Gate／Binance.US（BTC）公開端點，可能限流；失敗直接擲出，
 * 呼叫端標示「資料不足」，不以假資料替代。依回測資料鐵則，不使用 stockService.fetchStockData()。
 */
import { fetchBinanceRange, type CryptoKlineSource } from '../marketData/binanceHistory';
import { fetchStockDailyHistory } from '../marketData/stockDailyHistory';
import type { Candle } from '../strategy/types';
import { DAY_MS } from './calendarTime';
import { dailyBarsFromCandles, type DailyBar } from './hitRate';
import { MARKET_CHART_SPECS, type MetaMarket } from './marketChartSpecs';

/** BTC 日線最多續抓次數；每次 40 頁 × 1000 根，足以涵蓋 2017 年以來的資料。 */
const MAX_CRYPTO_ROUNDS = 10;

async function fetchCryptoDaily(startMs: number, endMs: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startMs;
  let forcedSource: CryptoKlineSource | undefined;
  for (let round = 0; round < MAX_CRYPTO_ROUNDS; round++) {
    // 續抓時鎖定首次來源，避免同一序列混入不同交易所的收盤價。
    const page = await fetchBinanceRange(MARKET_CHART_SPECS.CRYPTO.quoteSymbol, '1d', cursor, endMs, 40, forcedSource ? { forcedSource } : {});
    forcedSource = page.source;
    candles.push(...page.candles);
    if (page.complete || page.nextCursor == null) break;
    cursor = page.nextCursor;
  }
  return candles;
}

/**
 * 抓最近約 90 天的日線（回填上線快照用）。
 * 股市 3 個月約 60 個交易日，足以滿足命中率判定需要的前 21 根。
 */
export async function fetchRecentDailyBars(market: MetaMarket, now = Date.now()): Promise<DailyBar[]> {
  const spec = MARKET_CHART_SPECS[market];
  const candles = market === 'CRYPTO'
    ? await fetchCryptoDaily(now - 90 * DAY_MS, now)
    : (await fetchStockDailyHistory(spec.quoteSymbol, '3mo')).candles;
  return dailyBarsFromCandles(candles, spec.timeZone);
}

/**
 * 抓長期日線（回測用）。股市用 Yahoo `20y`（實測 `max` 只回月線，不能用）；BTC 從 2017-01-01 起抓到資料來源最早可得的日期。
 */
export async function fetchHistoryDailyBars(market: MetaMarket, now = Date.now()): Promise<DailyBar[]> {
  const spec = MARKET_CHART_SPECS[market];
  const candles = market === 'CRYPTO'
    ? await fetchCryptoDaily(Date.UTC(2017, 0, 1), now)
    : (await fetchStockDailyHistory(spec.quoteSymbol, '20y')).candles;
  return dailyBarsFromCandles(candles, spec.timeZone);
}
