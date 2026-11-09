/** @file 4h EMA 趨勢、1h 放量突破／回踩與固定風險計畫；純計算，不發通知、不下單。 */
import { calculateATR, calculateEMA, calculateRSI } from '../indicators/technical';
import type { Candle } from '../strategy/types';
import { stockTokenQuoteIssue } from './market';
import { HOUR_MS, STOCK_TOKEN_RULES as RULES, type StockTokenCandidate, type StockTokenCandles,
  type StockTokenInstrument, type StockTokenPlan, type StockTokenQuote } from './types';

/** 週末／休市允許歷史有間隔，但最近 21 根 1h 必須連續，避免跨休市比較突破量。 */
function validHistory(candles: Candle[], duration: number, now: number) {
  return candles.length >= RULES.minBars && candles.every((c, i) =>
    [c.openTime, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    && c.openTime >= 0 && c.openTime % duration === 0 && c.openTime + duration <= now && c.low > 0 && c.volume >= 0
    && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close)
    && (i === 0 || c.openTime > candles[i - 1].openTime));
}

export function stockTokenPlanIssue(plan: StockTokenPlan, quote: StockTokenQuote, now: number): string | null {
  const quoteIssue = stockTokenQuoteIssue(quote, now);
  if (quoteIssue) return quoteIssue;
  if (now < plan.closedAt || now >= plan.expiresAt) return '進場訊號已過期，等待下一根確認';
  if (quote.ask < plan.entryLow || quote.ask > plan.entryHigh) return '買一價已離開進場區間，禁止追價';
  if (quote.bid <= plan.stopPrice || quote.ask >= plan.targetPrice) return '現價已觸及失效或目標價格';
  const currentRiskPct = (quote.ask - plan.stopPrice) / quote.ask * 100;
  if (currentRiskPct < RULES.minRiskPct || currentRiskPct > RULES.maxRiskPct) return '買一價至失效價的風險超出 0.5%～5%';
  if (stockTokenNetRewardRisk(plan, quote.ask) < RULES.minNetRewardRisk) return '估算費用後的報酬風險比低於 1.5';
  return null;
}

/** 費率為單邊 0.1% 研究估算；報酬與虧損都計入進出場費用，不宣稱為帳戶真實費率。 */
export function stockTokenNetRewardRisk(plan: Pick<StockTokenPlan, 'stopPrice' | 'targetPrice'>, entry: number) {
  const fee = RULES.estimatedFeeRate;
  return (plan.targetPrice - entry - (entry + plan.targetPrice) * fee)
    / (entry - plan.stopPrice + (entry + plan.stopPrice) * fee);
}

export function analyzeStockToken(instrument: StockTokenInstrument, quote: StockTokenQuote | undefined,
  history: StockTokenCandles, now: number): StockTokenCandidate {
  const base: StockTokenCandidate = { ...instrument, quote: quote ?? null, status: 'WAIT', reasons: [], plan: null, volumeRatio: null, rsi14: null };
  const finish = (status: StockTokenCandidate['status'], reason: string) => ({ ...base, status, reasons: [reason] });
  const quoteIssue = stockTokenQuoteIssue(quote, now);
  if (quoteIssue) return finish('EXCLUDED', quoteIssue);
  const { hourly, fourHourly } = history;
  if (!validHistory(hourly, HOUR_MS, now) || !validHistory(fourHourly, 4 * HOUR_MS, now)) return finish('INSUFFICIENT', '至少需要兩個週期各 80 根有效已收盤 K 線');
  const latest = hourly.at(-1)!, previous = hourly.at(-2)!, fourHour = fourHourly.at(-1)!;
  const closedAt = latest.openTime + HOUR_MS;
  if (now - closedAt >= RULES.validityMs || now - fourHour.openTime - 4 * HOUR_MS >= 4 * HOUR_MS) return finish('STALE', '已收盤訊號逾期或市場休市');
  const recent = hourly.slice(-21);
  if (recent.some((c, i) => i > 0 && c.openTime - recent[i - 1].openTime !== HOUR_MS)
    || recent.some(c => c.volume <= 0) || fourHour.volume <= 0) return finish('INSUFFICIENT', '最近 21 根小時線缺根或零成交量');
  const closes = hourly.map(c => c.close), fourCloses = fourHourly.map(c => c.close);
  const ema20 = calculateEMA(closes, 20), ema50 = calculateEMA(closes, 50);
  const fourEma20 = calculateEMA(fourCloses, 20), fourEma50 = calculateEMA(fourCloses, 50);
  const rsi14 = calculateRSI(closes, 14).at(-1)!;
  const data = hourly.map(c => ({ ...c, timestamp: c.openTime, price: c.close, date: '', currency: 'USDT', isMock: false }));
  /** ATR14 單位 USDT；突破位及量能基準排除訊號根，避免前視與自我抬高門檻。 */
  const atr14 = calculateATR(data, 14).at(-1)!, prior20 = hourly.slice(-21, -1);
  const volumeRatio = latest.volume / (prior20.reduce((sum, c) => sum + c.volume, 0) / 20);
  base.rsi14 = rsi14; base.volumeRatio = volumeRatio;
  if (![atr14, rsi14, volumeRatio].every(Number.isFinite) || atr14 <= 0) return finish('INSUFFICIENT', '技術指標無法有效計算');
  const trendUp = fourHour.close > fourEma20.at(-1)! && fourEma20.at(-1)! > fourEma50.at(-1)!
    && fourEma20.at(-1)! > fourEma20.at(-2)! && latest.close > ema20.at(-1)! && ema20.at(-1)! > ema50.at(-1)!;
  if (!trendUp) return finish('WAIT', '4h／1h EMA20、EMA50 多頭趨勢尚未同時確認');
  if (rsi14 < RULES.rsiMin || rsi14 > RULES.rsiMax) return finish('WAIT', '1h RSI14 不在 50～72 範圍，動能不足或過熱');
  const breakout = latest.close > Math.max(...prior20.map(c => c.high)) && volumeRatio >= RULES.breakoutVolumeRatio;
  const retest = latest.low <= ema20.at(-1)! + 0.5 * atr14 && latest.low >= ema20.at(-1)! - 0.5 * atr14
    && latest.close > previous.high && latest.close > latest.open && volumeRatio >= RULES.retestVolumeRatio;
  if (!breakout && !retest) return finish('WAIT', '等待前 20 根高點放量突破，或 EMA20 回踩轉強');
  const stopPrice = Math.min(Math.min(...hourly.slice(-5).map(c => c.low)) - 0.25 * atr14, latest.close - RULES.stopAtr * atr14);
  const risk = latest.close - stopPrice, riskPct = risk / latest.close * 100;
  if (stopPrice <= 0 || riskPct < RULES.minRiskPct || riskPct > RULES.maxRiskPct) return finish('EXCLUDED', '訊號價至失效價距離不在 0.5%～5%，不產生進場計畫');
  const plan: StockTokenPlan = { kind: breakout ? 'BREAKOUT' : 'RETEST', closedAt, expiresAt: closedAt + RULES.validityMs,
    referencePrice: latest.close, entryLow: latest.close - 0.25 * atr14,
    entryHigh: latest.close + Math.min(0.25 * atr14, latest.close * 0.005),
    stopPrice, targetPrice: latest.close + RULES.targetR * risk, riskPct, netRewardRisk: 0 };
  plan.netRewardRisk = stockTokenNetRewardRisk(plan, quote!.ask);
  const planIssue = stockTokenPlanIssue(plan, quote!, now);
  if (planIssue) return finish('WAIT', planIssue);
  plan.riskPct = (quote!.ask - plan.stopPrice) / quote!.ask * 100;
  return { ...base, status: 'ENTRY', plan, reasons: ['4h／1h EMA20 > EMA50，多頭確認',
    breakout ? '1h 收盤突破前 20 根高點且量比 ≥ 1.5' : '1h 回踩 EMA20 ± 0.5 ATR 後收復前高且量比 ≥ 1',
    `RSI14 ${rsi14.toFixed(1)}；量比 ${volumeRatio.toFixed(2)}`] };
}
