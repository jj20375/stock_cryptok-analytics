/** @file 股票日線盤整回歸：弱趨勢且重新收回布林帶才做多；固定均值目標與 ATR 停損防止目標隨下跌移動。 */
import type { StrategyModule } from '../types';
import { SQUEEZE_DEFAULTS } from '../advancedIndicators';
import { strategyParamError } from '../parameters';

const rangeMeanReversion: StrategyModule = {
  id: 'range_mean_reversion', name: '盤整均值回歸',
  description: 'ADX 弱趨勢與平坦 MA20 下，收盤從布林下軌外回到帶內且 RSI 回升才做多。收斂觀察期間略過；進場驗證扣成本後空間，固定 MA 目標、ATR 停損與時間出場。僅股票日線，尚未驗證績效。',
  markets: ['US', 'TW'], supportedIntervals: ['1d'], warmupBars: 150, supportsShort: false,
  requiresNextOpen: true,
  warmupBarsForParams: p => Math.max(150, p.bbPeriod + SQUEEZE_DEFAULTS.widthLookback + SQUEEZE_DEFAULTS.compressionBars),
  /** ADX20／25 區分研究中的弱趨勢與強下跌；均線變化用 ATR 標準化，避免固定百分比跨標的失真。 */
  defaultParams: { bbPeriod: 20, bbMultiplier: 2, adxPeriod: 14, adxMax: 20, adxConfirmBars: 3,
    maPeriod: 20, slopeBars: 5, maxSlopeAtr: 0.5, rsiRecover: 35, stopAtr: 1.5, minRewardRisk: 1.2, maxHoldingBars: 10, exitAdx: 25 },
  paramMeta: [
    { key: 'bbPeriod', label: '布林週期', description: '重返正常價格帶的比較週期', min: 10, max: 60, step: 1 },
    { key: 'bbMultiplier', label: '布林標準差倍數', description: '上下軌相對中軌距離', min: 1, max: 3, step: 0.1 },
    { key: 'adxPeriod', label: 'ADX 週期', description: 'Wilder 平滑趨勢強度與方向', min: 5, max: 30, step: 1 },
    { key: 'adxMax', label: '盤整 ADX 上限', description: '只在趨勢較弱時找回歸買點', min: 10, max: 25, step: 1 },
    { key: 'adxConfirmBars', label: '弱趨勢確認根數', description: '連續符合才觀察', min: 2, max: 6, step: 1 },
    { key: 'maPeriod', label: '均值目標週期', description: '訊號根固定均線目標，不跟隨下跌降低', min: 10, max: 60, step: 1 },
    { key: 'slopeBars', label: '均線斜率回看根數', description: '與幾根前均線比較', min: 3, max: 10, step: 1 },
    { key: 'maxSlopeAtr', label: '均線變化上限 ATR', description: '排除明顯單邊趨勢', min: 0.1, max: 1, step: 0.1 },
    { key: 'rsiRecover', label: 'RSI 反彈觀察門檻', description: '前根 RSI14 低於此值，當根須回升', min: 20, max: 45, step: 1 },
    { key: 'stopAtr', label: '初始停損 ATR', description: '訊號根 ATR14 的絕對風險距離', min: 1, max: 3, step: 0.1 },
    { key: 'minRewardRisk', label: '最低淨報酬風險比', description: '成交時扣雙邊費用與估計滑價後驗證', min: 0.5, max: 3, step: 0.1 },
    { key: 'maxHoldingBars', label: '最大持倉根數', description: '未回歸也須時間出場', min: 3, max: 30, step: 1 },
    { key: 'exitAdx', label: '下跌趨勢出場 ADX', description: '並且負向 DI 高於正向 DI 才退出', min: 20, max: 40, step: 1 },
  ],
  evaluate(ctx) {
    const { candles, index: i, indicators, params: p, position } = ctx;
    if (strategyParamError(rangeMeanReversion, p) || p.exitAdx <= p.adxMax || i < 150) return { type: 'HOLD' };
    const close = candles[i].close, direction = indicators.adx(p.adxPeriod);
    if (position) {
      const target = position.entryPlan?.targetPrice;
      if (target != null && close >= target) return { type: 'EXIT', reason: `收盤達進場時固定均值目標 ${target.toFixed(4)}` };
      if (i - (position.entryIndex ?? i) >= p.maxHoldingBars) return { type: 'EXIT', reason: '未回歸均值，持倉時間到期' };
      if (direction.adx[i] >= p.exitAdx && direction.minusDi[i] > direction.plusDi[i]) return { type: 'EXIT', reason: 'ADX 與負向 DI 確認下跌趨勢，區間失效出場' };
      return { type: 'HOLD' };
    }
    /** 當根 ATR14 衡量報價波動；均值僅在進場時鎖定，之後不降低目標替虧損持倉找理由。 */
    const atr = indicators.atr(14)[i], ma = indicators.ma(p.maPeriod), bb = indicators.bollinger(p.bbPeriod, p.bbMultiplier);
    const rsi = indicators.rsi(14), s = SQUEEZE_DEFAULTS;
    const squeeze = indicators.squeeze(p.bbPeriod, p.bbMultiplier, s.widthLookback, s.widthPercentile, s.compressionBars, s.setupExpiryBars);
    if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(squeeze.threshold[i - 1]) || squeeze.active[i - 1] || squeeze.active[i]) return { type: 'HOLD' };
    for (let j = i - p.adxConfirmBars + 1; j <= i; j++) {
      if (!Number.isFinite(direction.adx[j]) || direction.adx[j] >= p.adxMax) return { type: 'HOLD' };
    }
    if (Math.abs(ma[i] - ma[i - p.slopeBars]) > atr * p.maxSlopeAtr || close >= ma[i]
      || candles[i - 1].close >= bb.lower[i - 1] || close < bb.lower[i]
      || rsi[i - 1] >= p.rsiRecover || rsi[i] <= rsi[i - 1]) return { type: 'HOLD' };
    return { type: 'ENTRY', side: 'LONG', entryPlan: { stopDistance: atr * p.stopAtr, minPrice: bb.lower[i],
      targetPrice: ma[i], minRewardRisk: p.minRewardRisk },
      reason: `ADX ${direction.adx[i].toFixed(2)} 弱趨勢，收回布林下軌且 RSI 回升；固定均值目標 ${ma[i].toFixed(4)}` };
  },
};
export default rangeMeanReversion;
