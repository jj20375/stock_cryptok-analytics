/** @file 吃大魚 2.0 的持倉策略；條件與股票雷達共用，回測加上固定百分比風險保護，無下單副作用。 */
import { analyzeBigFishAt, bigFishLabel, BIG_FISH_RULES } from '../bigFish';
import { strategyParamError } from '../parameters';
import type { StrategyModule } from '../types';

const bigFishTrend: StrategyModule = {
  id: 'big_fish', name: '吃大魚 2.0',
  description: '沿用吃大魚原始 OR：MACD 金叉且高於 EMA200×0.98，或 Supertrend 翻綠進場；持有多單時翻紅或停損出場。圖表與股票雷達共用公式，通知品質篩選另計。',
  markets: ['TW', 'US', 'CRYPTO'], supportedIntervals: ['15m', '1h', '4h', '1d'], warmupBars: 200, supportsShort: false,
  /** 5% 是沿用的預設幣價停損距離；放寬可調範圍不代表已驗證的最佳停損。 */
  defaultParams: { stopLossPct: 5 },
  /** 此百分比以進場幣價為基準；100% 多單停損價為0，趨勢翻紅仍可提前出場，合約另受強平風控限制。 */
  paramMeta: [{ key: 'stopLossPct', label: '停損 %', description: '以進場價計算，非保證金虧損；100% 多單停損價為0，趨勢翻紅仍出場', min: 1, max: 100, step: 0.5 }],
  evaluate(ctx) {
    if (strategyParamError(bigFishTrend, ctx.params) || ctx.index < 200) return { type: 'HOLD' };
    const i = ctx.index, st = ctx.indicators.bigFish(), macd = ctx.indicators.macd();
    const signal = analyzeBigFishAt(ctx.candles, i, { ema200: ctx.indicators.ema(BIG_FISH_RULES.emaPeriod)[i],
      dif: macd.dif[i], previousDif: macd.dif[i - 1], signal: macd.macd[i], previousSignal: macd.macd[i - 1],
      line: st.line[i], direction: st.direction[i], previousDirection: st.direction[i - 1] });
    if (!signal) return { type: 'HOLD' };
    if (ctx.position) return signal.exitLong ? { type: 'EXIT', reason: 'Supertrend 翻紅，多單趨勢出場' } : { type: 'HOLD' };
    return signal.entry ? { type: 'ENTRY', side: 'LONG', stopLossPct: ctx.params.stopLossPct, reason: bigFishLabel(signal) } : { type: 'HOLD' };
  },
};
export default bigFishTrend;
