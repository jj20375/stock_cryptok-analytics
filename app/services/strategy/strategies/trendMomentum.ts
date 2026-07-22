/**
 * 【詳細繁體中文註解】：策略 — 多空趨勢強勢追蹤(多因子評分)
 *
 * 來源:移植自 stockService.ts 的 evaluateTrendMomentumData()(台股/美股日報「趨勢追蹤」選股模式)。
 * 原函式只是「單次評分」,用於從一批標的中挑出候選,沒有持倉概念與出場規則;
 * 回測需要對單一標的持續評估,因此新增:達分數門檻進場、收盤跌破 MA20 出場、加上停損。
 *
 * 評分邏輯(與原函式一致):
 *   站上 MA20 或 EMA26:+40「中期趨勢向上」
 *     RSI 介於 35~55(健康回調):+30
 *     現價貼近 MA20(偏離 <3% 且站上):+30「回測均線支撐」
 *   RSI < 45(仍可布局):+10
 *   MACD 柱狀圖較前一根轉強:+15
 *   KD 出現黃金交叉:+10
 *   總分 >= scoreThreshold(預設 40)時觸發進場。
 *   (原函式另有一個「強勢站上月線」的 else-if 分支,經檢視在原邏輯下恆為不可達分支,回測版本予以省略)
 *
 * 出場:收盤跌破 MA20(趨勢轉弱)或觸及停損。
 * 適用:台股/美股一般標的,日線。
 */

import type { StrategyModule, StrategyContext, StrategyAction } from '../types';

const trendMomentum: StrategyModule = {
  id: 'trend_momentum',
  name: '多空趨勢強勢追蹤',
  description:
    '結合 MA20/EMA26 站上判斷、RSI 健康回調區間、MACD 動能轉強、KD 黃金交叉的多因子評分,達門檻進場;收盤跌破 MA20 或觸及停損出場。適用台股/美股一般標的(日線)。',
  markets: ['US', 'TW'],
  supportedIntervals: ['1d'],
  // 暖機根數:MACD(12,26,9) 約需 35 根、EMA26、KD9,取 60 根保守留裕度
  warmupBars: 60,
  supportsShort: false,
  defaultParams: {
    scoreThreshold: 40,
    maPeriod: 20,
    emaPeriod: 26,
    rsiPeriod: 14,
    stopLossPct: 8,
  },
  paramMeta: [
    { key: 'scoreThreshold', label: '進場分數門檻', description: '多因子評分總和達此門檻才進場', min: 10, max: 100, step: 5 },
    { key: 'maPeriod', label: '均線週期', description: '中期趨勢判斷用均線', min: 10, max: 60, step: 1 },
    { key: 'emaPeriod', label: 'EMA 週期', description: '中期趨勢判斷用指數均線', min: 10, max: 60, step: 1 },
    { key: 'rsiPeriod', label: 'RSI 週期', description: 'RSI 計算週期', min: 5, max: 30, step: 1 },
    { key: 'stopLossPct', label: '停損 %', description: '進場價往下此百分比觸發停損', min: 1, max: 20, step: 0.5 },
  ],

  evaluate(ctx: StrategyContext): StrategyAction {
    const { candles, index, indicators, position, params } = ctx;
    if (index < 1) return { type: 'HOLD' };

    const close = candles[index].close;
    const maList = indicators.ma(params.maPeriod);
    const emaList = indicators.ema(params.emaPeriod);
    const rsiList = indicators.rsi(params.rsiPeriod);
    const macd = indicators.macd();
    const kd = indicators.kd();

    const ma20 = maList[index];
    const rsi = rsiList[index];

    if (position) {
      // 出場:收盤跌破均線,趨勢轉弱(停損由引擎另行判斷)
      if (ma20 != null && close < ma20) {
        return { type: 'EXIT', reason: `收盤 ${close} 跌破 MA${params.maPeriod} (${ma20.toFixed(4)}),趨勢轉弱出場` };
      }
      return { type: 'HOLD' };
    }

    // 指標尚未穩定時不進場
    if (ma20 == null || rsi == null) return { type: 'HOLD' };

    const emaLong = emaList[index];
    const isAboveMA20 = close > ma20;
    const isAboveEMA26 = close > emaLong;

    let score = 0;
    const reasons: string[] = [];

    if (isAboveMA20 || isAboveEMA26) {
      score += 40;
      reasons.push('中期趨勢向上');

      if (rsi < 55 && rsi > 35) {
        score += 30;
        reasons.push('指標健康回調');
      }

      if (ma20 !== 0) {
        const distToMA20 = Math.abs(close - ma20) / ma20;
        if (distToMA20 < 0.03 && close >= ma20) {
          score += 30;
          reasons.push('回測均線支撐');
        }
      }
    }

    if (rsi < 45) {
      score += 10;
      reasons.push('RSI 仍在可布局區');
    }

    const currHist = macd.hist[index];
    const prevHist = macd.hist[index - 1];
    if (currHist != null && prevHist != null && currHist > prevHist) {
      score += 15;
      reasons.push('MACD 動能轉強');
    }

    const currK = kd.k[index];
    const currD = kd.d[index];
    const prevK = kd.k[index - 1];
    const prevD = kd.d[index - 1];
    if (prevK <= prevD && currK > currD) {
      score += 10;
      reasons.push('KD 黃金交叉');
    }

    if (score >= params.scoreThreshold) {
      return {
        type: 'ENTRY',
        side: 'LONG',
        stopLossPct: params.stopLossPct,
        reason: `評分 ${score} 達門檻 ${params.scoreThreshold}:${reasons.join('、')}`,
      };
    }

    return { type: 'HOLD' };
  },
};

export default trendMomentum;
