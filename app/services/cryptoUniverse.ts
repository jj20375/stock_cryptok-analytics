/**
 * 【詳細繁體中文註解】：波段雷達與回測共用的觀察名單。
 *
 * ⚠️ 這份清單「不等於」自動實單清單 — 自動下單的幣種另由 strategyEngine.SYMBOL_PRECISION 控制,
 * 這裡只影響「掃描觀察」與「回測可選標的」,不會讓任何幣自動進入真實交易。
 *
 * primarySource 標示「經實測確認有足夠 4h 歷史資料」的主要來源;
 * 實際抓取時若主來源故障或資料過期,binanceHistory 會自動改用備援來源。
 *
 * ⚠️ 妖幣的重要限制:波段策略要求「312 根 4h 暖機(約 52 天)+ 51 個完整日線 + 日線 MA20/MA50 上升」,
 * 因此剛上市或剛暴漲的新幣即使加入清單,也會長時間停在 WAIT 不出訊號。
 * 想抓真正的新上市妖幣,需要另一套短歷史動能策略,不是把幣加進這份清單就能解決。
 */

export type WaveKlineSource = 'BYBIT_SPOT' | 'BINANCE_US_SPOT' | 'GATE_SPOT';

export interface WaveSymbol {
  symbol: string;
  name: string;
  /** 回測倉位模擬用的數量精度,非交易所實際下單限制 */
  precision: number;
  /** 經實測確認的主要行情來源;未指定時預設 Bybit 現貨 */
  primarySource?: WaveKlineSource;
  /** 分類標籤,供 UI 分組顯示 */
  tier: 'major' | 'mid' | 'meme';
}

export const WAVE_SYMBOLS: WaveSymbol[] = [
  // ── 主流大型幣(生產環境已驗證可用,主來源 Bybit 現貨)──
  { symbol: 'BTCUSDT', name: 'Bitcoin', precision: 5, tier: 'major' },
  { symbol: 'ETHUSDT', name: 'Ethereum', precision: 4, tier: 'major' },
  { symbol: 'SUIUSDT', name: 'Sui', precision: 1, tier: 'major' },
  { symbol: 'ASTERUSDT', name: 'Aster', precision: 2, tier: 'major' },
  { symbol: 'ADAUSDT', name: 'Cardano', precision: 1, tier: 'major' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', precision: 0, tier: 'major' },
  { symbol: 'BNBUSDT', name: 'BNB', precision: 3, tier: 'major' },
  // HYPE 在 Bybit 現貨取不到可靠資料,改以 Binance.US 為主、Gate.io 備援
  { symbol: 'HYPEUSDT', name: 'Hyperliquid', precision: 2, primarySource: 'BINANCE_US_SPOT', tier: 'major' },
  { symbol: 'SOLUSDT', name: 'Solana', precision: 2, tier: 'major' },
  { symbol: 'ZECUSDT', name: 'Zcash', precision: 3, tier: 'major' },
  { symbol: 'XRPUSDT', name: 'XRP', precision: 1, tier: 'major' },
  { symbol: 'AVAXUSDT', name: 'Avalanche', precision: 2, tier: 'major' },
  { symbol: 'LINKUSDT', name: 'Chainlink', precision: 2, tier: 'major' },
  { symbol: 'DOTUSDT', name: 'Polkadot', precision: 2, tier: 'major' },
  { symbol: 'LTCUSDT', name: 'Litecoin', precision: 3, tier: 'major' },
  { symbol: 'ICPUSDT', name: 'Internet Computer', precision: 2, tier: 'major' },

  // ── 中型主流幣(已實測 Gate.io 有 400 根以上 4h 歷史)──
  { symbol: 'BCHUSDT', name: 'Bitcoin Cash', precision: 3, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'AAVEUSDT', name: 'Aave', precision: 3, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'TAOUSDT', name: 'Bittensor', precision: 3, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'UNIUSDT', name: 'Uniswap', precision: 1, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'ETCUSDT', name: 'Ethereum Classic', precision: 1, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'INJUSDT', name: 'Injective', precision: 1, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'NEARUSDT', name: 'NEAR Protocol', precision: 1, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'ATOMUSDT', name: 'Cosmos', precision: 1, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'RENDERUSDT', name: 'Render', precision: 1, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'TIAUSDT', name: 'Celestia', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'SEIUSDT', name: 'Sei', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'ARBUSDT', name: 'Arbitrum', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'OPUSDT', name: 'Optimism', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'APTUSDT', name: 'Aptos', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'FILUSDT', name: 'Filecoin', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'ENAUSDT', name: 'Ethena', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'ONDOUSDT', name: 'Ondo', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'JUPUSDT', name: 'Jupiter', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },
  { symbol: 'PYTHUSDT', name: 'Pyth Network', precision: 0, primarySource: 'GATE_SPOT', tier: 'mid' },

  // ── 迷因/高波動幣(俗稱妖幣;已實測有足夠歷史,但流動性不足時策略會自動略過)──
  { symbol: 'PEPEUSDT', name: 'Pepe', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'WIFUSDT', name: 'dogwifhat', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'BONKUSDT', name: 'Bonk', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'FLOKIUSDT', name: 'Floki', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'SHIBUSDT', name: 'Shiba Inu', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'TRUMPUSDT', name: 'Official Trump', precision: 1, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'PENGUUSDT', name: 'Pudgy Penguins', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'SPXUSDT', name: 'SPX6900', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'FARTCOINUSDT', name: 'Fartcoin', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
  { symbol: 'VIRTUALUSDT', name: 'Virtuals Protocol', precision: 0, primarySource: 'GATE_SPOT', tier: 'meme' },
];

/** 標的 → 主要行情來源;供 binanceHistory 決定備援優先序 */
export const WAVE_PRIMARY_SOURCES: Record<string, WaveKlineSource> = Object.fromEntries(
  WAVE_SYMBOLS.filter(s => s.primarySource).map(s => [s.symbol, s.primarySource!])
);

/**
 * 資料來源代碼 → 顯示名稱。
 * 實際使用的來源由 binanceHistory 的備援機制在抓取當下決定(可能因主來源故障或資料過期而切換),
 * 因此顯示時必須用「抓取結果回報的來源」,不能用寫死的對應表,否則會誤導使用者。
 */
export const KLINE_SOURCE_LABELS: Record<string, string> = {
  BYBIT_SPOT: 'Bybit 現貨',
  BINANCE_US_SPOT: 'Binance.US 現貨',
  GATE_SPOT: 'Gate.io 現貨',
};

/** 將來源代碼轉為顯示名稱;未知或尚未取得時回傳保守說明。 */
export const waveSourceLabel = (source?: string | null) =>
  (source && KLINE_SOURCE_LABELS[source]) || '尚未取得(以實際抓取來源為準)';

/** 標的的預期主要來源(僅供 UI 事前提示;實際來源仍以抓取結果為準)。 */
export const waveSource = (symbol: string) => {
  const primary = WAVE_PRIMARY_SOURCES[symbol] ?? 'BYBIT_SPOT';
  const fallback = primary === 'GATE_SPOT' ? 'Bybit 現貨' : 'Gate.io 現貨';
  return `${KLINE_SOURCE_LABELS[primary]}(備援 ${fallback})`;
};
