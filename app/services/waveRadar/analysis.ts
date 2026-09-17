/** @file 波段通知的額外品質檢查；只讀已收盤 4h 資料，條件尚未經樣本外勝率驗證。 */
import { IndicatorCache } from '../strategy/indicatorCache';
import type { Candle } from '../strategy/types';
import type { WaveSignal } from '../strategy/strategies/cryptoWave';

export type WaveSetup = 'CONFIRMED_BREAKOUT' | 'CONFIRMED_RETEST' | 'TREND_PULLBACK' | 'NONE';
export type PullbackStage = 'CONFIRMED' | 'FORMING' | 'NONE';
export const WAVE_ANALYSIS_VERSION = 'quality-v2' as const;
export const SETUP_LABELS: Record<WaveSetup, string> = {
  CONFIRMED_BREAKOUT: '突破品質確認', CONFIRMED_RETEST: '回測守穩確認', TREND_PULLBACK: '趨勢回踩轉強', NONE: '等待品質確認',
};
export interface WaveAnalysis {
  version: typeof WAVE_ANALYSIS_VERSION;
  setup: WaveSetup;
  checks: { label: string; passed: boolean }[];
  changePct: number;
  closes: number[];
  closeStrength: number;
  distanceAtr: number | null;
  stopPrice: number | null;
  target1R: number | null;
  target2R: number | null;
  reference: number | null;
  /** 回踩候選只供觀察排序；CONFIRMED 才代表本根完成轉強確認，仍不會自動下單。 */
  pullbackStage: PullbackStage;
  pullbackMa20: number | null;
  pullbackChecks: { label: string; passed: boolean }[];
  nextStep: string;
}

/** 2 ATR 參考風險不得超過 8%；收盤需在 K 線上方 70%，避免只靠長上影放量判斷。 */
export function analyzeWaveQuality(candles: Candle[], signal: WaveSignal): WaveAnalysis {
  const index = candles.length - 1;
  const current = candles[index];
  const previous = candles[index - 1];
  const indicators = new IndicatorCache(candles);
  const atr = indicators.atr(14)[index];
  const ma20 = indicators.ma(20);
  const closeStrength = current.high > current.low ? (current.close - current.low) / (current.high - current.low) : 0;
  const quoteVolume = candles.slice(-6).reduce((sum, c) => sum + c.volume * c.close, 0);
  const validPullbackInputs = Number.isFinite(atr) && atr > 0 && Number.isFinite(ma20[index]) && Number.isFinite(ma20[index - 1]);
  /** 回踩候選分成「形成中」與「確認」；兩者都是研究訊號，不修改原策略的進場預設值。 */
  const pullbackChecks = [
    { label: '完整日線趨勢向上', passed: signal.dailyTrend },
    { label: '4h MA20 持續上升', passed: validPullbackInputs && ma20[index] > ma20[index - 1] },
    { label: '近兩根曾回到 MA20 支撐帶', passed: validPullbackInputs && Math.min(previous.low, current.low) <= ma20[index] + atr * 0.5 },
    { label: '收盤仍在 MA20 半個 ATR 內', passed: validPullbackInputs && current.close >= ma20[index] - atr * 0.5 && current.close - ma20[index] <= atr },
    { label: '收盤突破前根高點確認轉強', passed: current.close > previous.high },
  ];
  const pullbackForming = pullbackChecks.slice(0, 4).every(check => check.passed);
  const pullbackConfirmed = pullbackForming && pullbackChecks[4].passed && current.close > ma20[index];
  const pullbackStage: PullbackStage = pullbackConfirmed ? 'CONFIRMED' : pullbackForming ? 'FORMING' : 'NONE';
  const reference = signal.phase === 'BREAKOUT' || signal.phase === 'RETEST' ? signal.breakout : pullbackForming ? ma20[index] : signal.breakout;
  const distanceAtr = reference != null && atr > 0 ? (current.close - reference) / atr : null;
  const riskPct = signal.stopLossPct;
  const requiredVolume = signal.phase === 'BREAKOUT' ? 2 : 1.2;
  const checks = [
    { label: '完整日線趨勢向上', passed: signal.dailyTrend },
    { label: `4h 量能至少 ${requiredVolume} 倍`, passed: (signal.volumeRatio ?? 0) >= requiredVolume },
    { label: '收盤位於振幅上方 70%', passed: closeStrength >= 0.7 },
    { label: '距參考位不超過 1 ATR', passed: distanceAtr != null && distanceAtr >= 0 && distanceAtr <= 1 },
    { label: 'ATR 參考風險不超過 8%', passed: riskPct != null && riskPct > 0 && riskPct <= 8 },
    { label: '單所 24h 估計成交額至少 100 萬 USDT', passed: quoteVolume >= 1_000_000 },
  ];
  let setup: WaveSetup = 'NONE';
  if (checks.every(check => check.passed) && !['EXIT', 'EXTENDED'].includes(signal.phase)) {
    if (signal.phase === 'BREAKOUT') setup = 'CONFIRMED_BREAKOUT';
    else if (signal.phase === 'RETEST') setup = 'CONFIRMED_RETEST';
    else if (pullbackConfirmed) setup = 'TREND_PULLBACK';
  }
  const stopPrice = riskPct != null && riskPct > 0 && riskPct <= 8 && signal.phase !== 'EXIT'
    ? current.close * (1 - riskPct / 100) : null;
  const risk = stopPrice == null ? null : current.close - stopPrice;
  return { version: WAVE_ANALYSIS_VERSION, setup, checks, changePct: (current.close / previous.close - 1) * 100,
    closes: candles.slice(-24).map(c => c.close), closeStrength, distanceAtr, stopPrice,
    target1R: risk == null ? null : current.close + risk,
    target2R: risk == null ? null : current.close + 2 * risk, reference, pullbackStage,
    pullbackMa20: validPullbackInputs ? ma20[index] : null, pullbackChecks,
    nextStep: signal.phase === 'EXIT' ? '原追蹤條件已失效，重新等待結構成立。' :
      setup === 'CONFIRMED_BREAKOUT' ? '觀察後續收盤能否守住突破位；跌回區間需重新評估。' :
      setup === 'CONFIRMED_RETEST' ? '觀察回測低點與原突破位能否持續守住。' :
      setup === 'TREND_PULLBACK' ? '觀察 4h MA20 與回踩低點；跌破時回踩論點失效。' :
      pullbackStage === 'FORMING' ? '價格正在測試 4h MA20 支撐，等待收盤突破前根高點確認轉強。' :
      signal.phase === 'EXTENDED' ? '等待價格整理，避免在延伸段追價。' : '等待更多量價條件成立；目前沒有額外品質確認。',
  };
}
