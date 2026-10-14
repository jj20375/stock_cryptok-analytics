/** @file Bybit USDT 永續公開行情轉為回測共用格式；僅讀取市場資料，不含帳戶或下單 API。 */
import type { Candle } from '../strategy/types';
import type { FundingPoint, MarginTier } from '../backtest/futures';
import type { FuturesCandleKind, FuturesResearchMetadata } from './market.server';
import { HOUR_MS } from '../strategy/futuresRegime';

interface BybitResult<T> { retCode: number; retMsg?: string; result?: T }
interface BybitPage<T> { list: T[]; nextPageCursor?: string }

async function bybitPublic<T>(path: string, params: Record<string, string>) {
  const response = await fetch(`https://api.bybit.com/v5/market/${path}?${new URLSearchParams(params)}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json() as BybitResult<T>;
  if (!response.ok || payload.retCode !== 0 || payload.result == null) {
    throw new Error(`Bybit 永續資料暫時無法取得（${payload.retCode ?? response.status}）`);
  }
  return payload.result;
}

/** K 線與標記價共用 1H 時間邊界；未收盤 K 線不進入回測避免偷看盤中收盤值。 */
export async function bybitFuturesCandlesPage(symbol: string, kind: FuturesCandleKind, from: number, to: number) {
  const end = Math.min(Math.floor(to / HOUR_MS) * HOUR_MS + HOUR_MS, Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
  const start = Math.max(Math.floor(from / HOUR_MS) * HOUR_MS, end - 1000 * HOUR_MS);
  const rows = await bybitPublic<BybitPage<string[]>>(kind === 'MARK' ? 'mark-price-kline' : 'kline', {
    category: 'linear', symbol, interval: '60', start: String(start), end: String(end), limit: '1000',
  });
  if (!Array.isArray(rows.list)) throw new Error('Bybit 合約 K 線格式錯誤');
  return rows.list.map(row => {
    const [openTime, open, high, low, close, volume] = row.slice(0, 6).map(Number);
    if (![openTime, open, high, low, close].every(Number.isFinite) || openTime % HOUR_MS || low <= 0
      || low > Math.min(open, close) || high < Math.max(open, close) || (kind === 'TRADE' && (!Number.isFinite(volume) || volume < 0))) {
      throw new Error('Bybit 合約 K 線數值無效');
    }
    return { openTime, open, high, low, close, volume: kind === 'MARK' ? 0 : volume };
  }).filter(c => c.openTime >= from && c.openTime <= to && c.openTime + HOUR_MS <= Date.now())
    .sort((a, b) => a.openTime - b.openTime) as Candle[];
}

/** 一週最多168筆每小時結算，低於 API 單頁200上限，避免不同商品費率間隔造成翻頁漏資料。 */
export async function bybitFundingRange(symbol: string, start: number, end: number): Promise<FundingPoint[]> {
  const result = await bybitPublic<BybitPage<{ fundingRateTimestamp: string; fundingRate: string }>>('funding/history', {
    category: 'linear', symbol, startTime: String(start), endTime: String(end), limit: '200',
  });
  if (!Array.isArray(result.list)) throw new Error('Bybit 資金費率格式錯誤');
  return result.list.map(row => {
    const time = Number(row.fundingRateTimestamp), rate = Number(row.fundingRate);
    if (!Number.isFinite(time) || !Number.isFinite(rate) || Math.abs(rate) > 1 || time % HOUR_MS) throw new Error('Bybit 資金費率數值或結算時間無效');
    return { time, rate };
  }).sort((a, b) => b.time - a.time);
}

/** Bybit 的風險級距和數量步進用於回測槓桿／最小成交檢查，精度由 qtyStep 推算。 */
export async function bybitFuturesMetadata(symbol: string): Promise<FuturesResearchMetadata> {
  const [instrument, risk] = await Promise.all([
    bybitPublic<BybitPage<{
      symbol: string; status: string; fundingInterval: string;
      leverageFilter: { minLeverage: string; maxLeverage: string };
      lotSizeFilter: { minOrderQty: string; minNotionalValue: string; qtyStep: string };
    }>>('instruments-info', { category: 'linear', symbol }),
    bybitPublic<BybitPage<{
      symbol: string; riskLimitValue: string; maintenanceMargin: number; maxLeverage: string;
    }>>('risk-limit', { category: 'linear', symbol }),
  ]);
  const contract = instrument.list.find(row => row.symbol === symbol && row.status === 'Trading');
  const rows = risk.list.filter(row => row.symbol === symbol).sort((a, b) => Number(a.riskLimitValue) - Number(b.riskLimitValue));
  if (!contract || !rows.length) throw new Error('Bybit 永續商品未交易或風險級距不足');
  const tiers: MarginTier[] = rows.map((row, i) => ({ min: i ? Number(rows[i - 1].riskLimitValue) : 0,
    max: Number(row.riskLimitValue), rate: Number(row.maintenanceMargin), maxLeverage: Number(row.maxLeverage) }));
  const step = Number(contract.lotSizeFilter.qtyStep), minQuantity = Number(contract.lotSizeFilter.minOrderQty);
  const minNotional = Number(contract.lotSizeFilter.minNotionalValue), maxLeverage = Number(contract.leverageFilter.maxLeverage);
  const fundingIntervalHours = Number(contract.fundingInterval) / 60;
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(minQuantity) || minQuantity <= 0
    || !Number.isFinite(minNotional) || minNotional <= 0 || !Number.isFinite(maxLeverage) || maxLeverage < 1
    /** 回測以1H K 線結算資金費；小時以下或非整小時週期無法可靠還原，必須拒絕。 */
    || !Number.isInteger(fundingIntervalHours) || fundingIntervalHours < 1
    || tiers.some(t => !Object.values(t).every(Number.isFinite) || t.max <= t.min || t.rate <= 0 || t.rate >= 1 || t.maxLeverage < 1)) {
    throw new Error('Bybit 永續合約精度、費率或風險級距無效');
  }
  return { tiers, observedAt: Date.now(), precision: Math.max(0, (contract.lotSizeFilter.qtyStep.split('.')[1] ?? '').length),
    minQuantity, minNotional, quantityStep: step, minLeverage: Number(contract.leverageFilter.minLeverage), maxLeverage, fundingIntervalHours };
}
