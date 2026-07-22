/**
 * 【詳細繁體中文註解】：策略 — RSI 超跌均線回歸(抄底策略)
 *
 * 來源:原本寫死在 strategyEngine.ts runStrategyEngine() 內的主策略,
 * 模組化後同時供 live 引擎與回測引擎使用(邏輯完全一致,永不分歧)。
 *
 * 交易邏輯(僅做多,適合現貨):
 *   進場:RSI(14) < rsiOversold(預設 20,代表極端超賣)
 *         且 現價 < MA20 × (1 - maDeviationPct/100)(預設偏離均線 10% 以上,超跌狀態)
 *   出場:現價 >= MA20(價格回歸均線,獲利了結)
 *         或 觸及停損價(由引擎以 K 線 high/low 盤中觸價判斷,不在本函式內)
 *
 * 風險假設:均值回歸策略在「單邊崩盤」行情會持續接刀,
 * 因此 live 引擎另有 cryptoMarketRegime 崩盤守衛把關;回測時無此守衛,績效會偏保守呈現原始策略體質。
 */

import type { StrategyModule, StrategyContext, StrategyAction } from '../types';

const rsiMeanReversion: StrategyModule = {
  id: 'rsi_mean_reversion',
  name: 'RSI 超跌均線回歸',
  description:
    '極端超賣抄底:RSI(14) 低於門檻且價格大幅跌破 MA20 時進場,價格回歸 MA20 或觸及停損出場。僅做多。',
  // 加密貨幣短線為主;虛擬幣概念美股高波動特性與幣價連動,日線亦適用同一套均值回歸
  markets: ['CRYPTO', 'US'],
  supportedIntervals: ['15m', '1h', '4h', '1d'],
  // 暖機根數:RSI(14) 需要 15 根、MA20 需要 20 根;取 40 根保守留裕度,確保指標完全穩定
  warmupBars: 40,
  supportsShort: false,
  defaultParams: {
    // RSI 週期
    rsiPeriod: 14,
    // RSI 超賣門檻:20 代表極端超賣(一般教科書用 30,這裡刻意嚴格以減少假訊號)
    rsiOversold: 20,
    // 均線週期
    maPeriod: 20,
    // 進場所需的「價格偏離均線」百分比:10 代表現價須低於 MA20 的 90%
    maDeviationPct: 10,
    // 停損百分比:5 代表進場價 -5% 停損(與 users.riskStopLossPct 預設一致)
    stopLossPct: 5,
  },
  paramMeta: [
    { key: 'rsiPeriod', label: 'RSI 週期', description: 'RSI 計算週期', min: 5, max: 30, step: 1 },
    { key: 'rsiOversold', label: 'RSI 超賣門檻', description: 'RSI 低於此值視為極端超賣', min: 5, max: 40, step: 1 },
    { key: 'maPeriod', label: '均線週期', description: '均值回歸的基準移動平均', min: 10, max: 60, step: 1 },
    { key: 'maDeviationPct', label: '偏離均線 %', description: '現價須低於均線此百分比才進場', min: 2, max: 30, step: 0.5 },
    { key: 'stopLossPct', label: '停損 %', description: '進場價往下此百分比觸發停損', min: 1, max: 20, step: 0.5 },
  ],

  evaluate(ctx: StrategyContext): StrategyAction {
    const { candles, index, indicators, position, params } = ctx;
    const close = candles[index].close;

    const rsiList = indicators.rsi(params.rsiPeriod);
    const maList = indicators.ma(params.maPeriod);
    const rsi = rsiList[index];
    const ma = maList[index];

    // 指標尚未穩定(序列前段為 null)時不動作
    if (rsi == null || ma == null) return { type: 'HOLD' };

    if (!position) {
      // 進場:極端超賣 + 價格大幅偏離均線(超跌)
      const deviationThreshold = ma * (1 - params.maDeviationPct / 100);
      if (rsi < params.rsiOversold && close < deviationThreshold) {
        return {
          type: 'ENTRY',
          side: 'LONG',
          stopLossPct: params.stopLossPct,
          reason: `RSI ${rsi.toFixed(2)} < ${params.rsiOversold} 且價格 ${close} 低於 MA${params.maPeriod} 的 ${(100 - params.maDeviationPct).toFixed(0)}% (${deviationThreshold.toFixed(4)})`,
        };
      }
      return { type: 'HOLD' };
    }

    // 出場:價格回歸均線(停損出場由引擎以 high/low 判斷,不在此處)
    if (close >= ma) {
      return {
        type: 'EXIT',
        reason: `價格 ${close} 回歸 MA${params.maPeriod} (${ma.toFixed(4)}),均線回歸平倉`,
      };
    }

    return { type: 'HOLD' };
  },
};

export default rsiMeanReversion;
