/** @file 股票日線收斂突破：歷史帶寬收斂後放量確認，只做多；訊號快照鎖定 ATR 與突破位，不讀未來或下單。 */
import type { StrategyModule } from '../types';
import { SQUEEZE_DEFAULTS } from '../advancedIndicators';
import { strategyParamError } from '../parameters';

const volatilitySqueezeBreakout: StrategyModule = {
  id: 'volatility_squeeze_breakout', name: '波動收斂突破',
  description: 'BB 帶寬落入自身歷史低分位並連續收斂，五根內放量突破前高及上軌進場。鎖定 ATR 停損、開盤防追價，假突破或跌破短期結構出場；只支援股票日線，參數尚未經樣本外績效驗證。',
  markets: ['US', 'TW'], supportedIntervals: ['1d'], warmupBars: 150, supportsShort: false,
  requiresNextOpen: true,
  warmupBarsForParams: p => Math.max(150, p.bbPeriod + p.widthLookback + p.compressionBars),
  /** 價格以標的報價計；帶寬百分位及 ATR 倍數依提案設為保守研究起點，不是最佳化結果。 */
  defaultParams: { bbPeriod: 20, bbMultiplier: 2, ...SQUEEZE_DEFAULTS,
    breakoutBars: 20, volumeMultiplier: 1.5, maxExtensionAtr: 1, stopAtr: 2, failBars: 3, exitBars: 10 },
  paramMeta: [
    { key: 'bbPeriod', label: '布林週期', description: '收盤 SMA 與母體標準差週期', min: 10, max: 60, step: 1 },
    { key: 'bbMultiplier', label: '布林標準差倍數', description: '價格帶寬度', min: 1, max: 3, step: 0.1 },
    { key: 'widthLookback', label: '帶寬歷史根數', description: '百分位比較窗口，排除當根', min: 60, max: 240, step: 1 },
    { key: 'widthPercentile', label: '收斂百分位', description: '20 表示自身歷史最窄的 20%', min: 5, max: 40, step: 1 },
    { key: 'compressionBars', label: '連續收斂根數', description: '持續壓縮才建立觀察', min: 2, max: 6, step: 1 },
    { key: 'setupExpiryBars', label: '觀察有效根數', description: '到期後不能沿用舊收斂狀態', min: 2, max: 10, step: 1 },
    { key: 'breakoutBars', label: '前高回看根數', description: '前高與均量都排除訊號當根', min: 10, max: 60, step: 1 },
    { key: 'volumeMultiplier', label: '確認量能倍數', description: '成交量相對歷史均量', min: 1, max: 4, step: 0.1 },
    { key: 'maxExtensionAtr', label: '追價上限 ATR', description: '訊號與實際成交都檢查距突破位的距離', min: 0.5, max: 2, step: 0.1 },
    { key: 'stopAtr', label: '初始停損 ATR', description: '鎖定訊號 ATR14，以成交價設定絕對距離', min: 1, max: 4, step: 0.1 },
    { key: 'failBars', label: '假突破觀察根數', description: '初期跌回固定突破位即退出', min: 1, max: 6, step: 1 },
    { key: 'exitBars', label: '出場低點根數', description: '收盤跌破前 N 根低點作結構出場', min: 3, max: 30, step: 1 },
  ],
  evaluate(ctx) {
    const { candles, index: i, indicators, params: p, position } = ctx;
    if (strategyParamError(volatilitySqueezeBreakout, p) || i < 150) return { type: 'HOLD' };
    const current = candles[i];
    if (position) {
      const held = i - (position.entryIndex ?? i);
      if (held <= p.failBars && position.entryPlan?.breakoutPrice != null && current.close < position.entryPlan.breakoutPrice) {
        return { type: 'EXIT', reason: '初期跌回進場時的突破位，假突破出場' };
      }
      const low = Math.min(...candles.slice(i - p.exitBars, i).map(c => c.low));
      return current.close < low ? { type: 'EXIT', reason: `收盤跌破前 ${p.exitBars} 根低點，結構出場` } : { type: 'HOLD' };
    }
    const bb = indicators.bollinger(p.bbPeriod, p.bbMultiplier);
    const squeeze = indicators.squeeze(p.bbPeriod, p.bbMultiplier, p.widthLookback, p.widthPercentile, p.compressionBars, p.setupExpiryBars);
    /** 收斂必須在突破之前成立；當根 ATR14 已收盤，單位與股價相同，用於鎖定絕對風險。 */
    const setup = squeeze.setupIndex[i - 1], atr = indicators.atr(14)[i];
    if (setup < 0 || i - setup > p.setupExpiryBars || !Number.isFinite(atr) || atr <= 0) return { type: 'HOLD' };
    const history = candles.slice(i - p.breakoutBars, i);
    const breakoutPrice = Math.max(...history.map(c => c.high));
    const averageVolume = history.reduce((sum, c) => sum + c.volume, 0) / history.length;
    if (averageVolume <= 0 || current.close <= breakoutPrice || current.close <= bb.upper[i] || bb.width[i] <= bb.width[i - 1]
      || current.volume < averageVolume * p.volumeMultiplier || current.close - breakoutPrice > atr * p.maxExtensionAtr) return { type: 'HOLD' };
    return { type: 'ENTRY', side: 'LONG', entryPlan: { stopDistance: atr * p.stopAtr,
      minPrice: breakoutPrice, maxPrice: breakoutPrice + atr * p.maxExtensionAtr, breakoutPrice },
      reason: `收斂後突破前 ${p.breakoutBars} 根高點 ${breakoutPrice.toFixed(4)}，量能 ${(current.volume / averageVolume).toFixed(2)} 倍；鎖定 ATR14 ${atr.toFixed(4)}` };
  },
};
export default volatilitySqueezeBreakout;
