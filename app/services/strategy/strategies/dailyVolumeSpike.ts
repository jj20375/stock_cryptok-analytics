/**
 * 【詳細繁體中文註解】：策略 — 日線量增 2 倍(異常資金流入)
 *
 * 來源:移植自 scanner-strategies.ts 的 evaluateDailyVolumeSpike()(個股掃描「日線量增2倍」模式)。
 * 原函式只回傳「是否觸發」的單次掃描結果,沒有出場規則,也沒有以收盤漲跌作為進場過濾;
 * 回測新增:要求當根收盤上漲(避免買進爆量下殺的黑K)、收盤跌破短均線或持倉過久出場、加上停損。
 *
 * 進場邏輯:
 *   當根成交量 / 前一根成交量 >= volumeMultiplierThreshold(預設 2 倍)
 *   且當根收盤 >= 前一根收盤(原函式僅記錄 closeTrend,回測版本將其設為進場過濾條件)
 *   → 觸發進場做多。
 *
 * 適用:台股/美股一般標的,日線。
 */

import type { StrategyModule, StrategyContext, StrategyAction } from '../types';

const dailyVolumeSpike: StrategyModule = {
  id: 'daily_volume_spike',
  name: '日線量增 2 倍',
  description:
    '今日成交量達前一交易日指定倍數(預設 2 倍)以上且收盤上漲,視為異常資金流入進場做多;收盤跌破短均線、持倉過久或觸及停損則出場。適用台股/美股一般標的(日線)。',
  markets: ['US', 'TW'],
  supportedIntervals: ['1d'],
  // 暖機根數:只需前一根量價 + 出場均線,取 30 根保守留裕度
  warmupBars: 30,
  supportsShort: false,
  defaultParams: {
    volumeMultiplierThreshold: 2,
    maxHoldingBars: 10,
    exitMaPeriod: 10,
    stopLossPct: 8,
  },
  paramMeta: [
    { key: 'volumeMultiplierThreshold', label: '量增倍數門檻', description: '今日量須達前一日此倍數以上', min: 1.2, max: 5, step: 0.1 },
    { key: 'maxHoldingBars', label: '最大持倉根數', description: '超過此根數強制出場(原策略無出場規則,回測新增)', min: 3, max: 30, step: 1 },
    { key: 'exitMaPeriod', label: '出場均線週期', description: '收盤跌破此均線即出場', min: 5, max: 30, step: 1 },
    { key: 'stopLossPct', label: '停損 %', description: '進場價往下此百分比觸發停損', min: 1, max: 20, step: 0.5 },
  ],

  evaluate(ctx: StrategyContext): StrategyAction {
    const { candles, index, indicators, position, params } = ctx;
    if (index < 1) return { type: 'HOLD' };

    if (position) {
      const exitMa = indicators.ma(params.exitMaPeriod)[index];
      const close = candles[index].close;
      const heldBars = index - (position.entryIndex ?? index);

      if (exitMa != null && close < exitMa) {
        return { type: 'EXIT', reason: `收盤 ${close} 跌破 MA${params.exitMaPeriod} (${exitMa.toFixed(4)}),出場` };
      }
      if (heldBars >= params.maxHoldingBars) {
        return { type: 'EXIT', reason: `持倉已達最大根數 ${params.maxHoldingBars},出場(原策略無自然出場點,回測新增規則)` };
      }
      return { type: 'HOLD' };
    }

    const current = candles[index];
    const prev = candles[index - 1];
    if (prev.volume <= 0) return { type: 'HOLD' };

    const volumeMultiple = current.volume / prev.volume;
    const closeUp = current.close >= prev.close;

    if (volumeMultiple >= params.volumeMultiplierThreshold && closeUp) {
      return {
        type: 'ENTRY',
        side: 'LONG',
        stopLossPct: params.stopLossPct,
        reason: `日線成交量為前一日 ${volumeMultiple.toFixed(2)} 倍,且收盤上漲,疑似異常資金流入`,
      };
    }

    return { type: 'HOLD' };
  },
};

export default dailyVolumeSpike;
