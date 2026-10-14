/** @file 使用者 Pine 吃大魚的合約版本；共用原始 OR 訊號，只加合約硬停損，不自動啟用交易。 */
import bigFishTrend from './bigFishTrend';
import { BIG_FISH_RULES } from '../bigFish';
import { strategyParamError } from '../parameters';
import type { StrategyModule } from '../types';

const futuresBigFish: StrategyModule = {
  id: 'futures_big_fish', name: '合約吃大魚 2.0（Pine 條件／僅做多）', futuresOnly: true,
  description: 'ATR10、Supertrend4、MACD12/26/9：金叉且收盤高於 EMA200×0.98，或 Supertrend 翻綠開多；持倉時紅色即退出。另加必要硬停損，沒有固定2R、6小時退出或3%保本。合約預覽／自動化目前為1H，非截圖15分鐘，尚未證明較高勝率。',
  markets: ['CRYPTO'], supportedIntervals: ['1h'], warmupBars: BIG_FISH_RULES.emaPeriod,
  supportsShort: false, requiresNextOpen: true,
  /** 原 Pine 沒有價格停損；5% 幣價距離是合約保護起點，倉位仍受0.25%本金風險限制。 */
  defaultParams: { stopLossPct: 5 },
  paramMeta: [{ key: 'stopLossPct', label: '合約硬停損 %', description: '新增的合約保護，以幣價距離計；非槓桿保證金虧損，原Pine未提供此機制', min: 1, max: 20, step: .5 }],
  evaluate(ctx) {
    if (strategyParamError(futuresBigFish, ctx.params)) return { type: 'HOLD', reason: '合約吃大魚參數無效' };
    /** 保留原始兩個 OR 分支，不能偷偷加4H盤勢或要求翻綠分支也站上EMA200。 */
    const action = bigFishTrend.evaluate(ctx);
    return action.type === 'ENTRY' ? { ...action, entryPlan: { stopDistance: ctx.candles[ctx.index].close * ctx.params.stopLossPct / 100 },
      reason: `合約${action.reason}・硬停損 ${ctx.params.stopLossPct}%` }
      : action.type === 'HOLD' ? { ...action, reason: ctx.position ? '吃大魚多單持有，等待Supertrend紅色出場' : '等待MACD金叉或Supertrend翻綠' } : action;
  },
};
export default futuresBigFish;
