/**
 * @file Bitget 交易所已上架之 Solana 迷因幣與生態代幣清單與動態同步服務。
 * 職責：
 * 1. 確保防 Rug 戰情室（Meme Desk）只掃描「在 Bitget 現貨／合約買得到」的已上架代幣，排除無法在 Bitget 交易的野雞鏈上盤。
 * 2. 結合「Bitget 公開 API (`/api/v2/spot/public/coins`) 動態抓取」與「內建已驗證 Bitget Solana 代幣註冊表」雙軌機制，
 *    即使受限網路環境或 Cloudflare IP 遭 Bitget 403 阻擋，也能 100% 穩定運作。
 * 3. 支援使用者在單幣檢測框直接輸入 Bitget 代號（如 `WIF`、`BONK`、`POPCATUSDT`）或 Solana 合約地址（CA）。
 */

export interface BitgetSolanaTokenInfo {
  /** 代幣簡稱（如 WIF、BONK） */
  coin: string;
  /** Bitget 現貨／合約交易對代號（如 WIFUSDT、BONKUSDT） */
  bitgetSymbol: string;
  /** Solana 主網官方 Mint 合約地址 (CA) */
  mint: string;
  /** 代幣分類：meme（迷因幣優先掃描）或 ecosystem（Solana 主流生態幣） */
  category: 'meme' | 'ecosystem';
}

/** Bitget 公開現貨幣種與鏈上合約地址查詢端點（無須 API Key） */
export const BITGET_SPOT_COINS_URL = 'https://api.bitget.com/api/v2/spot/public/coins';

/**
 * 內建已驗證之 Bitget 已上架 Solana 代幣註冊表（優先排列高熱度迷因幣，其次為 Solana 生態主流幣）。
 * 為什麼需要內建註冊表：
 * 1. Bitget 對部分雲端機房 IP 會回傳 HTTP 403，內建清單確保任何環境下皆可立即掃描。
 * 2. 預先綁定經核對的官方 Solana Mint 地址，防止在 DEX 上誤掃同名假幣（Fake Ticker）。
 */
export const BITGET_SOLANA_TOKEN_REGISTRY: readonly BitgetSolanaTokenInfo[] = [
  // === Bitget 已上架之 Solana 核心迷因幣 / AI Meme ===
  { coin: 'BONK', bitgetSymbol: 'BONKUSDT', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', category: 'meme' },
  { coin: 'WIF', bitgetSymbol: 'WIFUSDT', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', category: 'meme' },
  { coin: 'POPCAT', bitgetSymbol: 'POPCATUSDT', mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', category: 'meme' },
  { coin: 'PNUT', bitgetSymbol: 'PNUTUSDT', mint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', category: 'meme' },
  { coin: 'PENGU', bitgetSymbol: 'PENGUUSDT', mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', category: 'meme' },
  { coin: 'TRUMP', bitgetSymbol: 'TRUMPUSDT', mint: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', category: 'meme' },
  { coin: 'FARTCOIN', bitgetSymbol: 'FARTCOINUSDT', mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', category: 'meme' },
  { coin: 'MEW', bitgetSymbol: 'MEWUSDT', mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', category: 'meme' },
  { coin: 'BOME', bitgetSymbol: 'BOMEUSDT', mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', category: 'meme' },
  { coin: 'MOODENG', bitgetSymbol: 'MOODENGUSDT', mint: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', category: 'meme' },
  { coin: 'GOAT', bitgetSymbol: 'GOATUSDT', mint: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', category: 'meme' },
  { coin: 'ACT', bitgetSymbol: 'ACTUSDT', mint: 'GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump', category: 'meme' },
  { coin: 'AI16Z', bitgetSymbol: 'AI16ZUSDT', mint: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', category: 'meme' },
  { coin: 'PONKE', bitgetSymbol: 'PONKEUSDT', mint: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC', category: 'meme' },
  { coin: 'MYRO', bitgetSymbol: 'MYROUSDT', mint: 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4', category: 'meme' },
  { coin: 'SLERF', bitgetSymbol: 'SLERFUSDT', mint: '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3', category: 'meme' },
  { coin: 'CHILLGUY', bitgetSymbol: 'CHILLGUYUSDT', mint: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump', category: 'meme' },
  { coin: 'ZEREBRO', bitgetSymbol: 'ZEREBROUSDT', mint: '8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn', category: 'meme' },
  { coin: 'GRIFFAIN', bitgetSymbol: 'GRIFFAINUSDT', mint: 'KENJSUYLASHUMfHyy5o4Hp2FdNqZg1AsUPhfH2kYvEP', category: 'meme' },
  { coin: 'SWARMS', bitgetSymbol: 'SWARMSUSDT', mint: '74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump', category: 'meme' },
  { coin: 'VINE', bitgetSymbol: 'VINEUSDT', mint: '6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump', category: 'meme' },
  { coin: 'ARC', bitgetSymbol: 'ARCUSDT', mint: '61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump', category: 'meme' },

  // === Bitget 已上架之 Solana 生態主流代幣 ===
  { coin: 'JUP', bitgetSymbol: 'JUPUSDT', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', category: 'ecosystem' },
  { coin: 'RAY', bitgetSymbol: 'RAYUSDT', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', category: 'ecosystem' },
  { coin: 'PYTH', bitgetSymbol: 'PYTHUSDT', mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', category: 'ecosystem' },
  { coin: 'JTO', bitgetSymbol: 'JTOUSDT', mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', category: 'ecosystem' },
  { coin: 'ORCA', bitgetSymbol: 'ORCAUSDT', mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', category: 'ecosystem' },
  { coin: 'DRIFT', bitgetSymbol: 'DRIFTUSDT', mint: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7', category: 'ecosystem' },
  { coin: 'KMNO', bitgetSymbol: 'KMNOUSDT', mint: 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS', category: 'ecosystem' },
  { coin: 'GRASS', bitgetSymbol: 'GRASSUSDT', mint: 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs', category: 'ecosystem' },
  { coin: 'IO', bitgetSymbol: 'IOUSDT', mint: 'BZLbGTNCSFfoth2GYDtwr7e4imWzpR5jqcUuGEwr646K', category: 'ecosystem' },
  { coin: 'RENDER', bitgetSymbol: 'RENDERUSDT', mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', category: 'ecosystem' },
  { coin: 'W', bitgetSymbol: 'WUSDT', mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', category: 'ecosystem' },
  { coin: 'TNSR', bitgetSymbol: 'TNSRUSDT', mint: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6', category: 'ecosystem' },
] as const;

/** 以 Mint 地址快速反查 Bitget 交易對資訊的快取索引 */
const REGISTRY_BY_MINT = new Map<string, BitgetSolanaTokenInfo>(
  BITGET_SOLANA_TOKEN_REGISTRY.map(item => [item.mint, item]),
);

/** 以 Coin 或 Bitget Symbol（不分大小寫）反查的快取索引 */
const REGISTRY_BY_SYMBOL = new Map<string, BitgetSolanaTokenInfo>();
for (const item of BITGET_SOLANA_TOKEN_REGISTRY) {
  REGISTRY_BY_SYMBOL.set(item.coin.toUpperCase(), item);
  REGISTRY_BY_SYMBOL.set(item.bitgetSymbol.toUpperCase(), item);
}

/**
 * 由 Mint 合約地址查詢是否屬於 Bitget 已上架代幣。
 */
export function findBitgetTokenByMint(mint: string): BitgetSolanaTokenInfo | null {
  return REGISTRY_BY_MINT.get(mint.trim()) || null;
}

/**
 * 將使用者輸入的字串（可能是 Bitget 幣種代號如 `WIF`、`WIFUSDT`，或 Solana 合約地址 CA）
 * 解析為標準化的 `{ mint, bitgetInfo }`。
 * @param rawInput 使用者輸入之幣種名稱、交易對或合約地址
 */
export function resolveBitgetScanInput(rawInput: string): {
  mint: string;
  bitgetInfo: BitgetSolanaTokenInfo | null;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { mint: '', bitgetInfo: null };
  }

  /** 1. 若輸入的是代號（例如 WIF、wifuSDT、$BONK），先查 Bitget 註冊表轉換為官方 Solana CA */
  const normalizedSymbol = trimmed.replace(/^\$/, '').replace(/[-_/]/g, '').toUpperCase();
  const bySymbol = REGISTRY_BY_SYMBOL.get(normalizedSymbol);
  if (bySymbol) {
    return { mint: bySymbol.mint, bitgetInfo: bySymbol };
  }

  /** 2. 若輸入的是 Solana Mint 地址，反查是否在 Bitget 已上架清單中 */
  const byMint = REGISTRY_BY_MINT.get(trimmed);
  return { mint: trimmed, bitgetInfo: byMint || null };
}

/**
 * 解析 Bitget `/api/v2/spot/public/coins` 原始回應，提取所有支援 Solana 鏈且具備考驗合約地址的幣種，
 * 並與內建 `BITGET_SOLANA_TOKEN_REGISTRY` 合併去重。
 */
export function mergeBitgetCoinsResponse(raw: any): BitgetSolanaTokenInfo[] {
  const merged = new Map<string, BitgetSolanaTokenInfo>();
  for (const item of BITGET_SOLANA_TOKEN_REGISTRY) {
    merged.set(item.mint, item);
  }

  const dataList: any[] = Array.isArray(raw?.data) ? raw.data : [];
  for (const coinEntry of dataList) {
    const coin = String(coinEntry?.coin || '').trim().toUpperCase();
    if (!coin || coin === 'SOL' || coin === 'USDT' || coin === 'USDC') continue;

    const chains: any[] = Array.isArray(coinEntry?.chains) ? coinEntry.chains : [];
    for (const chainInfo of chains) {
      const chainName = String(chainInfo?.chain || '').trim().toUpperCase();
      const contractAddress = String(chainInfo?.contractAddress || '').trim();
      if (
        (chainName === 'SOL' || chainName === 'SOLANA') &&
        contractAddress.length >= 32 &&
        contractAddress.length <= 48 &&
        !merged.has(contractAddress)
      ) {
        const info: BitgetSolanaTokenInfo = {
          coin,
          bitgetSymbol: `${coin}USDT`,
          mint: contractAddress,
          category: 'ecosystem',
        };
        merged.set(contractAddress, info);
        REGISTRY_BY_MINT.set(contractAddress, info);
        REGISTRY_BY_SYMBOL.set(coin, info);
        REGISTRY_BY_SYMBOL.set(`${coin}USDT`, info);
      }
    }
  }

  return Array.from(merged.values());
}

/**
 * 向 Bitget 公開 API 動態同步最新上架的 Solana 代幣清單（失敗時自動退回內建驗證清單）。
 */
export async function fetchBitgetListedSolanaTokens(): Promise<BitgetSolanaTokenInfo[]> {
  try {
    const response = await fetch(BITGET_SPOT_COINS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (response.ok) {
      const raw: any = await response.json();
      if (raw?.code === '00000') {
        return mergeBitgetCoinsResponse(raw);
      }
    }
  } catch {
    /** 忽略網路阻擋或逾時，安全退回內建已驗證之 Bitget Solana 清單 */
  }
  return [...BITGET_SOLANA_TOKEN_REGISTRY];
}

/**
 * 從 Bitget 已上架的 Solana 代幣池中挑選本輪要掃描的 `limit` 顆代幣（預設 5 顆）。
 * 挑選順序：
 * 1. 優先挑選尚未在近期檢查紀錄 (`seenMints`) 中出現過的 Bitget 迷因幣與生態幣。
 * 2. 若所有 Bitget 已上架代幣皆已檢查過一輪，則依序循環重掃，確保每次點擊都能更新最新報價與池深。
 */
export function pickBitgetTokensForScan(
  orderedCheckedMints: string[],
  limit = 5,
  catalog: readonly BitgetSolanaTokenInfo[] = BITGET_SOLANA_TOKEN_REGISTRY,
): BitgetSolanaTokenInfo[] {
  const seenSet = new Set(orderedCheckedMints);
  const unseen = catalog.filter(item => !seenSet.has(item.mint));

  if (unseen.length >= limit) {
    return unseen.slice(0, limit);
  }

  /** 若未掃描過的不足 limit 顆，從最久以前檢查過的 Bitget 代幣補齊 */
  const picked = [...unseen];
  const pickedMints = new Set(picked.map(item => item.mint));

  /** 先放完全不在 orderedCheckedMints 尾端或最舊的項目 */
  const catalogByOldest = [...catalog].sort((left, right) => {
    const leftIdx = orderedCheckedMints.indexOf(left.mint);
    const rightIdx = orderedCheckedMints.indexOf(right.mint);
    // orderedCheckedMints 是由新到舊排序，因此 index 越大代表越久以前檢查
    return rightIdx - leftIdx;
  });

  for (const item of catalogByOldest) {
    if (picked.length >= limit) break;
    if (!pickedMints.has(item.mint)) {
      picked.push(item);
      pickedMints.add(item.mint);
    }
  }

  return picked;
}
