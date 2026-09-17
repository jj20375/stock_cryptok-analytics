/** @file 潛力幣圖表請求的純驗證規則；只接受已掃描的 USDT 現貨與固定週期。 */
import type { CryptoKlineSource } from '../marketData/binanceHistory';

/** 圖表的長度控制在單次來源請求上限內，避免開啟抽屜消耗過多 Worker 子請求。 */
export const POTENTIAL_CHART_WINDOWS = {
  '15m': 10 * 24 * 60 * 60 * 1000,
  '1h': 35 * 24 * 60 * 60 * 1000,
  '4h': 150 * 24 * 60 * 60 * 1000,
  '1d': 730 * 24 * 60 * 60 * 1000,
} as const;

export type PotentialChartInterval = keyof typeof POTENTIAL_CHART_WINDOWS;
export type PotentialChartSource = Extract<CryptoKlineSource, 'BYBIT_SPOT' | 'GATE_SPOT'>;

const ALLOWED_SOURCES = new Set<PotentialChartSource>(['BYBIT_SPOT', 'GATE_SPOT']);
const ALLOWED_INTERVALS = new Set<PotentialChartInterval>(['15m', '1h', '4h', '1d']);
/** 交易對只能是掃描器使用的英數 USDT 現貨格式，禁止把任意文字傳給外部行情來源。 */
const USDT_SPOT_SYMBOL = /^[A-Z0-9]{2,20}USDT$/;

export interface PotentialChartRequest {
  symbol: string;
  interval: PotentialChartInterval;
  source: PotentialChartSource;
}

/** URL 查詢值需全部通過白名單；失敗時不回顯輸入，避免錯誤訊息成為外部請求探測工具。 */
export function parsePotentialChartRequest(url: URL): PotentialChartRequest | null {
  const symbol = url.searchParams.get('symbol');
  const interval = url.searchParams.get('interval');
  const source = url.searchParams.get('source');
  if (!symbol || !interval || !source || !USDT_SPOT_SYMBOL.test(symbol)) return null;
  if (!ALLOWED_INTERVALS.has(interval as PotentialChartInterval)) return null;
  if (!ALLOWED_SOURCES.has(source as PotentialChartSource)) return null;
  return { symbol, interval: interval as PotentialChartInterval, source: source as PotentialChartSource };
}
