/** @file 合約研究分頁資料準備；重用回測任務與快取，以商品前綴隔離舊現貨資料。 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { backtests } from '../../db/schema';
import { findGaps, getKlineRange, upsertKlines } from '../marketData/klineStore';
import { futuresCandlesPage, futuresCacheKey, fundingPage, futuresMetadata, type FuturesInstrument, type FuturesResearchMetadata } from './market.server';
import { bybitFuturesCandlesPage, bybitFundingRange, bybitFuturesMetadata } from './bybitMarket.server';
import { FUTURES_WARMUP, HOUR_MS } from '../strategy/futuresRegime';
import type { FundingPoint, FuturesSimulation } from '../backtest/futures';
import type { BacktestRunParams } from '../backtest/runner';

export interface FuturesResearchSettings {
  instrument: FuturesInstrument;
  leverage: number;
  direction: 'BOTH' | 'LONG' | 'SHORT';
  rulesVersion?: number;
  data?: { funding: FundingPoint[]; page: number; fundingCursor?: number; complete: boolean; exhausted?: boolean; metadata: FuturesResearchMetadata };
}
type Db = ReturnType<typeof drizzle>;
export const futuresResearchStart = (start: number) => Math.floor(start / HOUR_MS) * HOUR_MS - (FUTURES_WARMUP + 8) * HOUR_MS;

export async function prepareFuturesResearch(db: Db, row: typeof backtests.$inferSelect, params: BacktestRunParams) {
  if (row.status === 'RUNNING') throw new Error('研究正在計算，請勿重複準備同一任務');
  const settings = params.futures!;
  const bybit = settings.instrument === 'BYBIT_USDT_PERP', provider = bybit ? 'Bybit' : 'Bitget';
  const from = futuresResearchStart(row.startTime), end = Math.min(Math.floor(row.endTime / HOUR_MS) * HOUR_MS - HOUR_MS, Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS);
  if (!settings.data) settings.data = { funding: [], page: 1, fundingCursor: row.endTime, complete: false,
    metadata: bybit ? await bybitFuturesMetadata(row.symbol) : await futuresMetadata(row.symbol) };
  const state = settings.data;
  /** 每次最多四頁 K 線與一頁費率，續跑保留進度；快取寫入採唯一索引去重。 */
  let pages = 0;
  for (const kind of ['TRADE', 'MARK'] as const) {
    const key = futuresCacheKey(row.symbol, kind, settings.instrument), gaps = await findGaps(db, key, '1h', from, end, HOUR_MS);
    for (const gap of gaps) {
      let cursor = gap.to;
      while (cursor >= gap.from && pages < 4) {
        const candles = bybit ? await bybitFuturesCandlesPage(row.symbol, kind, gap.from, cursor)
          : await futuresCandlesPage(row.symbol, kind, gap.from, cursor); pages++;
        if (!candles.length) throw new Error(`${provider} ${kind} 歷史不足或有缺口，請縮短研究區間`);
        await upsertKlines(db, 'CRYPTO', key, '1h', candles);
        const oldest = candles[0].openTime;
        if (oldest > cursor) throw new Error('合約行情分頁沒有推進');
        cursor = oldest - HOUR_MS;
      }
    }
  }
  if (!state.complete) {
    if (bybit) {
      /** 依結算週期把每頁限制在190筆；舊版已保存的 Bitget 任務缺週期欄位時沿用8小時。 */
      const intervalHours = state.metadata.fundingIntervalHours ?? 8;
      const chunkHours = Math.min(7 * 24, Math.floor(190 * intervalHours));
      const cursor = state.fundingCursor ?? row.endTime, chunkStart = Math.max(from, cursor - chunkHours * HOUR_MS);
      const rows = await bybitFundingRange(row.symbol, chunkStart, cursor);
      state.fundingCursor = chunkStart - 1;
      state.funding = [...new Map([...state.funding, ...rows].filter(p => p.time <= row.endTime).map(p => [p.time, p])).values()].sort((a, b) => a.time - b.time);
      state.complete = state.funding.filter(p => p.time < row.startTime).length >= 2;
      if (!state.complete && chunkStart <= from) { state.exhausted = true; throw new Error('Bybit 歷史資金費率無法覆蓋研究起點，請縮短區間'); }
    } else {
      if (state.page > 100) throw new Error('資金費率分頁超過上限，請縮短研究區間');
      const rows = await fundingPage(row.symbol, state.page++);
      state.funding = [...new Map([...state.funding, ...rows].filter(p => p.time <= row.endTime).map(p => [p.time, p])).values()].sort((a, b) => a.time - b.time);
      /** 至少取到研究起點之前兩個結算，讓預估成本只用當時可知費率。 */
      state.complete = state.funding.filter(p => p.time < row.startTime).length >= 2;
      if (!state.complete && rows.length < 100) { state.exhausted = true; throw new Error('歷史資金費率無法覆蓋研究起點，請縮短區間'); }
    }
  }
  const gaps = await Promise.all(['TRADE', 'MARK'].map(kind => findGaps(db, futuresCacheKey(row.symbol, kind as 'TRADE' | 'MARK', settings.instrument), '1h', from, end, HOUR_MS)));
  if (state.complete) {
    const settlements = state.funding.filter(point => point.time >= row.startTime - 16 * HOUR_MS && point.time <= end + HOUR_MS);
    /** 依商品資金費率週期抓缺口；不能把缺失費率當成零成本。 */
    const maxFundingGap = (state.metadata.fundingIntervalHours ?? 8) * HOUR_MS + 60_000;
    if (!settlements.length || settlements.at(-1)!.time < end - maxFundingGap || settlements.some((point, i) => i > 0 && point.time - settlements[i - 1].time > maxFundingGap)) {
      throw new Error('資金費率歷史有缺口或末端未覆蓋，請縮短研究區間');
    }
  }
  const complete = gaps.every(group => group.length === 0) && state.complete;
  /** 條件寫入避免同任務的並行 prepare 用舊快照覆蓋新進度。 */
  await db.update(backtests).set({ paramsJson: JSON.stringify(params), status: 'PREPARING', error: null })
    .where(and(eq(backtests.id, row.id), eq(backtests.paramsJson, row.paramsJson), eq(backtests.status, row.status)));
  return { complete, message: complete ? `${provider} 永續成交價、標記價與歷史資金費率已就緒` : `補抓 ${provider} 永續中・本輪 ${pages} 頁行情・費率 ${state.funding.length} 筆` };
}

export async function readFuturesResearch(db: Db, symbol: string, start: number, end: number, settings: FuturesResearchSettings) {
  if (!settings.data?.complete) throw new Error('合約資料尚未完成 prepare');
  const from = futuresResearchStart(start), to = Math.min(Math.floor(end / HOUR_MS) * HOUR_MS - HOUR_MS, Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS);
  const [candles, marks] = await Promise.all(['TRADE', 'MARK'].map(kind => getKlineRange(db, futuresCacheKey(symbol, kind as 'TRADE' | 'MARK', settings.instrument), '1h', from, to)));
  /** 圖表與回測都要求連續 1H；不以缺根的 4H 聚合結果產生訊號。 */
  if (!candles.length || candles[0].openTime !== from || candles.at(-1)!.openTime !== to
    || candles.some((c, i) => i > 0 && c.openTime - candles[i - 1].openTime !== HOUR_MS)) throw new Error('合約成交價歷史有缺口');
  const markComplete = marks.length === candles.length && marks.every((c, i) => c.openTime === candles[i].openTime);
  const config: FuturesSimulation = { leverage: settings.leverage, funding: settings.data.funding, marks,
    tiers: markComplete ? settings.data.metadata.tiers : [], tiersObservedAt: settings.data.metadata.observedAt, fundingComplete: true, direction: settings.direction,
    minQuantity: settings.data.metadata.minQuantity, minNotional: settings.data.metadata.minNotional, quantityStep: settings.data.metadata.quantityStep,
    minLeverage: settings.data.metadata.minLeverage };
  return { candles, config, markComplete };
}
