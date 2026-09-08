/**
 * 【詳細繁體中文註解】：K 線快取存取層(D1 kline_cache 表)
 *
 * 職責:
 *   1. 批次寫入歷史 K 線(INSERT OR IGNORE,重複的 openTime 直接略過)
 *   2. 缺口偵測:找出指定區間內尚未快取的時間段,讓補抓只抓缺的部分
 *   3. 區間讀取:keyset 分頁撈取,組回記憶體陣列供回測引擎使用
 *
 * D1(SQLite)限制與對策:
 *   - 單一語句 bind 參數上限 100 → 每列 10 個參數,每語句最多寫 10 列,
 *     再用 db.batch() 將多個語句打包成一次往返,兼顧額度與效能。
 *   - 單次查詢列數不宜過大 → 讀取以 5000 列為一頁 keyset 分頁。
 *
 * DB 寫入副作用註記:寫入失敗會讓該次 prepare 中斷,呼叫端(runner/api)須回報 ERROR,
 * 已寫入的部分因 UNIQUE 索引保護,重跑 prepare 不會產生重複資料。
 */

import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { klineCache } from '../../db/schema';
import type { Candle } from '../strategy/types';

type D1Db = ReturnType<typeof drizzle>;

// 每個 INSERT 語句最多寫入的列數:9 參數/列 × 10 列 = 90 參數 < D1 上限 100
const ROWS_PER_STATEMENT = 10;
// 每次 db.batch() 打包的語句數(一次往返寫 50 × 10 = 500 根 K 線)
const STATEMENTS_PER_BATCH = 50;
// 讀取分頁大小
const READ_PAGE_SIZE = 5000;

export type MarketType = 'CRYPTO' | 'US' | 'TW';

/** 批次寫入 K 線(INSERT OR IGNORE);回傳嘗試寫入的根數 */
export const upsertKlines = async (
  db: D1Db,
  market: MarketType,
  symbol: string,
  interval: string,
  candles: Candle[]
): Promise<number> => {
  if (candles.length === 0) return 0;

  // 先切成每語句 ROWS_PER_STATEMENT 列
  const statements = [] as any[];
  for (let i = 0; i < candles.length; i += ROWS_PER_STATEMENT) {
    const chunk = candles.slice(i, i + ROWS_PER_STATEMENT);
    statements.push(
      db
        .insert(klineCache)
        .values(
          chunk.map((c) => ({
            symbol,
            market,
            interval,
            openTime: c.openTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          }))
        )
        // (symbol, interval, open_time) 已存在時略過,確保重跑 prepare 不產生重複資料
        .onConflictDoNothing()
    );
  }

  // 再以 STATEMENTS_PER_BATCH 為單位打包送出
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    const group = statements.slice(i, i + STATEMENTS_PER_BATCH);
    await (db as any).batch(group);
  }

  return candles.length;
};

/**
 * 確保同一個加密交易對與週期只保留單一資料來源。
 * 切換來源時清空該組快取，避免 Binance 與 Bybit 的價格／成交量混合造成回測失真；
 * 呼叫端必須在 findGaps 前執行，讓它重新補足整個所需範圍。
 */
export const clearCryptoKlineSeries = async (db: D1Db, symbol: string, interval: string): Promise<void> => {
  await db.delete(klineCache).where(and(
    eq(klineCache.symbol, symbol),
    eq(klineCache.market, 'CRYPTO'),
    eq(klineCache.interval, interval)
  ));
};

/** 缺口(需要補抓的時間段,毫秒 UTC,兩端皆含) */
export interface KlineGap {
  from: number;
  to: number;
}

/**
 * 缺口偵測(適用固定週期的加密貨幣 K 線;美股日線因週末/休市有天然空洞,不適用本函式)。
 *
 * 作法:用 SQLite 窗函數 LEAD() 找出「相鄰兩根 openTime 差距 > 週期」的位置,
 * 加上區間頭尾的邊界檢查,組出所有缺口。全程在 DB 端計算,避免撈整段 openTime 回 Worker。
 */
export const findGaps = async (
  db: D1Db,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  intervalMs: number
): Promise<KlineGap[]> => {
  // 1) 取區間內現有資料的最小/最大 openTime 與總數
  const [coverage] = await db
    .select({
      count: sql<number>`count(*)`,
      minTime: sql<number | null>`min(${klineCache.openTime})`,
      maxTime: sql<number | null>`max(${klineCache.openTime})`,
    })
    .from(klineCache)
    .where(
      and(
        eq(klineCache.symbol, symbol),
        eq(klineCache.interval, interval),
        gte(klineCache.openTime, startTime),
        lte(klineCache.openTime, endTime)
      )
    );

  // 區間完全沒資料 → 整段都是缺口
  if (!coverage || coverage.count === 0 || coverage.minTime == null || coverage.maxTime == null) {
    return [{ from: startTime, to: endTime }];
  }

  const gaps: KlineGap[] = [];

  // 2) 頭部缺口:區間起點到第一根之間
  if (coverage.minTime - startTime >= intervalMs) {
    gaps.push({ from: startTime, to: coverage.minTime - 1 });
  }

  // 3) 中間缺口:用窗函數找相鄰差距異常處
  const holes = await (db as any).all(sql`
    SELECT open_time AS gap_start, next_time AS gap_end FROM (
      SELECT open_time,
             LEAD(open_time) OVER (ORDER BY open_time) AS next_time
      FROM kline_cache
      WHERE symbol = ${symbol} AND interval = ${interval}
        AND open_time >= ${startTime} AND open_time <= ${endTime}
    )
    WHERE next_time IS NOT NULL AND next_time - open_time > ${intervalMs}
  `);
  for (const hole of (holes?.rows ?? holes ?? []) as any[]) {
    const gapStart = Number(hole.gap_start ?? hole[0]);
    const gapEnd = Number(hole.gap_end ?? hole[1]);
    gaps.push({ from: gapStart + intervalMs, to: gapEnd - 1 });
  }

  // 4) 尾部缺口:最後一根到區間終點之間(終點若在未來,已收盤判斷交給抓取端過濾)
  if (endTime - coverage.maxTime >= intervalMs) {
    gaps.push({ from: coverage.maxTime + intervalMs, to: endTime });
  }

  return gaps;
};

/** 讀取指定區間的 K 線(keyset 分頁組回完整陣列,依 openTime 升冪) */
export const getKlineRange = async (
  db: D1Db,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> => {
  const result: Candle[] = [];
  let cursor = startTime - 1;

  // keyset 分頁:以上一頁最後一根的 openTime 為游標,避免 OFFSET 掃描浪費
  while (true) {
    const page = await db
      .select({
        openTime: klineCache.openTime,
        open: klineCache.open,
        high: klineCache.high,
        low: klineCache.low,
        close: klineCache.close,
        volume: klineCache.volume,
      })
      .from(klineCache)
      .where(
        and(
          eq(klineCache.symbol, symbol),
          eq(klineCache.interval, interval),
          gt(klineCache.openTime, cursor),
          lte(klineCache.openTime, endTime)
        )
      )
      .orderBy(asc(klineCache.openTime))
      .limit(READ_PAGE_SIZE);

    result.push(...page);
    if (page.length < READ_PAGE_SIZE) break;
    cursor = page[page.length - 1].openTime;
  }

  return result;
};

/** 取得某標的快取的最新一根 openTime(增量更新用);無資料回傳 null */
export const getLatestOpenTime = async (
  db: D1Db,
  symbol: string,
  interval: string
): Promise<number | null> => {
  const [row] = await db
    .select({ maxTime: sql<number | null>`max(${klineCache.openTime})` })
    .from(klineCache)
    .where(and(eq(klineCache.symbol, symbol), eq(klineCache.interval, interval)));
  return row?.maxTime ?? null;
};
