/** @file 登入頁面觸發的公開行情掃描；不寫入資料庫、不發通知、不連接券商、不下單。 */
import { analyzeDaytradeStock, rankDaytradeStocks } from './analysis';
import { daytradeUniverse, fetchDaytradeCandles } from './market';
import { DAYTRADE_RULES, isDaytradePriceEligible, type DaytradeScan, type DaytradeStockResult } from './types';

/** 同 Worker 實例共用公開行情結果 60 秒並合併同時請求，避免按鈕連點對 Yahoo 重複大量抓取。 */
let cached: DaytradeScan | null = null;
let pending: Promise<DaytradeScan> | null = null;
export function latestDaytradeScan(now = Date.now()): Promise<DaytradeScan> {
  if (cached && now - cached.scannedAt < 60_000) return Promise.resolve(cached);
  if (pending) return pending;
  pending = scanDaytradeStocks(now).then(result => { cached = result; return result; }).finally(() => { pending = null; });
  return pending;
}

export async function scanDaytradeStocks(now: number, dependencies = { daytradeUniverse, fetchDaytradeCandles }) {
  const { pool, source } = await dependencies.daytradeUniverse();
  const stocks: DaytradeStockResult[] = [], errors: DaytradeScan['errors'] = [];
  let cursor = 0;
  let priceExcluded = 0;
  /** 最多六個同時抓取、36 檔固定池；限制頁面掃描負擔，逾 45 秒未開始的標的明確記為未完成。 */
  const deadline = Date.now() + 45_000;
  const selected = pool.slice(0, DAYTRADE_RULES.poolLimit);
  await Promise.all(Array.from({ length: Math.min(6, selected.length) }, async () => {
    while (cursor < selected.length) {
      const ticker = selected[cursor++];
      if (Date.now() > deadline) { errors.push({ symbol: ticker.symbol, message: '掃描時間上限，尚未抓取' }); continue; }
      try {
        const candles = await dependencies.fetchDaytradeCandles(ticker.symbol, now);
        /** 初篩報價可能是前日收盤；本輪最新 15 分收盤超過 300 元時，明細及兩種榜單均不保留。 */
        if (candles.length && !isDaytradePriceEligible(candles.at(-1)!.close)) { priceExcluded++; continue; }
        stocks.push(analyzeDaytradeStock(ticker.symbol, ticker.name, candles, now));
      } catch (error) {
        errors.push({ symbol: ticker.symbol, message: error instanceof Error ? error.message : '15 分資料分析失敗' });
      }
    }
  }));
  return { scannedAt: now, completedAt: Date.now(), selected: selected.length, scanned: stocks.length, priceExcluded, universeSource: source,
    candidates: rankDaytradeStocks(stocks, true), research: rankDaytradeStocks(stocks, false),
    stocks: stocks.sort((a, b) => a.symbol.localeCompare(b.symbol)), errors } satisfies DaytradeScan;
}
