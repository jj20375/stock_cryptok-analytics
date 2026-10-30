/**
 * @file 第 1 ～ 9 關：Rugcheck 合約硬過濾服務（對應原文 rugcheck.py）。
 * 職責：向公開免費的 Rugcheck API 抓取單一 Solana 代幣合約報告，剔除 AMM 與鎖倉合約後計算真實前十大持倉，
 * 並以純數值比較淘汰高風險合約，絕不將原始龐大 JSON 傳給 AI 模型以節省 Token。
 */
import { MEME_DESK_CONFIG } from './config';
import type { RugcheckFacts } from './types';

/** Rugcheck 公開 API 基礎端點（唯讀、無須 API Key） */
export const RUGCHECK_BASE_URL = 'https://api.rugcheck.xyz/v1/tokens';

/** 外部請求逾時上限（毫秒）：避免 Rugcheck 偶發延遲卡住 Worker 排程 */
const RUGCHECK_TIMEOUT_MS = 12_000;

/**
 * 判斷某個持幣地址是否為 AMM 流動池金庫或鎖倉合約（Locker）。
 * 為什麼這樣做：原文特別強調，流動池本身與鎖倉合約會出現在 topHolders 名單中；
 * 若不先剔除，幾乎所有正常代幣看起來都像巨鯨高度控盤。
 */
function isAmmOrLockerAccount(
  holder: Record<string, any>,
  knownAccounts: Record<string, any>,
): boolean {
  const ownerKey = String(holder.owner || '');
  const addressKey = String(holder.address || '');
  const tag = knownAccounts[ownerKey] || knownAccounts[addressKey] || {};
  const accountType = String(tag.type || '').toUpperCase();
  return accountType === 'AMM' || accountType === 'LOCKER';
}

/**
 * 將 Rugcheck 原始 JSON 解析為精簡的 9 項合約安全結構。
 * 抽離為獨立純函式，讓伺服器端直接抓取或瀏覽器端代理抓取的原始資料皆共用同一套解析邏輯。
 */
export function parseRugcheckReport(mint: string, raw: any): RugcheckFacts {
  const token = raw?.token || {};
  const knownAccounts = raw?.knownAccounts || {};
  const topHoldersRaw: any[] = Array.isArray(raw?.topHolders) ? raw.topHolders : [];

  /** 剔除 AMM 與 LOCKER 後的真實持幣大戶名單 */
  const realHolders = topHoldersRaw.filter(holder => !isAmmOrLockerAccount(holder, knownAccounts));

  /** 依池子總美元價值（baseUSD + quoteUSD）由大到小排序，取最大主池檢查鎖倉比例 */
  const markets: any[] = Array.isArray(raw?.markets) ? [...raw.markets] : [];
  markets.sort((left, right) => {
    const leftUsd = Number(left?.lp?.baseUSD || 0) + Number(left?.lp?.quoteUSD || 0);
    const rightUsd = Number(right?.lp?.baseUSD || 0) + Number(right?.lp?.quoteUSD || 0);
    return rightUsd - leftUsd;
  });

  const biggestLp = markets[0]?.lp || {};
  const supply = Number(token?.supply || 0);
  const risks: any[] = Array.isArray(raw?.risks) ? raw.risks : [];

  /** 計算前 10 大真實持幣地址的合計百分比 */
  const top10Pct = realHolders.length > 0
    ? Math.round(realHolders.slice(0, 10).reduce((sum, item) => sum + Number(item?.pct || 0), 0) * 100) / 100
    : null;

  /** 計算創始人（Dev）錢包剩餘餘額佔總供給比例 */
  const creatorBalance = Number(raw?.creatorBalance || 0);
  const devPct = supply > 0
    ? Math.round((creatorBalance / supply) * 100 * 100) / 100
    : null;

  /** 統計內部人標記數量與關聯圖譜偵測到的老鼠倉數量 */
  const holderInsiders = realHolders.reduce((count, item) => count + (item?.insider ? 1 : 0), 0);
  const graphInsiders = Number(raw?.graphInsidersDetected || 0);

  const rawLpLocked = biggestLp?.lpLockedPct ?? raw?.lpLockedPct;
  const lpLockedPct = typeof rawLpLocked === 'number' && Number.isFinite(rawLpLocked)
    ? Math.round(rawLpLocked * 100) / 100
    : null;

  const rawScore = raw?.score_normalised;
  const riskScore = typeof rawScore === 'number' && Number.isFinite(rawScore)
    ? Math.round(rawScore * 100) / 100
    : null;

  return {
    mint,
    symbol: raw?.tokenMeta?.symbol || null,
    name: raw?.tokenMeta?.name || null,
    rugged: Boolean(raw?.rugged),
    riskScore,
    dangerFlags: risks
      .filter(risk => risk?.level === 'danger' && risk?.name)
      .map(risk => String(risk.name)),
    warnFlags: risks
      .filter(risk => risk?.level === 'warn' && risk?.name)
      .map(risk => String(risk.name)),
    mintAuthority: token?.mintAuthority ?? raw?.mintAuthority ?? null,
    freezeAuthority: token?.freezeAuthority ?? raw?.freezeAuthority ?? null,
    lpLockedPct,
    top10Pct,
    devPct,
    insiders: holderInsiders + graphInsiders,
    totalHolders: typeof raw?.totalHolders === 'number' ? raw.totalHolders : null,
  };
}

/**
 * 抓取並精簡 Rugcheck 合約報告（對應原文 rugcheck.report(mint)）。
 * @param mint Solana 代幣 Mint 地址
 */
export async function fetchRugcheckReport(mint: string): Promise<RugcheckFacts> {
  const response = await fetch(`${RUGCHECK_BASE_URL}/${encodeURIComponent(mint)}/report`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(RUGCHECK_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Rugcheck HTTP ${response.status}`);
  }

  const raw: any = await response.json();
  return parseRugcheckReport(mint, raw);
}

/**
 * 執行第 1 ～ 9 關合約硬指標檢查（對應原文 rugcheck.fact_kill(t)）。
 * 為什麼這樣做：任何一項為 null（缺失）或超標都直接判定淘汰（「NULL IS NOT CLEAN」），
 * 第一個失敗的條件即成為該代幣的死因並寫入日誌。
 *
 * 針對已上架 Bitget 交易所之代幣（`options.isBitgetListed === true`）的適配規則：
 * 1. 已上架 Bitget 的主流迷因與生態幣多採用 Raydium CLMM / Meteora DLMM / Orca 集中流動性池，
 *    且主要交易深度位於 Bitget 中心化訂單簿，因此不因傳統 CPMM LP 鎖倉欄位未達 90% 而誤殺（改由池深 >= $30k 把關）。
 * 2. 前十大鏈上持幣地址常包含各大 CEX 冷熱託管錢包，故套用 `maxTop10PctBitgetListed`（65%）上限。
 * @returns 若淘汰則回傳死因代碼字串；若全數通過則回傳 null
 */
export function evaluateRugcheckFacts(
  facts: RugcheckFacts,
  options: { isBitgetListed?: boolean } = {},
): string | null {
  const rules = MEME_DESK_CONFIG.facts;
  const isBitget = Boolean(options.isBitgetListed);

  if (facts.riskScore === null) return 'no_report';
  if (facts.rugged) return 'already_rugged';
  if (facts.mintAuthority) return 'mint_open';
  if (facts.freezeAuthority) return 'freeze_open';
  if (facts.dangerFlags.length > 0) return `danger:${facts.dangerFlags[0]}`;
  if (facts.riskScore > rules.maxRiskScore) return 'risk_score';
  if (!isBitget && (facts.lpLockedPct === null || facts.lpLockedPct < rules.minLpLockedPct)) {
    return 'lp_unlocked';
  }
  const maxTop10 = isBitget ? rules.maxTop10PctBitgetListed : rules.maxTop10Pct;
  if (facts.top10Pct === null || facts.top10Pct > maxTop10) return 'top10_heavy';
  if (facts.devPct === null || facts.devPct > rules.maxDevPct) return 'dev_holds';
  if (facts.insiders > rules.maxInsiders) return 'insiders';

  return null;
}
