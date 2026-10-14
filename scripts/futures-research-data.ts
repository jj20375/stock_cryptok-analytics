/** @file 只讀公開 Bitget 行情的研究工具；只寫指定資料夾，不碰帳戶、正式資料庫或下單。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { futuresCandlesPage, fundingPage, futuresMetadata } from '../app/services/cryptoFutures/market.server';
import { HOUR_MS, FUTURES_WARMUP } from '../app/services/strategy/futuresRegime';
import type { Candle } from '../app/services/strategy/types';
import type { FundingPoint } from '../app/services/backtest/futures';

/** 研究前固定五個流動性較高的商品；不得按結果刪除虧損幣。 */
export const RESEARCH_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'SUIUSDT'];
export interface ResearchData {
  symbol: string; start: number; end: number; candles: Candle[]; marks: Candle[]; funding: FundingPoint[];
  metadata: Awaited<ReturnType<typeof futuresMetadata>>;
}
export async function collectResearchData(directory: string, symbol: string, start: number, end: number): Promise<ResearchData> {
  const file = join(directory, `${symbol}.json`);
  try {
    const existing = JSON.parse(await readFile(file, 'utf8')) as ResearchData;
    if (existing.start === start && existing.end === end) { validateResearchData(existing); return existing; }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(directory, { recursive: true });
  const from = start - (FUTURES_WARMUP + 8) * HOUR_MS;
  const fetchKind = async (kind: 'TRADE' | 'MARK') => {
    const checkpoint = join(directory, `${symbol}-${kind}.json`);
    let rows: Candle[] = [];
    try {
      const cached = JSON.parse(await readFile(checkpoint, 'utf8'));
      if (cached.from === from && cached.end === end) rows = cached.rows;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (let cursor = rows.length ? Math.min(...rows.map(c => c.openTime)) - HOUR_MS : end - HOUR_MS; cursor >= from;) {
      /** 兩條序列合計約每秒四次；遇 429 等待再試，不用高頻重送或改來源補值。 */
      await delay(500);
      let page: Candle[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        try { page = await futuresCandlesPage(symbol, kind, from, cursor); break; }
        catch (error) {
          if (!(error instanceof Error) || !error.message.includes('429') || attempt === 2) throw error;
          await delay(2000 * (attempt + 1));
        }
      }
      if (!page.length || page[0].openTime > cursor) throw new Error(`${symbol} ${kind} 歷史不足`);
      rows.push(...page); cursor = page[0].openTime - HOUR_MS;
      await writeFile(checkpoint, JSON.stringify({ from, end, rows }));
    }
    return [...new Map(rows.map(c => [c.openTime, c])).values()].sort((a, b) => a.openTime - b.openTime);
  };
  /** 每商品兩條歷史序列並行，商品順序抓取，避免大量同時請求觸及 API 限流。 */
  const [candles, marks] = await Promise.all([fetchKind('TRADE'), fetchKind('MARK')]);
  const funding: FundingPoint[] = [];
  for (let page = 1; page <= 100; page++) {
    await delay(500);
    const points = await fundingPage(symbol, page);
    funding.push(...points.filter(p => p.time <= end));
    if (funding.filter(p => p.time < start).length >= 2) break;
    if (points.length < 100 || page === 100) throw new Error(`${symbol} 歷史費率不足`);
  }
  const data = { symbol, start, end, candles, marks,
    funding: [...new Map(funding.map(p => [p.time, p])).values()].sort((a, b) => a.time - b.time), metadata: await futuresMetadata(symbol) };
  validateResearchData(data);
  await writeFile(file, JSON.stringify(data));
  return data;
}
export function validateResearchData(data: ResearchData) {
  const from = data.start - (FUTURES_WARMUP + 8) * HOUR_MS;
  for (const rows of [data.candles, data.marks]) {
    if (!rows.length || rows[0].openTime !== from || rows.at(-1)!.openTime !== data.end - HOUR_MS
      || rows.some((c, i) => !Object.values(c).every(Number.isFinite) || c.openTime !== from + i * HOUR_MS
        || c.low <= 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.volume < 0)) {
      throw new Error(`${data.symbol} 行情不連續或數值無效`);
    }
  }
  const settlements = data.funding.filter(p => p.time >= data.start - 16 * HOUR_MS && p.time <= data.end);
  if (data.candles.length !== data.marks.length || data.funding.filter(p => p.time < data.start).length < 2
    || !settlements.length || settlements.at(-1)!.time < data.end - 8 * HOUR_MS
    || settlements.some((p, i) => !Number.isFinite(p.rate) || Math.abs(p.rate) > 1 || (i > 0 && p.time - settlements[i - 1].time > 8 * HOUR_MS))) {
    throw new Error(`${data.symbol} 標記價或歷史資金費率覆蓋不完整`);
  }
}
