/** @file 潛力幣圖表的瀏覽器資料契約；只讀取目前雷達快照所屬交易所。 */
import type { PotentialChartInterval, PotentialChartSource } from '../../services/potentialRadar/chartRequest';

export interface PotentialChartCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PotentialChartData {
  symbol: string;
  source: PotentialChartSource;
  interval: PotentialChartInterval;
  candles: PotentialChartCandle[];
}

/** 使用 AbortSignal 取消關閉抽屜後的請求，避免舊圖表資料覆蓋新選取標的。 */
export async function fetchPotentialChart(
  request: { symbol: string; source: PotentialChartSource; interval: PotentialChartInterval }, signal: AbortSignal,
): Promise<PotentialChartData> {
  const query = new URLSearchParams(request);
  const response = await fetch(`/api/potential-radar/chart?${query}`, { signal, cache: 'no-store' });
  const body = await response.json() as PotentialChartData & { error?: string };
  if (!response.ok) throw new Error(body.error || '圖表行情暫時無法取得。');
  return body;
}
