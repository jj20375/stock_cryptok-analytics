/**
 * @file Solana 迷因幣戰情室帳本、風控限額、5 重出場巡檢與晚報統計（對應原文 book.py、watch.py、report.py）。
 * 副作用：讀寫 Cloudflare D1 的 `meme_desk_checks`、`meme_desk_positions`、`meme_desk_trades` 三張表。
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { memeDeskChecks, memeDeskPositions, memeDeskTrades } from '../../db/memeDeskSchema';
import { MEME_DESK_CONFIG } from './config';
import { fetchDexPoolSnapshot } from './market';
import type { MemeEveningReport, MemeOpenPositionView } from './types';

export type MemeDeskDb = ReturnType<typeof drizzle>;

/**
 * 確保三張 Meme Desk 資料表已存在於 D1 資料庫中。
 * 為什麼使用 prepare().run() 而非 exec()：Miniflare / Cloudflare D1 對單行多語句 exec() 相容性不佳，
 * 分別使用 prepare().run() 可確保在本機開發代理與正式 Worker 皆穩定運作。
 */
export async function ensureMemeDeskTables(d1: any): Promise<void> {
  if (!d1 || typeof d1.prepare !== 'function') return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS meme_desk_checks (id TEXT PRIMARY KEY NOT NULL, checked_at INTEGER NOT NULL, mint TEXT NOT NULL, symbol TEXT NOT NULL, stage TEXT NOT NULL, verdict TEXT NOT NULL, confidence REAL, reason TEXT NOT NULL, price_usd REAL, liquidity_usd REAL, pair_url TEXT, facts_json TEXT, pool_json TEXT, judge_json TEXT)`,
    `CREATE TABLE IF NOT EXISTS meme_desk_positions (mint TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, entry_price REAL NOT NULL, initial_qty REAL NOT NULL, remaining_qty REAL NOT NULL, peak_price REAL NOT NULL, initial_liquidity_usd REAL NOT NULL, last_price REAL NOT NULL, last_liquidity_usd REAL NOT NULL, opened_at INTEGER NOT NULL, steps INTEGER NOT NULL DEFAULT 0, ticket_usd REAL NOT NULL, pair_url TEXT, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS meme_desk_trades (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, mint TEXT NOT NULL, symbol TEXT NOT NULL, action TEXT NOT NULL, usd REAL NOT NULL, price REAL NOT NULL, pnl REAL NOT NULL, reason TEXT NOT NULL)`,
  ];
  for (const sql of statements) {
    try {
      await d1.prepare(sql).run();
    } catch {
      /** 忽略建表錯誤，由後續實際查詢處理 */
    }
  }
}

/** 取得當日 UTC 00:00:00 的毫秒時間戳與 YYYY-MM-DD 字串 */
export function getUtcDayBounds(nowMs = Date.now()): { dayStr: string; dayStartMs: number } {
  const iso = new Date(nowMs).toISOString();
  const dayStr = iso.slice(0, 10);
  const dayStartMs = Date.parse(`${dayStr}T00:00:00.000Z`);
  return { dayStr, dayStartMs };
}

/**
 * 計算今日（UTC 日）已實現總損益（對應原文 book.today_pnl()）。
 */
export async function getTodayRealizedPnlUsd(db: MemeDeskDb, nowMs = Date.now()): Promise<number> {
  const { dayStartMs } = getUtcDayBounds(nowMs);
  const rows = await db
    .select()
    .from(memeDeskTrades)
    .where(gte(memeDeskTrades.createdAt, dayStartMs));
  const total = rows.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  return Math.round(total * 100) / 100;
}

/**
 * 第 1 關（Stage 0）：本地帳本風控攔截器（對應原文 book.guard(mint)）。
 * 為什麼在最前面執行：這是不發送任何外部 API 請求的零成本檢查；
 * 若今日已觸發 -$50 停損熔斷、場內已滿 4 倉、或該幣 24 小時內剛出場過，直接擋掉省下所有網路請求。
 * @returns 若攔截則回傳原因代碼；若允許繼續檢查則回傳 null
 */
export async function evaluateBookGuard(
  db: MemeDeskDb,
  mint: string,
  nowMs = Date.now(),
): Promise<string | null> {
  const { dayStartMs } = getUtcDayBounds(nowMs);
  const cooldownCutoffMs = nowMs - MEME_DESK_CONFIG.cooldownHours * 3600 * 1000;

  const [openPositions, todayTrades, recentMintTrades] = await Promise.all([
    db.select().from(memeDeskPositions),
    db.select().from(memeDeskTrades).where(gte(memeDeskTrades.createdAt, dayStartMs)),
    db.select().from(memeDeskTrades).where(and(
      eq(memeDeskTrades.mint, mint),
      gte(memeDeskTrades.createdAt, cooldownCutoffMs),
    )),
  ]);

  const todayPnl = todayTrades.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  if (todayPnl <= -MEME_DESK_CONFIG.dailyLossHaltUsd) return 'halted_daily_loss';
  if (openPositions.some(pos => pos.mint === mint)) return 'already_open';
  if (openPositions.length >= MEME_DESK_CONFIG.maxOpenPositions) return 'max_open';

  const todayEntries = todayTrades.filter(row => row.action === 'open').length;
  if (todayEntries >= MEME_DESK_CONFIG.maxEntriesPerDay) return 'max_entries_today';

  if (recentMintTrades.some(row => row.action === 'close')) return 'cooldown';
  return null;
}

/**
 * 建立新模擬持倉並寫入開倉帳本（對應原文 book.open_position）。
 */
export async function openMemePosition(
  db: MemeDeskDb,
  params: {
    mint: string;
    symbol: string;
    priceUsd: number;
    liquidityUsd: number;
    pairUrl: string | null;
    ticketUsd?: number;
    nowMs?: number;
  },
): Promise<void> {
  const nowMs = params.nowMs ?? Date.now();
  const ticketUsd = params.ticketUsd ?? MEME_DESK_CONFIG.ticketUsd;
  const qty = params.priceUsd > 0 ? ticketUsd / params.priceUsd : 0;

  await db.insert(memeDeskPositions).values({
    mint: params.mint,
    symbol: params.symbol,
    entryPrice: params.priceUsd,
    initialQty: qty,
    remainingQty: qty,
    peakPrice: params.priceUsd,
    initialLiquidityUsd: params.liquidityUsd,
    lastPrice: params.priceUsd,
    lastLiquidityUsd: params.liquidityUsd,
    openedAt: nowMs,
    steps: 0,
    ticketUsd,
    pairUrl: params.pairUrl,
    updatedAt: nowMs,
  }).onConflictDoUpdate({
    target: memeDeskPositions.mint,
    set: {
      symbol: params.symbol,
      entryPrice: params.priceUsd,
      initialQty: qty,
      remainingQty: qty,
      peakPrice: params.priceUsd,
      initialLiquidityUsd: params.liquidityUsd,
      lastPrice: params.priceUsd,
      lastLiquidityUsd: params.liquidityUsd,
      openedAt: nowMs,
      steps: 0,
      ticketUsd,
      pairUrl: params.pairUrl,
      updatedAt: nowMs,
    },
  });

  await db.insert(memeDeskTrades).values({
    id: crypto.randomUUID(),
    createdAt: nowMs,
    mint: params.mint,
    symbol: params.symbol,
    action: 'open',
    usd: Math.round(ticketUsd * 100) / 100,
    price: params.priceUsd,
    pnl: 0,
    reason: 'entry',
  });
}

/**
 * 依原始倉位比例賣出持倉並計算已實現損益（對應原文 book.sell(mint, frac_of_original, price, reason)）。
 * @param fractionOfOriginal 賣出佔「原始買入數量（initialQty）」的比例（1.0 代表全數出清剩餘部位）
 */
export async function sellMemePosition(
  db: MemeDeskDb,
  mint: string,
  fractionOfOriginal: number,
  exitPriceUsd: number,
  reason: string,
  nowMs = Date.now(),
): Promise<{ pnlUsd: number; action: 'partial' | 'close'; symbol: string } | null> {
  const rows = await db.select().from(memeDeskPositions).where(eq(memeDeskPositions.mint, mint));
  const position = rows[0];
  if (!position) return null;

  const sellQty = Math.min(position.remainingQty, position.initialQty * fractionOfOriginal);
  const pnlUsd = Math.round(sellQty * (exitPriceUsd - position.entryPrice) * 100) / 100;
  const notionalUsd = Math.round(sellQty * exitPriceUsd * 100) / 100;
  const nextRemainingQty = position.remainingQty - sellQty;
  const isFullClose = nextRemainingQty <= position.initialQty * 1e-6;
  const action: 'partial' | 'close' = isFullClose ? 'close' : 'partial';

  await db.insert(memeDeskTrades).values({
    id: crypto.randomUUID(),
    createdAt: nowMs,
    mint,
    symbol: position.symbol,
    action,
    usd: notionalUsd,
    price: exitPriceUsd,
    pnl: pnlUsd,
    reason,
  });

  if (isFullClose) {
    await db.delete(memeDeskPositions).where(eq(memeDeskPositions.mint, mint));
  } else {
    await db
      .update(memeDeskPositions)
      .set({
        remainingQty: nextRemainingQty,
        lastPrice: exitPriceUsd,
        updatedAt: nowMs,
      })
      .where(eq(memeDeskPositions.mint, mint));
  }

  return { pnlUsd, action, symbol: position.symbol };
}

/**
 * 執行每 10 分鐘持倉巡檢與 5 重自動化出場判斷（對應原文 watch.py）。
 * 出場優先順序：
 * 1. 池子消失（pool_gone）-> 視為 Rug 歸零出清
 * 2. 抽池逃生（liquidity_pulled）：流動性較進場時跌逾 40% -> 100% 全出
 * 3. 硬停損（stop）：跌幅達 -35% -> 100% 全出
 * 4. 階梯停利（take_profit_100 / take_profit_200）：+100% 賣半、+200% 再賣 1/4
 * 5. 移動停利（trailing_stop）：已過第一階停利且自最高價回落 30% -> 剩餘全出
 * 6. 時間停損（time_stop）：滿 6 小時漲幅未達 +20% -> 視為死錢全出
 */
export async function watchMemePositions(
  db: MemeDeskDb,
  nowMs = Date.now(),
): Promise<string[]> {
  const events: string[] = [];
  const positions = await db.select().from(memeDeskPositions);
  const exitRules = MEME_DESK_CONFIG.exit;

  for (const pos of positions) {
    let pool;
    try {
      pool = await fetchDexPoolSnapshot(pos.mint, nowMs);
    } catch (error: any) {
      events.push(`${pos.symbol}: 價格來源暫時無法連線 (${error?.message || 'timeout'})，維持持倉待下輪重試`);
      continue;
    }

    if (!pool || pool.priceUsd <= 0) {
      await sellMemePosition(db, pos.mint, 1.0, 0, 'pool_gone', nowMs);
      events.push(`${pos.symbol}: 流動池已消失 (pool_gone)，視為 Rug 歸零平倉`);
      continue;
    }

    const currentPrice = pool.priceUsd;
    const nextPeak = Math.max(pos.peakPrice, currentPrice);
    await db
      .update(memeDeskPositions)
      .set({
        peakPrice: nextPeak,
        lastPrice: currentPrice,
        lastLiquidityUsd: pool.liquidityUsd,
        updatedAt: nowMs,
      })
      .where(eq(memeDeskPositions.mint, pos.mint));

    const pct = ((currentPrice / pos.entryPrice) - 1) * 100;
    const heldHours = (nowMs - pos.openedAt) / (3600 * 1000);

    const recordExitEvent = async (fraction: number, reason: string) => {
      const result = await sellMemePosition(db, pos.mint, fraction, currentPrice, reason, nowMs);
      if (!result) return;
      const sizeLabel = fraction >= 1 ? '全數剩餘部位' : `${Math.round(fraction * 100)}% 原始部位`;
      const signPct = pct >= 0 ? `+${pct.toFixed(0)}%` : `${pct.toFixed(0)}%`;
      const signPnl = result.pnlUsd >= 0 ? `+$${result.pnlUsd.toFixed(2)}` : `-$${Math.abs(result.pnlUsd).toFixed(2)}`;
      events.push(`${pos.symbol}: 已模擬賣出 ${sizeLabel} @ ${signPct} (${reason})，已實現損益 ${signPnl}`);
    };

    /** 規則 1：抽池 40% 立即逃生 */
    if (pool.liquidityUsd < pos.initialLiquidityUsd * (1 - exitRules.liqDropPct / 100)) {
      await recordExitEvent(1.0, 'liquidity_pulled');
      continue;
    }

    /** 規則 2：-35% 硬停損 */
    if (pct <= exitRules.stopPct) {
      await recordExitEvent(1.0, 'stop');
      continue;
    }

    /** 規則 3：+100% 賣 50%、+200% 賣 25% 階梯停利 */
    if (pos.steps < exitRules.ladder.length && pct >= exitRules.ladder[pos.steps].targetPct) {
      const stepRule = exitRules.ladder[pos.steps];
      await recordExitEvent(stepRule.sellFractionOfInitial, `take_profit_${stepRule.targetPct}`);
      await db
        .update(memeDeskPositions)
        .set({ steps: pos.steps + 1, updatedAt: nowMs })
        .where(eq(memeDeskPositions.mint, pos.mint));
      continue;
    }

    /** 規則 4：完成第一階停利後，自最高價回落 30% 觸發移動停利 */
    if (pos.steps > 0 && currentPrice <= nextPeak * (1 - exitRules.trailPct / 100)) {
      await recordExitEvent(1.0, 'trailing_stop');
      continue;
    }

    /** 規則 5：持倉滿 6 小時未漲達 +20%，時間停損清出死錢 */
    if (heldHours >= exitRules.timeStopHours && pct < exitRules.timeStopMinPct) {
      await recordExitEvent(1.0, 'time_stop');
    }
  }

  return events;
}

/**
 * 讀取目前持倉並換算即時未實現損益視圖。
 */
export async function listOpenMemePositions(
  db: MemeDeskDb,
  nowMs = Date.now(),
): Promise<MemeOpenPositionView[]> {
  const rows = await db.select().from(memeDeskPositions).orderBy(desc(memeDeskPositions.openedAt));
  return rows.map(pos => {
    const unrealizedPct = pos.entryPrice > 0 ? ((pos.lastPrice / pos.entryPrice) - 1) * 100 : 0;
    const marketValueUsd = pos.remainingQty * pos.lastPrice;
    const unrealizedPnlUsd = pos.remainingQty * (pos.lastPrice - pos.entryPrice);
    const liquidityChangePct = pos.initialLiquidityUsd > 0
      ? ((pos.lastLiquidityUsd / pos.initialLiquidityUsd) - 1) * 100
      : 0;
    const heldHours = Math.max(0, (nowMs - pos.openedAt) / (3600 * 1000));

    return {
      mint: pos.mint,
      symbol: pos.symbol,
      entryPrice: pos.entryPrice,
      lastPrice: pos.lastPrice,
      peakPrice: pos.peakPrice,
      initialQty: pos.initialQty,
      remainingQty: pos.remainingQty,
      initialLiquidityUsd: pos.initialLiquidityUsd,
      lastLiquidityUsd: pos.lastLiquidityUsd,
      openedAt: pos.openedAt,
      updatedAt: pos.updatedAt,
      steps: pos.steps,
      ticketUsd: pos.ticketUsd,
      pairUrl: pos.pairUrl,
      unrealizedPct: Math.round(unrealizedPct * 100) / 100,
      marketValueUsd: Math.round(marketValueUsd * 100) / 100,
      unrealizedPnlUsd: Math.round(unrealizedPnlUsd * 100) / 100,
      liquidityChangePct: Math.round(liquidityChangePct * 100) / 100,
      heldHours: Math.round(heldHours * 10) / 10,
    };
  });
}

/**
 * 彙整當日擊殺漏斗與交易績效晚報（對應原文 report.py 的 EVENING REPORT）。
 */
export async function buildMemeEveningReport(
  db: MemeDeskDb,
  nowMs = Date.now(),
): Promise<MemeEveningReport> {
  const { dayStr, dayStartMs } = getUtcDayBounds(nowMs);
  const [todayChecks, todayTrades, openPositions] = await Promise.all([
    db.select().from(memeDeskChecks).where(gte(memeDeskChecks.checkedAt, dayStartMs)),
    db.select().from(memeDeskTrades).where(gte(memeDeskTrades.createdAt, dayStartMs)),
    db.select().from(memeDeskPositions),
  ]);

  const skips = todayChecks.filter(row => row.verdict === 'SKIP');
  const buys = todayChecks.filter(row => row.verdict === 'BUY');
  const closedTrades = todayTrades.filter(row => row.action !== 'open');
  const greenTrades = closedTrades.filter(row => Number(row.pnl) > 0);
  const realizedPnlTodayUsd = Math.round(
    closedTrades.reduce((sum, row) => sum + Number(row.pnl || 0), 0) * 100,
  ) / 100;

  let bestTrade: { symbol: string; pnlUsd: number } | null = null;
  let worstTrade: { symbol: string; pnlUsd: number } | null = null;
  for (const trade of closedTrades) {
    const pnlUsd = Number(trade.pnl || 0);
    if (!bestTrade || pnlUsd > bestTrade.pnlUsd) bestTrade = { symbol: trade.symbol, pnlUsd };
    if (!worstTrade || pnlUsd < worstTrade.pnlUsd) worstTrade = { symbol: trade.symbol, pnlUsd };
  }

  /** 統計 facts 與 pool 階段最常見的硬過濾死因（對應原文 most common kill） */
  const reasonCounts = new Map<string, number>();
  for (const row of skips) {
    if (row.stage === 'facts' || row.stage === 'pool') {
      reasonCounts.set(row.reason, (reasonCounts.get(row.reason) || 0) + 1);
    }
  }
  let mostCommonKill: { reason: string; count: number } | null = null;
  for (const [reason, count] of reasonCounts.entries()) {
    if (!mostCommonKill || count > mostCommonKill.count) {
      mostCommonKill = { reason, count };
    }
  }

  return {
    day: dayStr,
    paperMode: MEME_DESK_CONFIG.paperMode,
    checkedCount: todayChecks.length,
    killedByLimits: skips.filter(row => row.stage === 'limits').length,
    killedByFacts: skips.filter(row => row.stage === 'facts').length,
    killedByPool: skips.filter(row => row.stage === 'pool').length,
    killedByJudge: skips.filter(row => row.stage === 'judge').length,
    boughtCount: buys.length,
    openNowCount: openPositions.length,
    realizedPnlTodayUsd,
    greenExitsCount: greenTrades.length,
    totalExitsCount: closedTrades.length,
    bestTrade,
    worstTrade,
    mostCommonKill,
  };
}
