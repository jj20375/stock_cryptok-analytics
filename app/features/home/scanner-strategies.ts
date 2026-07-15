import { fetchStockData } from '../../services/stockService';

export interface DailyVolumeSpikeResult {
  isTriggered: boolean;
  latestVolume: number;
  previousVolume: number;
  volumeMultiple: number;
  reasons: string[];
  closeTrend: 'up' | 'down';
}

export const evaluateDailyVolumeSpike = async (
  symbol: string,
  volumeMultiplierThreshold = 2
): Promise<DailyVolumeSpikeResult> => {
  // 此策略固定使用日線：使用者要找的是「日成交量」相對前一交易日的異常放大。
  const { data } = await fetchStockData(symbol, 8, '1d');
  const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp);
  const latest = sortedData[sortedData.length - 1];
  const previous = sortedData[sortedData.length - 2];

  if (!latest || !previous || previous.volume <= 0) {
    return {
      isTriggered: false,
      latestVolume: latest?.volume || 0,
      previousVolume: previous?.volume || 0,
      volumeMultiple: 0,
      reasons: ['日線成交量資料不足，無法比較前一交易日'],
      closeTrend: 'down',
    };
  }

  // 2 倍門檻用來捕捉日成交量相對前一交易日明顯放大的標的。
  const volumeMultiple = latest.volume / previous.volume;
  const isTriggered = volumeMultiple >= volumeMultiplierThreshold;

  return {
    isTriggered,
    latestVolume: latest.volume,
    previousVolume: previous.volume,
    volumeMultiple,
    reasons: [
      `日線成交量為前一日 ${volumeMultiple.toFixed(2)} 倍`,
      `今日量 ${latest.volume.toLocaleString()} / 前日量 ${previous.volume.toLocaleString()}`,
      `篩選門檻：前一日成交量 ${volumeMultiplierThreshold} 倍以上`,
    ],
    closeTrend: latest.close >= previous.close ? 'up' : 'down',
  };
};
