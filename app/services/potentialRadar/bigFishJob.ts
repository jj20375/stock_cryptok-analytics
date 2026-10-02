/**
 * @file 潛力幣雷達的 4 小時吃大魚獨立排程：抓公開現貨 4 小時 K、計算後寫入 potential_big_fish，絕不下單。
 * 獨立成一次 Worker 執行，是因為免費方案每次執行最多 50 個子請求（含 D1 查詢），
 * 雷達本身已用到約 48 個，無法再為每檔多抓一次 4 小時 K 線。
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { potentialBigFish } from '../../db/potentialSchema';
import { analyzeBigFish } from './bigFish';
import { fetchRadarFourHourCandles, fetchUniverse } from './market';
import { DAY_MS, FOUR_HOUR_MS, type MarketTicker } from './types';
import type { PotentialEnv } from './scanner';

export const BIG_FISH_JOB_RULES = {
  /** 每次執行最多算 40 檔：2 個名單請求 + 40 個 K 線 + 約 4 個 D1 操作，留在 50 個子請求內。 */
  batchSize: 40,
  /** 五檔並行，單一慢標的不拖垮整批。 */
  concurrency: 5,
  /** 二十秒內收尾；未算到的標的由 15 分鐘後的下一次執行接續。 */
  budgetMs: 20_000,
  /** 只需最新一根；保留兩天讓切換來源或短暫停機後仍可回查。 */
  retentionMs: 2 * DAY_MS,
} as const;

/** 先算雷達最可能挑中的強勢與高成交額標的，確保 4 小時收盤後最先被看到的候選優先有結果。 */
export function prioritizeBigFishSymbols(universe: MarketTicker[]): string[] {
  const gainers = universe.filter(coin => coin.change24h > 0)
    .sort((a, b) => b.change24h - a.change24h || a.symbol.localeCompare(b.symbol)).slice(0, 20);
  const liquid = [...universe].sort((a, b) => b.turnover24h - a.turnover24h || a.symbol.localeCompare(b.symbol));
  return [...new Set([...gainers, ...liquid].map(coin => coin.symbol))];
}

export async function runPotentialBigFish(env: PotentialEnv) {
  if (env.POTENTIAL_RADAR_ENABLED !== 'true') return;
  const startedAt = Date.now();
  const fourHourCutoff = Math.floor(startedAt / FOUR_HOUR_MS) * FOUR_HOUR_MS;
  const barTime = fourHourCutoff - FOUR_HOUR_MS;
  try {
    const db = drizzle(env.DB);
    /** 與雷達相同的來源選擇規則：Bybit 優先，整輪不可用才改 Gate；雷達只沿用同來源結果。 */
    let source: 'BYBIT_SPOT' | 'GATE_SPOT' = 'BYBIT_SPOT';
    let universe: MarketTicker[];
    try {
      universe = await fetchUniverse(source);
    } catch {
      source = 'GATE_SPOT';
      universe = await fetchUniverse(source);
    }
    const done = await db.select({ symbol: potentialBigFish.symbol }).from(potentialBigFish)
      .where(and(eq(potentialBigFish.source, source), eq(potentialBigFish.barTime, barTime)));
    const doneSymbols = new Set(done.map(row => row.symbol));
    const pending = prioritizeBigFishSymbols(universe).filter(symbol => !doneSymbols.has(symbol))
      .slice(0, BIG_FISH_JOB_RULES.batchSize);
    if (!pending.length) return;

    const rows: Array<typeof potentialBigFish.$inferInsert> = [];
    for (let start = 0; start < pending.length; start += BIG_FISH_JOB_RULES.concurrency) {
      if (Date.now() - startedAt >= BIG_FISH_JOB_RULES.budgetMs) break;
      const batch = await Promise.all(pending.slice(start, start + BIG_FISH_JOB_RULES.concurrency).map(async symbol => {
        try {
          const fish = analyzeBigFish(await fetchRadarFourHourCandles(symbol, fourHourCutoff, source));
          return { symbol, source, barTime, checkedAt: Date.now(), error: fish ? null : '4 小時歷史不足',
            signalJson: fish ? JSON.stringify({ ...fish, timeframe: '4h' }) : null };
        } catch (error) {
          /** 失敗也寫入本根紀錄，避免新幣或下架標的每 15 分鐘被重抓、擠掉其他標的的額度。 */
          return { symbol, source, barTime, checkedAt: Date.now(), signalJson: null,
            error: error instanceof Error ? error.message : '4 小時行情無法取得' };
        }
      }));
      rows.push(...batch);
    }

    /** 每列六個參數，每批十六列，確保單一 SQL 不超過 D1 的 100 個綁定參數。 */
    const writes = [];
    for (let index = 0; index < rows.length; index += 16) {
      writes.push(db.insert(potentialBigFish).values(rows.slice(index, index + 16)).onConflictDoUpdate({
        target: [potentialBigFish.symbol, potentialBigFish.source],
        set: { barTime: sqlExcluded('bar_time'), signalJson: sqlExcluded('signal_json'),
          error: sqlExcluded('error'), checkedAt: sqlExcluded('checked_at') },
      }));
    }
    const cleanup = db.delete(potentialBigFish).where(lt(potentialBigFish.barTime, barTime - BIG_FISH_JOB_RULES.retentionMs));
    /** 寫入與清理同一次 batch 送出，只占一個子請求。 */
    await db.batch([cleanup, ...writes]);
  } catch {
    console.error('[PotentialRadar BigFish] 4 小時吃大魚排程未完成，請檢查 0022 migration 與公開行情連線');
  }
}

/** upsert 時取本次插入的值；欄位名稱為程式內固定字串，不含任何外部輸入。 */
function sqlExcluded(column: 'bar_time' | 'signal_json' | 'error' | 'checked_at') {
  return sql.raw(`excluded.${column}`);
}
