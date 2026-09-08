/**
 * 【詳細繁體中文註解】：戰情室專用監控清單
 *
 * ⚠️ 刻意獨立於 cryptoUniverse.ts 的 WAVE_SYMBOLS(波段雷達用,45 檔),不共用同一份常數。
 *
 * 教訓(2026-09-08 生產事故):最初戰情室借用 features/backtest/constants.ts 的
 * CRYPTO_SYMBOLS,而 CRYPTO_SYMBOLS 後來被改為直接衍生自 WAVE_SYMBOLS。
 * 波段雷達擴充到 45 檔時,戰情室被「連帶」擴大監控範圍卻沒人注意到,
 * 導致單次頁面刷新要對 45 檔各打 K 線 + 資金費率查詢,直接打穿 Cloudflare Workers
 * 50 次 subrequest 的額度上限,45 檔全部評估失敗。
 *
 * 戰情室的產品定位是「一眼看到現在能開哪個合約」,本來就該是少量、聚焦的核心清單,
 * 不需要、也不應該跟波段雷達的大範圍掃描共用清單。之後任何一邊要調整監控範圍,
 * 都必須個別評估對方是否會被波及。
 */

export interface WarRoomSymbol {
  symbol: string;
  name: string;
}

export const WARROOM_SYMBOLS: WarRoomSymbol[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin' },
  { symbol: 'ETHUSDT', name: 'Ethereum' },
  { symbol: 'SOLUSDT', name: 'Solana' },
  { symbol: 'BNBUSDT', name: 'BNB' },
  { symbol: 'XRPUSDT', name: 'XRP' },
  { symbol: 'ADAUSDT', name: 'Cardano' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin' },
  { symbol: 'AVAXUSDT', name: 'Avalanche' },
  { symbol: 'SUIUSDT', name: 'Sui' },
  { symbol: 'LINKUSDT', name: 'Chainlink' },
  { symbol: 'ICPUSDT', name: 'Internet Computer' },
  { symbol: 'ZECUSDT', name: 'Zcash' },
];
