/** @file 波段快照與追蹤失效；同時附加無交易副作用的品質分析。 */
import cryptoWave, { analyzeWave, WAVE_INTERVAL_MS, type WaveSignal } from '../strategy/strategies/cryptoWave';
import { IndicatorCache } from '../strategy/indicatorCache';
import type { Candle, OpenPositionState } from '../strategy/types';
import { analyzeWaveQuality, type WaveAnalysis, type WaveSetup } from './analysis';
export { formatWaveCard as waveMessage } from './notifications';

export interface WaveSnapshot {
  signal: WaveSignal;
  // 純訊號追蹤部位，無資金或成交假設；報酬驗證由回測引擎扣費計算。
  tracking: { entryTime: number; stopPrice: number; referencePrice: number } | null;
  error: string | null;
  /** 本次快照實際採用的行情來源代碼(備援機制可能切換來源,故需逐次記錄) */
  source?: string | null;
  /** 舊快照可能尚無分析；頁面應顯示等待，不能補造分數或走勢。 */
  analysis?: WaveAnalysis;
  analysisNotifiedAt?: Partial<Record<WaveSetup, number>>;
}

/** 檢查最近 360 根連續、有效且已收盤；中斷資料不可當成正常市場訊號。 */
export function validateWaveCandles(candles: Candle[], now: number, requireFresh = true) {
  if (candles.length < 313) throw new Error('歷史不足：需要至少 313 根已收盤 4h K 線');
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.openTime, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
        c.low <= 0 || c.volume < 0 || c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close) ||
        c.openTime % WAVE_INTERVAL_MS !== 0 || c.openTime + WAVE_INTERVAL_MS > now ||
        (i > 0 && c.openTime !== candles[i - 1].openTime + WAVE_INTERVAL_MS)) {
      throw new Error('行情不完整或含未收盤資料，暫停判斷');
    }
  }
  if (requireFresh && now - (candles.at(-1)!.openTime + WAVE_INTERVAL_MS) >= WAVE_INTERVAL_MS) {
    throw new Error('行情已過期，等待最新已收盤 K 線');
  }
}

/** 依上次訊號追蹤失效；停機缺口無法補齊時，不假裝持續追蹤成功。 */
export function nextWaveSnapshot(candles: Candle[], previous: WaveSnapshot | null, source?: string): WaveSnapshot {
  const index = candles.length - 1;
  const current = candles[index];
  const indicators = new IndicatorCache(candles);
  const ctx = { candles, index, indicators, params: cryptoWave.defaultParams, position: null };
  let signal = analyzeWave(ctx);
  let tracking = previous?.tracking ?? null;
  if (tracking) {
    const since = candles.filter(c => c.openTime > (previous?.signal.barTime ?? tracking!.entryTime));
    if (previous && candles[0].openTime > previous.signal.barTime + WAVE_INTERVAL_MS) {
      throw new Error('追蹤期間資料缺口過長，需補齊歷史後重新驗證');
    }
    const position: OpenPositionState = {
      side: 'LONG', entryPrice: tracking.referencePrice, entryTime: tracking.entryTime,
      quantity: 1, stopLossPrice: tracking.stopPrice,
    };
    // 補看每根遺漏 K 線，不能只看最新價而漏掉已發生的停損或結構失效。
    const failed = since.some(c => c.low <= tracking!.stopPrice ||
      cryptoWave.evaluate({ ...ctx, index: candles.indexOf(c), position }).type === 'EXIT');
    if (failed) {
      signal = { ...signal, phase: 'EXIT', reason: '自上次掃描後觸及參考停損或跌破波段結構；此為訊號失效，非實際成交' };
      tracking = null;
    }
  }
  if (!tracking && signal.phase !== 'EXIT' && (signal.phase === 'BREAKOUT' || signal.phase === 'RETEST')) {
    tracking = { entryTime: current.openTime, referencePrice: current.close, stopPrice: current.close * (1 - signal.stopLossPct! / 100) };
  }
  return { signal, tracking, error: null, source: source ?? null,
    analysis: analyzeWaveQuality(candles, signal), analysisNotifiedAt: previous?.analysisNotifiedAt ?? {} };
}
