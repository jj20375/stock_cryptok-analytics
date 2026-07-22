/**
 * 【詳細繁體中文註解】：策略 — 量能連續兩期以上放大(主力吸籌訊號)
 *
 * 來源:移植自 stockService.ts 的 evaluateConsecutiveVolumeData()(日報「連續爆量」選股模式)。
 * 原函式只是「單次掃描訊號」(偵測連續 N 期量能放大),沒有出場規則;
 * 回測新增:收盤跌破 MA20 出場、或持倉達最大根數強制出場(避免無限期持有),並加上停損。
 *
 * 進場邏輯(與原函式一致):
 *   由當根往前逐根檢查,若該根成交量 > 前 5 期均量 × volumeMultiplier,計數 +1,
 *   直到條件不成立為止;連續期數 >= minConsecutiveDays(預設 2)時觸發進場做多。
 *
 * 適用:台股/美股一般標的,日線。
 */

import type { StrategyModule, StrategyContext, StrategyAction } from '../types';

// 連續計數的安全上限:防止極端資料(量能長期持續放大)導致迴圈掃描過多根,
// 實務上連續放大很少超過此數,純粹作為效能保護
const MAX_LOOKBACK = 60;

const consecutiveVolumeBreakout: StrategyModule = {
  id: 'consecutive_volume_breakout',
  name: '量能連續兩期以上放大',
  description:
    '成交量連續 N 期(預設 2 期)大於 5 期均量的指定倍數,視為主力吸籌訊號進場做多;收盤跌破 MA20、持倉達最大根數或觸及停損則出場。適用台股/美股一般標的(日線)。',
  markets: ['US', 'TW'],
  supportedIntervals: ['1d'],
  // 暖機根數:5 期均量計算 + 連續計數安全裕度
  warmupBars: 30,
  supportsShort: false,
  defaultParams: {
    volumeMultiplier: 1.5,
    minConsecutiveDays: 2,
    maxHoldingBars: 20,
    exitMaPeriod: 20,
    stopLossPct: 8,
  },
  paramMeta: [
    { key: 'volumeMultiplier', label: '量能放大倍數', description: '單期成交量須超過 5 期均量的此倍數', min: 1, max: 5, step: 0.1 },
    { key: 'minConsecutiveDays', label: '最少連續期數', description: '連續放大達此期數才進場', min: 2, max: 10, step: 1 },
    { key: 'maxHoldingBars', label: '最大持倉根數', description: '超過此根數強制出場(原策略無出場規則,回測新增)', min: 3, max: 60, step: 1 },
    { key: 'exitMaPeriod', label: '出場均線週期', description: '收盤跌破此均線即出場', min: 5, max: 60, step: 1 },
    { key: 'stopLossPct', label: '停損 %', description: '進場價往下此百分比觸發停損', min: 1, max: 20, step: 0.5 },
  ],

  evaluate(ctx: StrategyContext): StrategyAction {
    const { candles, index, indicators, position, params } = ctx;

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

    // 由當根往前逐根計數:成交量須大於「其前 5 期均量」的指定倍數
    let count = 0;
    const lowerBound = Math.max(5, index - MAX_LOOKBACK);
    for (let i = index; i >= lowerBound; i--) {
      const sliceStart = i - 5;
      if (sliceStart < 0) break;
      let sumVol = 0;
      for (let j = sliceStart; j < i; j++) sumVol += candles[j].volume;
      const avgVol = sumVol / 5;
      if (avgVol > 0 && candles[i].volume > avgVol * params.volumeMultiplier) {
        count++;
      } else {
        break;
      }
    }

    if (count >= params.minConsecutiveDays) {
      return {
        type: 'ENTRY',
        side: 'LONG',
        stopLossPct: params.stopLossPct,
        reason: `量能連續 ${count} 期放大(${params.volumeMultiplier} 倍以上),疑似主力吸籌`,
      };
    }

    return { type: 'HOLD' };
  },
};

export default consecutiveVolumeBreakout;
