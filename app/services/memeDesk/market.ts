/**
 * @file 第 10 ～ 13 關：DexScreener 流動池與交易結構檢查服務（對應原文 market.py 與 scan.py）。
 * 職責：
 * 1. 查詢代幣於 Solana 上的最大流動池深度、成立時間與近 1 小時買賣筆數（排除無法賣出的貔貅盤）。
 * 2. 額外提取社群連結（Twitter/X、Telegram、官網）、平均單筆成交額與付費 Boost 點數，供第 14 關 Gemini 識別仿盤與刷量機器人。
 * 3. 提供最新付費更新 DexScreener Profile 的 Solana 代幣探索（對應 scan.py）。
 */
import { MEME_DESK_CONFIG } from './config';
import type { DexPoolSnapshot } from './types';

/** DexScreener Solana 代幣池查詢端點（免費公開 API） */
export const DEXSCREENER_TOKENS_URL = 'https://api.dexscreener.com/tokens/v1/solana';

/** DexScreener 最新更新 Profile 的代幣清單端點（對應原文 scan.py） */
export const DEXSCREENER_PROFILES_URL = 'https://api.dexscreener.com/token-profiles/latest/v1';

/** 請求逾時上限（毫秒） */
const DEXSCREENER_TIMEOUT_MS = 10_000;

/**
 * 將 DexScreener 原始回應解析為最大流動池快照。
 */
export function parseDexPoolSnapshot(
  mint: string,
  raw: any,
  nowMs = Date.now(),
): DexPoolSnapshot | null {
  const pairsRaw: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.pairs) ? raw.pairs : []);

  /** 只保留 baseToken 地址與目標 mint 完全相符的交易對，避免撿到以該幣作為邊緣報價幣的假池 */
  const matchingPairs = pairsRaw.filter(pair => String(pair?.baseToken?.address || '') === mint);
  if (matchingPairs.length === 0) {
    return null;
  }

  /** 挑選美元流動性（liquidity.usd）最深的池子作為唯一評估基準 */
  const deepestPair = matchingPairs.reduce((best, current) => {
    const bestLiq = Number(best?.liquidity?.usd || 0);
    const currentLiq = Number(current?.liquidity?.usd || 0);
    return currentLiq > bestLiq ? current : best;
  }, matchingPairs[0]);

  const txns5m = deepestPair?.txns?.m5 || {};
  const txns1h = deepestPair?.txns?.h1 || {};
  const pairCreatedAt = Number(deepestPair?.pairCreatedAt || 0);
  const buys1h = Number(txns1h?.buys || 0);
  const sells1h = Number(txns1h?.sells || 0);
  const totalTxns1h = buys1h + sells1h;
  const volume1hUsd = Number(deepestPair?.volume?.h1 || 0);

  /**
   * 計算近 1 小時平均每筆成交金額（USD）：
   * 為什麼要算這個：因為我們改用免費 Gemini 代替 Grok，透過「平均單筆成交額」能直接識破
   * 1 小時幾百筆 $1 美元買單的微額刷量機器人（Volume Bot）。
   */
  const avgTrade1hUsd = totalTxns1h > 0
    ? Math.round((volume1hUsd / totalTxns1h) * 100) / 100
    : null;

  const socialsRaw: any[] = Array.isArray(deepestPair?.info?.socials) ? deepestPair.info.socials : [];
  const websitesRaw: any[] = Array.isArray(deepestPair?.info?.websites) ? deepestPair.info.websites : [];

  return {
    symbol: deepestPair?.baseToken?.symbol || null,
    name: deepestPair?.baseToken?.name || null,
    priceUsd: Number(deepestPair?.priceUsd || 0),
    liquidityUsd: Number(deepestPair?.liquidity?.usd || 0),
    fdvUsd: typeof deepestPair?.fdv === 'number' ? deepestPair.fdv : null,
    ageMin: pairCreatedAt > 0 ? Math.round((nowMs - pairCreatedAt) / 60_000) : null,
    buys5m: Number(txns5m?.buys || 0),
    sells5m: Number(txns5m?.sells || 0),
    buys1h,
    sells1h,
    volume1hUsd,
    avgTrade1hUsd,
    priceChange1hPct: typeof deepestPair?.priceChange?.h1 === 'number' ? deepestPair.priceChange.h1 : null,
    socials: socialsRaw
      .filter(item => item?.type && item?.url)
      .map(item => ({ type: String(item.type), url: String(item.url) })),
    websites: websitesRaw
      .map(item => String(item?.url || ''))
      .filter(Boolean),
    boostsActive: Number(deepestPair?.boosts?.active || 0),
    pairUrl: deepestPair?.url || null,
  };
}

/**
 * 查詢指定 Solana 代幣的最大流動池快照（對應原文 market.pool(mint)）。
 * @param mint Solana 代幣 Mint 地址
 * @param nowMs 當前時間戳（毫秒 UTC），用於計算池子成立分鐘數
 */
export async function fetchDexPoolSnapshot(
  mint: string,
  nowMs = Date.now(),
): Promise<DexPoolSnapshot | null> {
  const response = await fetch(`${DEXSCREENER_TOKENS_URL}/${encodeURIComponent(mint)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(DEXSCREENER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DexScreener HTTP ${response.status}`);
  }

  const raw: any = await response.json();
  return parseDexPoolSnapshot(mint, raw, nowMs);
}

/**
 * 執行第 10 ～ 13 關流動池硬指標檢查（對應原文 market.market_kill(m)）。
 * 針對已上架 Bitget 交易所之代幣（`options.isBitgetListed === true`）：
 * 已通過交易所上幣審核的代幣建池時間皆大於 72 小時，故不套用 `too_old`（72h 新幣上限），
 * 但仍嚴格檢查池深 >= $30k、建池滿 30 分鐘（防同名假池）與真實買賣換手（防貔貅盤）。
 * @returns 若淘汰則回傳死因代碼；若通過則回傳 null
 */
export function evaluatePoolFacts(
  pool: DexPoolSnapshot | null,
  options: { isBitgetListed?: boolean } = {},
): string | null {
  const rules = MEME_DESK_CONFIG.facts;
  const ticketUsd = MEME_DESK_CONFIG.ticketUsd;
  const isBitget = Boolean(options.isBitgetListed);

  if (!pool) return 'no_pool';
  if (pool.priceUsd <= 0) return 'no_price';
  if (pool.liquidityUsd < rules.minLiquidityUsd) return 'thin_pool';
  if (ticketUsd / pool.liquidityUsd > rules.maxTicketShare) return 'ticket_too_big';
  if (pool.ageMin === null || pool.ageMin < rules.minAgeMin) return 'too_fresh';
  if (!isBitget && pool.ageMin > rules.maxAgeHours * 60) return 'too_old';
  if (pool.buys1h >= rules.honeypotMinBuys1h && pool.sells1h === 0) return 'nobody_can_sell';

  return null;
}

/**
 * 從 DexScreener Profile 清單原始陣列中過濾出尚未檢查過的 Solana 代幣地址。
 */
export function extractFreshSolanaMints(
  raw: any,
  seenMints: Set<string>,
  limit = MEME_DESK_CONFIG.maxScanBatchSize,
): string[] {
  const list: any[] = Array.isArray(raw) ? raw : [];
  const freshMints: string[] = [];

  for (const item of list) {
    if (freshMints.length >= limit) break;
    const chainId = String(item?.chainId || '').toLowerCase();
    const tokenAddress = String(item?.tokenAddress || '').trim();
    if (chainId === 'solana' && tokenAddress && !seenMints.has(tokenAddress) && !freshMints.includes(tokenAddress)) {
      freshMints.push(tokenAddress);
    }
  }

  return freshMints;
}

/**
 * 從 DexScreener 最新代幣 Profile 清單撈取尚未檢查過的 Solana 代幣地址（對應原文 scan.py）。
 * 原文說明：付費更新 Profile 不代表品質好，只代表開發者花了錢；好壞一律交由 14 關漏斗裁決。
 * @param seenMints 已經檢查過的代幣 Mint 集合（避免重複消耗配額）
 * @param limit 單輪最多撈取顆數（預設 5 顆）
 */
export async function fetchFreshSolanaMints(
  seenMints: Set<string>,
  limit = MEME_DESK_CONFIG.maxScanBatchSize,
): Promise<string[]> {
  const response = await fetch(DEXSCREENER_PROFILES_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(DEXSCREENER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DexScreener Profiles HTTP ${response.status}`);
  }

  const raw: any = await response.json();
  return extractFreshSolanaMints(raw, seenMints, limit);
}
