/** @file 圖表策略只使用已收盤的有效 K；股票日線沿用雷達正常交易時段，未收盤價格不確認訊號。 */
import type { Candle } from '../../services/strategy/types';
import type { MarketKey, StockDataPoint, Timeframe } from './types';
import { usStockFourHourClosedAt } from '../../services/usStockRadar/candles';
import { twStockFourHourClosedAt } from '../../services/twStockRadar/candles';

export interface StrategyChartOptions { market: MarketKey; timeframe: Timeframe; now?: number; continuousMarket?: boolean }

export function confirmedStrategyCandles(data: StockDataPoint[], { market, timeframe, now = Date.now(), continuousMarket = false }: StrategyChartOptions): Candle[] {
  return data.filter(c => {
    if (c.isMock || ![c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
      || c.close <= 0 || c.low <= 0 || c.volume < 0 || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) return false;
    /** 正常日線收盤：台股開盤後 4.5 小時，美股 6.5 小時；提早收盤日採保守等待至正常收盤。 */
    /** 股票永續以交易所 K 線週期收盤，不能套用美股現貨的盤中交易時段。 */
    const duration = timeframe === '1d' ? (continuousMarket ? 24 : market === 'TW' ? 4.5 : market === 'US' ? 6.5 : 24) * 3_600_000
      : timeframe === '15m' ? 900_000 : timeframe === '60m' ? 3_600_000 : 14_400_000;
    const closedAt = timeframe === '4h' && market !== 'CRYPTO' && !continuousMarket
      ? (market === 'TW' ? twStockFourHourClosedAt(c.timestamp) : usStockFourHourClosedAt(c.timestamp)) : c.timestamp + duration;
    return closedAt <= now;
  }).map(c => ({ openTime: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
}
