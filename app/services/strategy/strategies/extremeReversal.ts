/** @file RSI 極值與布林帶反轉的共用策略；EMA200 區分順逆勢，回歸中軌或停損出場，現股做空僅研究。 */
import type { StrategyContext, StrategyModule } from '../types';
import { strategyParamError } from '../parameters';

/** 保留原圖表的超買逆勢警示，不將警示當成可成交的做空指令。 */
export function analyzeExtremeReversal(ctx: StrategyContext): { side: 'LONG' | 'SHORT'; warning: boolean; reason: string } | null {
  const i = ctx.index, p = ctx.params;
  if (i < 200 || strategyParamError(extremeReversal, p)) return null;
  const bb = ctx.indicators.bollinger(), rsi = ctx.indicators.rsi(14), ema200 = ctx.indicators.ema(200)[i];
  const recent = ctx.candles.slice(i - 3, i + 1);
  const lowerTouched = recent.some((c, offset) => c.close <= bb.lower[i - 3 + offset] * 1.005);
  const upperTouched = recent.some((c, offset) => c.close >= bb.upper[i - 3 + offset] * 0.995);
  if (lowerTouched && rsi[i - 1] <= p.rsiOversold && rsi[i] > p.rsiOversold) {
    return { side: 'LONG', warning: false, reason: `RSI 從 ${p.rsiOversold} 以下回升且近期觸及布林下軌；${ctx.candles[i].close >= ema200 ? '順勢反彈' : '低於 EMA200，逆勢反彈'}` };
  }
  if (upperTouched && rsi[i - 1] >= p.rsiOverbought && rsi[i] < p.rsiOverbought) {
    const warning = ctx.candles[i].close > ema200;
    return { side: 'SHORT', warning, reason: `RSI 從 ${p.rsiOverbought} 以上回落且近期觸及布林上軌；${warning ? '高於 EMA200，逆勢做空僅警示' : '低於 EMA200，做空研究情境'}` };
  }
  return null;
}

const extremeReversal: StrategyModule = {
  id: 'extreme_reversal', name: '極值反彈', description: 'RSI14 從 15 以下回升且近期觸及布林下軌進場；低於 EMA200 時的 RSI85 回落可作做空研究。回歸 BB20 中軌或停損出場；尚未驗證勝率。',
  markets: ['US', 'TW', 'CRYPTO'], supportedIntervals: ['15m', '1h', '4h', '1d'], warmupBars: 200, supportsShort: true,
  /** 保留原圖層 15／85 極值；5% 停損僅研究預設。 */
  defaultParams: { rsiOversold: 15, rsiOverbought: 85, stopLossPct: 5 },
  paramMeta: [
    { key: 'rsiOversold', label: 'RSI 極端超賣', description: '前根低於門檻、當根收回門檻才確認', min: 5, max: 30, step: 1 },
    { key: 'rsiOverbought', label: 'RSI 極端超買', description: '前根高於門檻、當根跌回才確認', min: 70, max: 95, step: 1 },
    { key: 'stopLossPct', label: '停損 %', description: '極值反轉失敗的固定風險界線', min: 1, max: 20, step: 0.5 },
  ],
  evaluate(ctx) {
    if (strategyParamError(extremeReversal, ctx.params) || ctx.index < 200) return { type: 'HOLD' };
    if (ctx.position) {
      const close = ctx.candles[ctx.index].close, basis = ctx.indicators.bollinger().basis[ctx.index];
      const reverted = ctx.position.side === 'LONG' ? close >= basis : close <= basis;
      return reverted ? { type: 'EXIT', reason: '價格回歸布林中軌，極值反彈出場' } : { type: 'HOLD' };
    }
    const signal = analyzeExtremeReversal(ctx);
    return signal && !signal.warning ? { type: 'ENTRY', side: signal.side, stopLossPct: ctx.params.stopLossPct, reason: signal.reason } : { type: 'HOLD' };
  },
};
export default extremeReversal;
