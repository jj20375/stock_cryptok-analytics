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

import { IndicatorCache } from '../../services/strategy/indicatorCache';
import bigFishPro, { evaluateBigFishProAt } from '../../services/strategy/strategies/bigFishPro';
import type { Candle } from '../../services/strategy/types';

export interface BigFishProScanResult {
  isTriggered: boolean;
  score: number;
  reason: string;
  trend: 'up' | 'down';
}

/**
 * 【詳細繁體中文註解】：首頁「吃大魚 Pro（15m 勝利方程式＋江恩目標）」掃描器
 * - 排除最後一根未收盤 K 線，防止盤中插針造成假訊號。
 * - 優先捕捉當根觸發的「底部洗盤翻綠一號槍」或「綠線站穩 EMA200 二號槍」；
 *   若最近 3 根已收盤 K 線內剛觸發翻綠、且目前仍穩守綠線之上並低於江恩第一目標 `1.0595x`，亦列為「剛起漲續強」候選，
 *   並於卡片直接附上 Supertrend 防守價與江恩波動率倍數目標價（`1.0595x` / `1.08x`）。
 */
export const evaluateBigFishProScan = async (
  symbol: string,
  interval: string = '15m'
): Promise<BigFishProScanResult> => {
  try {
    const { data } = await fetchStockData(symbol, 180, interval);
    // 扣除最後一根未收盤 K 線後至少需 60 根供 Supertrend(10, 4) 與均線暖機
    if (data.length < 60) {
      return { isTriggered: false, score: 0, reason: '歷史 K 線不足 60 根已收盤資料', trend: 'down' };
    }
    const closed: Candle[] = data.slice(0, -1).map(d => ({
      openTime: d.timestamp,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
    const indicators = new IndicatorCache(closed);
    const lastIdx = closed.length - 1;
    const latestSig = evaluateBigFishProAt(closed, lastIdx, indicators, bigFishPro.defaultParams);
    if (latestSig.triggered) {
      return {
        isTriggered: true,
        score: latestSig.score,
        reason: latestSig.reason,
        trend: 'up',
      };
    }

    // 檢查前 1~6 根已收盤 K 線是否剛觸發一號／二號槍，且當前仍處於綠線多頭並未超過江恩第二目標 1.08x
    const st = indicators.bigFish();
    if (st.direction[lastIdx] === -1) {
      for (let lookback = 1; lookback <= 6; lookback++) {
        const idx = lastIdx - lookback;
        if (idx < 50) break;
        const recentSig = evaluateBigFishProAt(closed, idx, indicators, bigFishPro.defaultParams);
        const target1 = recentSig.gannTable.levels[0]?.upTarget ?? recentSig.closePrice * 1.0595;
        const target2 = recentSig.gannTable.levels[1]?.upTarget ?? recentSig.closePrice * 1.08;
        if (recentSig.triggered && closed[lastIdx].close > st.line[lastIdx] && closed[lastIdx].close < target2) {
          return {
            isTriggered: true,
            score: Math.max(78, recentSig.score - lookback * 2),
            reason: `【近 ${lookback} 根剛起漲】${recentSig.mode === 'BOTTOM_FLIP' ? '底部洗盤翻綠' : '均線金叉共振'}後守穩綠線 ${st.line[lastIdx].toFixed(2)}｜江恩目標 ${target1.toFixed(2)} / ${target2.toFixed(2)}`,
            trend: 'up',
          };
        }
      }

      // 第二層高勝率候選：Supertrend 綠線護航 + 站穩 EMA200 + 貼近下方綠線防守位（風險 <= 5.5%）+ 動能轉強
      const macd = indicators.macd();
      const curr = closed[lastIdx];
      const stopDistPct = st.line[lastIdx] > 0 ? ((curr.close - st.line[lastIdx]) / curr.close) * 100 : 99;
      const target1 = latestSig.gannTable.levels[0]?.upTarget ?? curr.close * 1.0595;
      const target2 = latestSig.gannTable.levels[1]?.upTarget ?? curr.close * 1.08;
      const momentumUp = curr.close >= curr.open || macd.hist[lastIdx] > macd.hist[lastIdx - 1];
      if (
        curr.close >= latestSig.ema200 * 0.99 &&
        stopDistPct > 0 &&
        stopDistPct <= 5.5 &&
        momentumUp &&
        curr.close < target2
      ) {
        const score = Math.min(84, Math.max(74, Math.round(82 - stopDistPct * 1.2 + Math.min(4, latestSig.volumeRatio * 2))));
        return {
          isTriggered: true,
          score,
          reason: `【綠線貼線低吸槍】站穩 EMA (${latestSig.ema200.toFixed(2)}) 且貼近綠線防守 ${st.line[lastIdx].toFixed(2)}（風險 ${stopDistPct.toFixed(1)}%）｜江恩目標 ${target1.toFixed(2)} / ${target2.toFixed(2)}`,
          trend: 'up',
        };
      }
    }

    return { isTriggered: false, score: 0, reason: latestSig.reason, trend: 'down' };
  } catch {
    return { isTriggered: false, score: 0, reason: '掃描評估異常', trend: 'down' };
  }
};
