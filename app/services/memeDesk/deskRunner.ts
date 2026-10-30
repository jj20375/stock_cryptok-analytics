/**
 * @file Solana 迷因幣防 Rug 戰情室主執行器（對應原文 check.py 與 scan.py，並強化為「僅掃描 Bitget 已上架幣種」模式）。
 * 職責：
 * 1. checkSolanaMint：支援輸入 Bitget 代號（如 WIF、BONK）或 Solana 合約地址（CA），先驗證是否為 Bitget 已上架幣種，
 *    再串聯 limits -> facts (Rugcheck) -> pool (DexScreener) -> judge (Gemini) 四階段漏斗。
 * 2. scanFreshSolanaTokens：從 Bitget 交易所已上架之 Solana 代幣清單中輪流挑選 5 顆執行 14 關審查。
 * 3. loadMemeDeskDashboard：供前端與 API 讀取完整戰情室狀態，並自動過濾非 Bitget 歷史雜訊。
 */
import { desc, notInArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { memeDeskChecks, memeDeskTrades } from '../../db/memeDeskSchema';
import { sendSlackMessage } from '../slackService';
import {
  BITGET_SOLANA_TOKEN_REGISTRY,
  fetchBitgetListedSolanaTokens,
  findBitgetTokenByMint,
  pickBitgetTokensForScan,
  resolveBitgetScanInput,
} from './bitgetListed';
import {
  buildMemeEveningReport,
  ensureMemeDeskTables,
  evaluateBookGuard,
  listOpenMemePositions,
  openMemePosition,
  watchMemePositions,
  type MemeDeskDb,
} from './book';
import { MEME_DESK_CONFIG } from './config';
import { askGeminiMemeJudge } from './geminiJudge';
import { evaluatePoolFacts, fetchDexPoolSnapshot, parseDexPoolSnapshot } from './market';
import { evaluateRugcheckFacts, fetchRugcheckReport, parseRugcheckReport } from './rugcheck';
import type {
  DexPoolSnapshot,
  GeminiJudgeVerdict,
  MemeCheckResult,
  MemeEveningReport,
  MemeOpenPositionView,
  RugcheckFacts,
} from './types';

export interface MemeDeskEnv {
  DB?: Parameters<typeof drizzle>[0];
  GEMINI_API_KEY?: string;
  AI_MODEL?: string;
  SLACK_API_TOKEN?: string;
  CRYPTO_ENTRY_SLACK_CHANNEL_ID?: string;
  SLACK_CHANNEL_ID?: string;
  /** 排程自動掃描開關：設為 "true" 時每 30 分鐘自動掃描 Bitget 已上架代幣、每 10 分鐘自動巡檢出場 */
  MEME_DESK_AUTO_SCAN_ENABLED?: string;
}

/**
 * 將單次審查結果寫入 `meme_desk_checks` 資料表（對應原文 check.log(row)）。
 */
async function persistCheckResult(db: MemeDeskDb, result: MemeCheckResult): Promise<void> {
  await db.insert(memeDeskChecks).values({
    id: result.id,
    checkedAt: result.checkedAt,
    mint: result.mint,
    symbol: result.symbol || result.mint.slice(0, 6),
    stage: result.stage,
    verdict: result.verdict,
    confidence: result.confidence,
    reason: result.reason,
    priceUsd: result.priceUsd,
    liquidityUsd: result.liquidityUsd,
    pairUrl: result.pairUrl,
    factsJson: result.facts ? JSON.stringify(result.facts) : null,
    poolJson: result.pool ? JSON.stringify(result.pool) : null,
    judgeJson: result.judge ? JSON.stringify(result.judge) : null,
  });
}

/**
 * 對單一 Bitget 代號（如 WIF、BONK）或 Solana 代幣合約地址（CA / Mint）執行完整 14 關審查。
 * 順序：0. Bitget 上架檢查 -> 1. Limits（本地風控） -> 2. Facts（Rugcheck 9 關） -> 3. Pool（DexScreener 4 關） -> 4. Judge（Gemini 第 14 關）。
 * @param env 環境變數與 D1 綁定
 * @param rawInput Bitget 代幣代號（如 WIF / WIFUSDT）或 Solana 代幣 Mint 地址
 * @param options.bypassLimits 手動單幣診斷時可選擇略過持倉槽上限以測試全套 14 關（預設 false）
 * @param options.allowUnlisted 是否允許檢測未在 Bitget 上架的代幣（預設依 MEME_DESK_CONFIG.onlyBitgetListed 為 false）
 */
export async function checkSolanaMint(
  env: MemeDeskEnv,
  rawInput: string,
  options: {
    bypassLimits?: boolean;
    autoOpenPaper?: boolean;
    allowUnlisted?: boolean;
    nowMs?: number;
    prefetchedRugcheckRaw?: any;
    prefetchedDexRaw?: any;
  } = {},
): Promise<MemeCheckResult> {
  const { mint, bitgetInfo } = resolveBitgetScanInput(rawInput);
  const nowMs = options.nowMs ?? Date.now();
  const id = crypto.randomUUID();
  const isBitgetListed = Boolean(bitgetInfo);
  const bitgetSymbol = bitgetInfo?.bitgetSymbol || null;

  if (!mint || (!bitgetInfo && (mint.length < 30 || mint.length > 50))) {
    throw new Error('請輸入 Bitget 已上架幣種代號（如 WIF、BONK、POPCAT、PNUT）或有效的 Solana 合約地址 (CA)');
  }

  const db = env.DB ? drizzle(env.DB) : null;
  if (env.DB) {
    await ensureMemeDeskTables(env.DB);
  }

  /** 第 0 階段：強制確認是否為 Bitget 交易所已上架幣種 */
  const enforceBitgetOnly = MEME_DESK_CONFIG.onlyBitgetListed && !options.allowUnlisted;
  if (enforceBitgetOnly && !isBitgetListed) {
    const result: MemeCheckResult = {
      id,
      checkedAt: nowMs,
      mint,
      symbol: mint.slice(0, 6),
      bitgetSymbol: null,
      stage: 'limits',
      verdict: 'SKIP',
      confidence: null,
      reason: 'not_listed_on_bitget',
      priceUsd: null,
      liquidityUsd: null,
      pairUrl: null,
      facts: null,
      pool: null,
      judge: null,
    };
    return result;
  }

  /** 第 1 階段：LIMITS（本地風控限額，零網路成本） */
  if (db && !options.bypassLimits) {
    const limitKill = await evaluateBookGuard(db, mint, nowMs);
    if (limitKill) {
      const result: MemeCheckResult = {
        id,
        checkedAt: nowMs,
        mint,
        symbol: bitgetInfo?.coin || mint.slice(0, 6),
        bitgetSymbol,
        stage: 'limits',
        verdict: 'SKIP',
        confidence: null,
        reason: limitKill,
        priceUsd: null,
        liquidityUsd: null,
        pairUrl: null,
        facts: null,
        pool: null,
        judge: null,
      };
      await persistCheckResult(db, result);
      return result;
    }
  }

  /** 第 2 階段：FACTS（Rugcheck 合約 9 項硬指標檢查，免費 API） */
  let facts: RugcheckFacts;
  try {
    facts = options.prefetchedRugcheckRaw
      ? parseRugcheckReport(mint, options.prefetchedRugcheckRaw)
      : await fetchRugcheckReport(mint);
  } catch (error: any) {
    const result: MemeCheckResult = {
      id,
      checkedAt: nowMs,
      mint,
      symbol: bitgetInfo?.coin || mint.slice(0, 6),
      bitgetSymbol,
      stage: 'facts',
      verdict: 'SKIP',
      confidence: null,
      reason: `rugcheck_failed:${error?.message || 'unknown'}`,
      priceUsd: null,
      liquidityUsd: null,
      pairUrl: null,
      facts: null,
      pool: null,
      judge: null,
    };
    if (db) await persistCheckResult(db, result);
    return result;
  }

  const factKill = evaluateRugcheckFacts(facts, { isBitgetListed });
  if (factKill) {
    const result: MemeCheckResult = {
      id,
      checkedAt: nowMs,
      mint,
      symbol: bitgetInfo?.coin || facts.symbol || mint.slice(0, 6),
      bitgetSymbol,
      stage: 'facts',
      verdict: 'SKIP',
      confidence: null,
      reason: factKill,
      priceUsd: null,
      liquidityUsd: null,
      pairUrl: null,
      facts,
      pool: null,
      judge: null,
    };
    if (db) await persistCheckResult(db, result);
    return result;
  }

  /** 第 3 階段：POOL（DexScreener 流動池 4 項硬指標檢查，免費 API） */
  let pool: DexPoolSnapshot | null;
  try {
    pool = options.prefetchedDexRaw
      ? parseDexPoolSnapshot(mint, options.prefetchedDexRaw, nowMs)
      : await fetchDexPoolSnapshot(mint, nowMs);
  } catch (error: any) {
    const result: MemeCheckResult = {
      id,
      checkedAt: nowMs,
      mint,
      symbol: bitgetInfo?.coin || facts.symbol || mint.slice(0, 6),
      bitgetSymbol,
      stage: 'pool',
      verdict: 'SKIP',
      confidence: null,
      reason: `dexscreener_failed:${error?.message || 'unknown'}`,
      priceUsd: null,
      liquidityUsd: null,
      pairUrl: null,
      facts,
      pool: null,
      judge: null,
    };
    if (db) await persistCheckResult(db, result);
    return result;
  }

  const poolKill = evaluatePoolFacts(pool, { isBitgetListed });
  if (poolKill || !pool) {
    const result: MemeCheckResult = {
      id,
      checkedAt: nowMs,
      mint,
      symbol: bitgetInfo?.coin || pool?.symbol || facts.symbol || mint.slice(0, 6),
      bitgetSymbol,
      stage: 'pool',
      verdict: 'SKIP',
      confidence: null,
      reason: poolKill || 'no_pool',
      priceUsd: pool?.priceUsd ?? null,
      liquidityUsd: pool?.liquidityUsd ?? null,
      pairUrl: pool?.pairUrl ?? null,
      facts,
      pool,
      judge: null,
    };
    if (db) await persistCheckResult(db, result);
    return result;
  }

  /** 第 4 階段：JUDGE（唯一消耗 AI 配額的步驟：僅對通過前 13 關的倖存者呼叫 Gemini） */
  const symbol = bitgetInfo?.coin || pool.symbol || facts.symbol || mint.slice(0, 6);
  let judge: GeminiJudgeVerdict;
  try {
    judge = await askGeminiMemeJudge(facts, pool, env);
  } catch (error: any) {
    const result: MemeCheckResult = {
      id,
      checkedAt: nowMs,
      mint,
      symbol,
      bitgetSymbol,
      stage: 'judge',
      verdict: 'SKIP',
      confidence: null,
      reason: `gemini_failed:${error?.message || 'unknown'}`,
      priceUsd: pool.priceUsd,
      liquidityUsd: pool.liquidityUsd,
      pairUrl: pool.pairUrl,
      facts,
      pool,
      judge: null,
    };
    if (db) await persistCheckResult(db, result);
    return result;
  }

  const shouldOpenPaper = options.autoOpenPaper ?? MEME_DESK_CONFIG.paperMode;
  let actionText: string | undefined;

  if (judge.verdict === 'BUY') {
    const pairTag = bitgetSymbol ? `Bitget ${bitgetSymbol}` : symbol;
    if (shouldOpenPaper && db) {
      const openBlockReason = await evaluateBookGuard(db, mint, nowMs);
      if (!openBlockReason) {
        await openMemePosition(db, {
          mint,
          symbol,
          priceUsd: pool.priceUsd,
          liquidityUsd: pool.liquidityUsd,
          pairUrl: pool.pairUrl,
          ticketUsd: MEME_DESK_CONFIG.ticketUsd,
          nowMs,
        });
        actionText = `PAPER BUY $${MEME_DESK_CONFIG.ticketUsd} (${pairTag}) @ $${pool.priceUsd}`;
      } else {
        actionText = `BUY 訊號 (${pairTag}) — 未新開模擬倉 (${openBlockReason})`;
      }
    } else {
      actionText = `APPROVAL NEEDED: 可於 Bitget 買入 $${MEME_DESK_CONFIG.ticketUsd} (${pairTag})`;
    }

    /** 若有設定 Slack 通知權杖與頻道，於出現 BUY 裁決時主動推播 */
    const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
    const slackChannel = env.CRYPTO_ENTRY_SLACK_CHANNEL_ID || env.SLACK_CHANNEL_ID || process.env.CRYPTO_ENTRY_SLACK_CHANNEL_ID;
    if (slackToken && slackChannel) {
      const msg = `*🛡️ [RUG DESK] Bitget 已上架代幣通過 14 關審查 (BUY)*\n` +
        `• 代幣：*${symbol}* (${bitgetSymbol ? `Bitget: \`${bitgetSymbol}\` ｜ ` : ''}\`${mint}\`)\n` +
        `• 現價：*$${pool.priceUsd}* ｜ 鏈上池深：*$${Math.round(pool.liquidityUsd).toLocaleString()}*\n` +
        `• Top10 持倉：*${facts.top10Pct}%* ｜ Dev 持倉：*${facts.devPct}%*\n` +
        `• Gemini 信心度：*${Math.round(judge.confidence * 100)}%* — ${judge.why}\n` +
        `• 社群與量價判讀：${judge.xRead}\n` +
        `• 主要風險：_${judge.mainRisk}_\n` +
        `• 動作：\`${actionText}\`${pool.pairUrl ? ` ｜ <${pool.pairUrl}|DexScreener>` : ''}`;
      await sendSlackMessage(slackToken, slackChannel, msg).catch(() => {});
    }
  }

  const finalResult: MemeCheckResult = {
    id,
    checkedAt: nowMs,
    mint,
    symbol,
    bitgetSymbol,
    stage: 'judge',
    verdict: judge.verdict,
    confidence: judge.confidence,
    reason: judge.why,
    priceUsd: pool.priceUsd,
    liquidityUsd: pool.liquidityUsd,
    pairUrl: pool.pairUrl,
    actionText,
    facts,
    pool,
    judge,
  };

  if (db) {
    await persistCheckResult(db, finalResult);
  }

  return finalResult;
}

/**
 * 批次掃描「Bitget 交易所已上架」之 Solana 迷因與生態代幣（每次預設掃描 5 檔）。
 * 自動優先挑選尚未檢查過或最久未更新的 Bitget 上架代幣。
 */
export async function scanFreshSolanaTokens(
  env: MemeDeskEnv,
  limit = MEME_DESK_CONFIG.maxScanBatchSize,
  nowMs = Date.now(),
): Promise<MemeCheckResult[]> {
  const orderedCheckedMints: string[] = [];
  if (env.DB) {
    await ensureMemeDeskTables(env.DB);
    const db = drizzle(env.DB);
    const existingRows = await db
      .select({ mint: memeDeskChecks.mint })
      .from(memeDeskChecks)
      .orderBy(desc(memeDeskChecks.checkedAt))
      .limit(200);
    for (const row of existingRows) {
      if (!orderedCheckedMints.includes(row.mint)) {
        orderedCheckedMints.push(row.mint);
      }
    }
  }

  const bitgetCatalog = await fetchBitgetListedSolanaTokens();
  const targets = pickBitgetTokensForScan(orderedCheckedMints, limit, bitgetCatalog);
  const results: MemeCheckResult[] = [];
  for (const item of targets) {
    const res = await checkSolanaMint(env, item.mint, { nowMs, bypassLimits: true });
    results.push(res);
  }
  return results;
}

/**
 * 排程入口：每 10 分鐘巡檢出場、每 30 分鐘掃描 Bitget 已上架代幣（掛載於 worker.ts）。
 */
export async function runScheduledMemeDeskRoutine(
  env: MemeDeskEnv,
  scheduledAt = Date.now(),
): Promise<void> {
  if (!env.DB) return;
  await ensureMemeDeskTables(env.DB);
  const db = drizzle(env.DB);
  const minute = new Date(scheduledAt).getUTCMinutes();

  /** 每 10 分鐘執行 watch.py 持倉出場巡檢 */
  if (minute % 10 === 0) {
    const events = await watchMemePositions(db, scheduledAt);
    if (events.length > 0) {
      const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
      const slackChannel = env.CRYPTO_ENTRY_SLACK_CHANNEL_ID || env.SLACK_CHANNEL_ID;
      if (slackToken && slackChannel) {
        await sendSlackMessage(
          slackToken,
          slackChannel,
          `*🔔 [RUG DESK] 持倉巡檢出場通知*\n${events.map(e => `• ${e}`).join('\n')}`,
        ).catch(() => {});
      }
    }
  }

  /** 每 30 分鐘自動掃描 Bitget 已上架 Solana 代幣（需啟用開關） */
  const autoScanEnabled = String(env.MEME_DESK_AUTO_SCAN_ENABLED || process.env.MEME_DESK_AUTO_SCAN_ENABLED || 'false') === 'true';
  if (autoScanEnabled && minute % 30 === 0) {
    await scanFreshSolanaTokens(env, MEME_DESK_CONFIG.maxScanBatchSize, scheduledAt);
  }
}

export interface MemeDeskDashboardPayload {
  now: number;
  config: typeof MEME_DESK_CONFIG;
  report: MemeEveningReport;
  openPositions: MemeOpenPositionView[];
  recentChecks: MemeCheckResult[];
  recentTrades: Array<{
    id: string;
    createdAt: number;
    mint: string;
    symbol: string;
    action: string;
    usd: number;
    price: number;
    pnl: number;
    reason: string;
  }>;
}

/**
 * 讀取戰情室完整面板資料（包含當日晚報漏斗統計、目前持倉、最近 40 筆審查紀錄與最近 30 筆交易帳本）。
 * 當啟用 `onlyBitgetListed` 時，自動清除早期未在 Bitget 上架的野雞 DEX 測試紀錄，保持版面純淨。
 */
export async function loadMemeDeskDashboard(
  env: MemeDeskEnv,
  nowMs = Date.now(),
): Promise<MemeDeskDashboardPayload> {
  if (!env.DB) {
    return {
      now: nowMs,
      config: MEME_DESK_CONFIG,
      report: {
        day: new Date(nowMs).toISOString().slice(0, 10),
        paperMode: MEME_DESK_CONFIG.paperMode,
        checkedCount: 0,
        killedByLimits: 0,
        killedByFacts: 0,
        killedByPool: 0,
        killedByJudge: 0,
        boughtCount: 0,
        openNowCount: 0,
        realizedPnlTodayUsd: 0,
        greenExitsCount: 0,
        totalExitsCount: 0,
        bestTrade: null,
        worstTrade: null,
        mostCommonKill: null,
      },
      openPositions: [],
      recentChecks: [],
      recentTrades: [],
    };
  }

  await ensureMemeDeskTables(env.DB);
  const db = drizzle(env.DB);

  /** 若開啟僅限 Bitget 已上架模式，自動清掉非 Bitget 清單中的舊 DEX 測試紀錄 */
  if (MEME_DESK_CONFIG.onlyBitgetListed) {
    const allowedMints = BITGET_SOLANA_TOKEN_REGISTRY.map(item => item.mint);
    if (allowedMints.length > 0) {
      await db.delete(memeDeskChecks).where(notInArray(memeDeskChecks.mint, allowedMints)).catch(() => {});
    }
  }

  const [report, openPositions, checkRows, tradeRows] = await Promise.all([
    buildMemeEveningReport(db, nowMs),
    listOpenMemePositions(db, nowMs),
    db.select().from(memeDeskChecks).orderBy(desc(memeDeskChecks.checkedAt)).limit(40),
    db.select().from(memeDeskTrades).orderBy(desc(memeDeskTrades.createdAt)).limit(30),
  ]);

  const parseSafe = <T>(raw: string | null): T | null => {
    if (!raw) return null;
    try { return JSON.parse(raw) as T; }
    catch { return null; }
  };

  const recentChecks: MemeCheckResult[] = checkRows.map(row => {
    const bitgetInfo = findBitgetTokenByMint(row.mint);
    return {
      id: row.id,
      checkedAt: row.checkedAt,
      mint: row.mint,
      symbol: bitgetInfo?.coin || row.symbol,
      bitgetSymbol: bitgetInfo?.bitgetSymbol || null,
      stage: (row.stage as MemeCheckResult['stage']) || 'facts',
      verdict: (row.verdict as 'BUY' | 'SKIP') || 'SKIP',
      confidence: row.confidence,
      reason: row.reason,
      priceUsd: row.priceUsd,
      liquidityUsd: row.liquidityUsd,
      pairUrl: row.pairUrl,
      facts: parseSafe<RugcheckFacts>(row.factsJson),
      pool: parseSafe<DexPoolSnapshot>(row.poolJson),
      judge: parseSafe<GeminiJudgeVerdict>(row.judgeJson),
    };
  });

  const enrichedPositions: MemeOpenPositionView[] = openPositions.map(pos => {
    const bitgetInfo = findBitgetTokenByMint(pos.mint);
    return {
      ...pos,
      symbol: bitgetInfo?.coin || pos.symbol,
      bitgetSymbol: bitgetInfo?.bitgetSymbol || null,
    };
  });

  return {
    now: nowMs,
    config: MEME_DESK_CONFIG,
    report,
    openPositions: enrichedPositions,
    recentChecks,
    recentTrades: tradeRows,
  };
}
