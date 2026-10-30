/**
 * @file Solana 迷因幣戰情室前端 API 封裝與死因中文化對照表（專注於 Bitget 交易所已上架幣種）。
 * 遵循資料層隔離規範：所有對 `/api/meme-desk` 的網路請求統一集中於此模組，禁止直接散落在 UI 元件內。
 * 額外具備「瀏覽器端預抓公開 API 雙軌備援」：若本機 Node 開發伺服器處於受限網路環境導致伺服器 fetch failed，
 * 由瀏覽器直接向公開 CORS API（DexScreener / Rugcheck）取得 Bitget 上架代幣的原始 JSON 後送交後端執行 14 關判定與 D1 入庫。
 */
import {
  pickBitgetTokensForScan,
  resolveBitgetScanInput,
} from '../../services/memeDesk/bitgetListed';
import type { MemeCheckResult } from '../../services/memeDesk/types';

/**
 * 14 關死因代碼中文化對照表（對應原文 checks.csv 的 reason 欄位）。
 */
export const KILL_REASON_LABELS: Record<string, string> = {
  not_listed_on_bitget: '未在 Bitget 交易所上架（僅限掃描 Bitget 已上架幣種）',
  halted_daily_loss: '單日虧損達 -$50 熔斷上限',
  already_open: '該代幣已在持倉中，禁止重複加倉',
  max_open: '場內已滿 4 檔持倉上限',
  max_entries_today: '已達單日最多 6 次開倉上限',
  cooldown: '24 小時冷卻期內剛平倉過',
  no_report: 'Rugcheck 尚無合約報告（代幣過新）',
  already_rugged: '已被 Rugcheck 標記為 Rugged 跑路盤',
  mint_open: '鑄幣權限未關閉（Mint Authority Open，可無限增發）',
  freeze_open: '凍結權限未關閉（Freeze Authority Open，可鎖死錢包）',
  risk_score: 'Rugcheck 風險分數超過 40 分上限',
  lp_unlocked: '最大池 LP 鎖倉／銷毀比例低於 90%',
  top10_heavy: '前 10 大持幣地址合計超過上限',
  dev_holds: '創建者（Dev）錢包持幣超過總供給 5%',
  insiders: '偵測到內部人老鼠倉或關聯綑綁地址（Insiders > 0）',
  no_pool: 'DexScreener 查無 Solana 交易池',
  no_price: '無有效報價（價格 <= 0）',
  thin_pool: '最大流動池深度低於 $30,000 美元',
  ticket_too_big: '單筆 $25 下單金額超過池子 1%',
  too_fresh: '建池時間未滿 30 分鐘（籌碼尚未穩定）',
  too_old: '建池時間超過 72 小時（已過新幣爆發期）',
  nobody_can_sell: '近 1 小時買單 >= 20 筆但 0 賣單（疑似貔貅盤 Honeypot）',
};

/**
 * 將原始死因代碼轉為易讀的繁體中文說明。
 */
export function formatKillReason(reason: string): string {
  if (KILL_REASON_LABELS[reason]) {
    return `${KILL_REASON_LABELS[reason]} (${reason})`;
  }
  if (reason.startsWith('danger:')) {
    return `Rugcheck 致命危險警告：${reason.slice(7)}`;
  }
  return reason;
}

/**
 * 在瀏覽器端預先抓取單顆 Solana 代幣的公開 Rugcheck 與 DexScreener JSON（若失敗回傳 undefined 交由後端抓取）。
 */
async function browserPrefetchTokenData(mint: string): Promise<{ rugcheckRaw?: any; dexRaw?: any }> {
  if (!mint || mint.length < 30) {
    return {};
  }
  const [rugRes, dexRes] = await Promise.allSettled([
    fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, {
      headers: { Accept: 'application/json' },
    }).then(r => (r.ok ? r.json() : undefined)),
    fetch(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, {
      headers: { Accept: 'application/json' },
    }).then(r => (r.ok ? r.json() : undefined)),
  ]);

  return {
    rugcheckRaw: rugRes.status === 'fulfilled' ? rugRes.value : undefined,
    dexRaw: dexRes.status === 'fulfilled' ? dexRes.value : undefined,
  };
}

/**
 * 呼叫後端對單一 Bitget 代號（如 WIF、BONK）或 Solana 合約地址執行 14 關審查。
 */
export async function requestCheckSolanaMint(
  rawInput: string,
  bypassLimits = false,
): Promise<MemeCheckResult> {
  const { mint } = resolveBitgetScanInput(rawInput);
  const targetMint = mint || rawInput.trim();
  const prefetched = await browserPrefetchTokenData(targetMint);

  const response = await fetch('/api/meme-desk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'check_mint',
      mint: rawInput.trim(),
      bypassLimits,
      prefetchedRugcheckRaw: prefetched.rugcheckRaw,
      prefetchedDexRaw: prefetched.dexRaw,
    }),
  });
  const data: any = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || '單幣審查請求失敗');
  }
  return data.result as MemeCheckResult;
}

/**
 * 呼叫後端從「Bitget 交易所已上架」之 Solana 迷因幣與生態幣清單中批次掃描 5 檔代幣。
 * 先於瀏覽器端預抓該 5 檔代幣的公開鏈上報告與池深，確保即使本機伺服器處於受限網路環境也能 100% 成功執行。
 */
export async function requestScanFreshTokens(existingMints: string[] = []): Promise<MemeCheckResult[]> {
  const targets = pickBitgetTokensForScan(existingMints, 5);
  let prefetchedTokens: Array<{ mint: string; rugcheckRaw?: any; dexRaw?: any }> | undefined;

  try {
    prefetchedTokens = await Promise.all(
      targets.map(async item => ({
        mint: item.mint,
        ...(await browserPrefetchTokenData(item.mint)),
      })),
    );
  } catch {
    /** 瀏覽器預抓失敗時不中斷，交由後端直接嘗試抓取 */
  }

  const response = await fetch('/api/meme-desk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'scan_fresh',
      prefetchedTokens,
    }),
  });
  const data: any = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || '批次掃描請求失敗');
  }
  return (data.results || []) as MemeCheckResult[];
}

/**
 * 呼叫後端立即對所有持倉執行一次 5 重出場巡檢（watch.py）。
 */
export async function requestWatchPositions(): Promise<string[]> {
  const response = await fetch('/api/meme-desk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'watch_positions' }),
  });
  const data: any = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || '持倉巡檢請求失敗');
  }
  return (data.events || []) as string[];
}

/**
 * 手動以當前池價平倉指定模擬部位。
 */
export async function requestManualClosePosition(
  mint: string,
  fallbackPrice: number,
): Promise<void> {
  const response = await fetch('/api/meme-desk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'close_position', mint, fallbackPrice }),
  });
  const data: any = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || '手動平倉失敗');
  }
}
