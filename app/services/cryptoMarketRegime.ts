import type { StockDataPoint } from "../types";
import { calculateATR, calculateMA } from "./stockService";
import { getKlines } from "./binanceService";
import { getMacroIndicators } from "./macroService";

export type MarketRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRASH";

export interface CryptoMarketRegime {
  allowLong: boolean;
  riskLevel: MarketRiskLevel;
  reason: string;
  metrics: {
    btcDrop1hPct: number;
    btcDrop4hPct: number;
    btcBelowMa200: boolean;
    btcAtrPct: number;
    btcVolumeRatio: number;
    symbolDrop1hPct: number;
    symbolVolumeRatio: number;
  };
}

const toStockPoints = (klines: Awaited<ReturnType<typeof getKlines>>): StockDataPoint[] =>
  klines.map((k) => ({
    date: new Date(k.openTime).toISOString(),
    timestamp: k.openTime,
    price: k.close,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
    currency: "USDT",
    isMock: false,
  }));

const pctChange = (current: number, previous: number) =>
  previous > 0 ? ((current - previous) / previous) * 100 : 0;

const getVolumeRatio = (points: StockDataPoint[], lookback = 20) => {
  if (points.length <= lookback) return 0;
  const current = points[points.length - 1];
  const history = points.slice(points.length - lookback - 1, points.length - 1);
  const avgVolume = history.reduce((sum, point) => sum + point.volume, 0) / history.length;
  return avgVolume > 0 ? current.volume / avgVolume : 0;
};

const closesNearLow = (point: StockDataPoint) => {
  const range = point.high - point.low;
  if (range <= 0) return false;
  return (point.close - point.low) / range <= 0.25;
};

export const evaluateCryptoMarketRegime = async (symbol: string): Promise<CryptoMarketRegime> => {
  try {
    const [btc1hRaw, btc4hRaw, symbol1hRaw] = await Promise.all([
      getKlines("BTCUSDT", "1h", 240),
      getKlines("BTCUSDT", "4h", 120),
      getKlines(symbol, "1h", 80),
    ]);

    const btc1h = toStockPoints(btc1hRaw);
    const btc4h = toStockPoints(btc4hRaw);
    const symbol1h = toStockPoints(symbol1hRaw);

    if (btc1h.length < 200 || btc4h.length < 2 || symbol1h.length < 2) {
      return {
        allowLong: false,
        riskLevel: "HIGH",
        reason: "虛擬幣風控資料不足，暫停開新倉",
        metrics: {
          btcDrop1hPct: 0,
          btcDrop4hPct: 0,
          btcBelowMa200: true,
          btcAtrPct: 0,
          btcVolumeRatio: 0,
          symbolDrop1hPct: 0,
          symbolVolumeRatio: 0,
        },
      };
    }

    const btcCurrent1h = btc1h[btc1h.length - 1];
    const btcPrev1h = btc1h[btc1h.length - 2];
    const btcCurrent4h = btc4h[btc4h.length - 1];
    const btcPrev4h = btc4h[btc4h.length - 2];
    const symbolCurrent = symbol1h[symbol1h.length - 1];
    const symbolPrev = symbol1h[symbol1h.length - 2];

    const btcDrop1hPct = pctChange(btcCurrent1h.close, btcPrev1h.close);
    const btcDrop4hPct = pctChange(btcCurrent4h.close, btcPrev4h.close);
    const symbolDrop1hPct = pctChange(symbolCurrent.close, symbolPrev.close);
    const btcVolumeRatio = getVolumeRatio(btc1h);
    const symbolVolumeRatio = getVolumeRatio(symbol1h);
    const btcMa200 = calculateMA(btc1h.map((point) => point.close), 200).at(-1) || 0;
    const btcAtr = calculateATR(btc1h, 14).at(-1) || 0;
    const btcAtrPct = btcCurrent1h.close > 0 ? (btcAtr / btcCurrent1h.close) * 100 : 0;
    const btcBelowMa200 = btcMa200 > 0 && btcCurrent1h.close < btcMa200;

    const btcPanicCandle =
      btcCurrent1h.close < btcCurrent1h.open &&
      closesNearLow(btcCurrent1h) &&
      btcVolumeRatio >= 2.5;
    const symbolPanicCandle =
      symbolCurrent.close < symbolCurrent.open &&
      closesNearLow(symbolCurrent) &&
      symbolVolumeRatio >= 3;

    const metrics = {
      btcDrop1hPct,
      btcDrop4hPct,
      btcBelowMa200,
      btcAtrPct,
      btcVolumeRatio,
      symbolDrop1hPct,
      symbolVolumeRatio,
    };

    // 【詳細繁體中文註解】
    // 獲取並整合全球總經風控指標
    const macro = await getMacroIndicators();
    const macroState = macro?.regime?.riskState || "RISK_ON";
    const macroReason = macro?.regime?.reason || "";

    // 1. 最高風險：技術面熔斷或總經恐慌
    if (btcDrop1hPct <= -4 || btcDrop4hPct <= -8 || btcPanicCandle || symbolDrop1hPct <= -6 || symbolPanicCandle || macroState === "PANIC") {
      return {
        allowLong: false,
        riskLevel: "CRASH",
        reason: macroState === "PANIC" 
          ? `【總經風控熔斷】${macroReason}` 
          : "偵測到瀑布或爆量長黑，暫停虛擬幣做多",
        metrics,
      };
    }

    // 2. 高風險：BTC 技術面偏弱，或者總經環境處於嚴格收緊狀態 (RISK_OFF 且限制做多)
    const isMacroRiskOffAborting = macroState === "RISK_OFF" && macro?.regime?.allowLong === false;
    if (btcBelowMa200 || btcDrop1hPct <= -2.5 || btcDrop4hPct <= -5 || btcAtrPct >= 6 || isMacroRiskOffAborting) {
      return {
        allowLong: false,
        riskLevel: "HIGH",
        reason: isMacroRiskOffAborting
          ? `【總經收緊警示】${macroReason}`
          : "BTC 風險狀態偏高，暫停開新倉保護本金",
        metrics,
      };
    }

    // 3. 中風險：BTC 技術面波動大，或總經提示應壓低倉位
    const isMacroRiskOffSoft = macroState === "RISK_OFF" && macro?.regime?.allowLong === true;
    if (btcAtrPct >= 4 || btcVolumeRatio >= 1.8 || isMacroRiskOffSoft) {
      return {
        allowLong: true,
        riskLevel: "MEDIUM",
        reason: isMacroRiskOffSoft
          ? `【總經提示】${macroReason}`
          : "市場波動偏高，允許交易但須壓低倉位",
        metrics,
      };
    }

    return {
      allowLong: true,
      riskLevel: "LOW",
      reason: "虛擬幣與總經環境皆穩定，未觸發風控條件",
      metrics,
    };
  } catch (error: any) {
    return {
      allowLong: false,
      riskLevel: "HIGH",
      reason: `虛擬幣風控資料取得失敗，暫停開新倉: ${error.message || "未知錯誤"}`,
      metrics: {
        btcDrop1hPct: 0,
        btcDrop4hPct: 0,
        btcBelowMa200: true,
        btcAtrPct: 0,
        btcVolumeRatio: 0,
        symbolDrop1hPct: 0,
        symbolVolumeRatio: 0,
      },
    };
  }
};
