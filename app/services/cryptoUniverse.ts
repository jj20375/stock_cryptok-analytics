/** 波段雷達與回測共用觀察名單；不擴充既有自動實單清單。 */
export const WAVE_SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', precision: 5 },
  { symbol: 'ETHUSDT', name: 'Ethereum', precision: 4 },
  { symbol: 'SUIUSDT', name: 'Sui', precision: 1 },
  { symbol: 'ASTERUSDT', name: 'Aster', precision: 2 },
  { symbol: 'ADAUSDT', name: 'Cardano', precision: 1 },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', precision: 0 },
  { symbol: 'BNBUSDT', name: 'BNB', precision: 3 },
  { symbol: 'HYPEUSDT', name: 'Hyperliquid', precision: 2 },
  { symbol: 'SOLUSDT', name: 'Solana', precision: 2 },
  { symbol: 'ZECUSDT', name: 'Zcash', precision: 3 },
  { symbol: 'XRPUSDT', name: 'XRP', precision: 1 },
  { symbol: 'AVAXUSDT', name: 'Avalanche', precision: 2 },
  { symbol: 'LINKUSDT', name: 'Chainlink', precision: 2 },
  { symbol: 'DOTUSDT', name: 'Polkadot', precision: 2 },
  { symbol: 'LTCUSDT', name: 'Litecoin', precision: 3 },
  { symbol: 'ICPUSDT', name: 'Internet Computer', precision: 2 },
];

/** HYPE 採 Binance.US 現貨，不以 Binance 永續合約假裝現貨；量能亦只取此來源。 */
export const waveSource = (symbol: string) => symbol === 'HYPEUSDT' ? 'Binance.US 現貨' : 'Binance 現貨';
