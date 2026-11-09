/**
 * @file 美股、台股與加密貨幣共用的「多空反轉區間（Reversal Zone）」純函式計算引擎
 *
 * 【詳細繁體中文註解】：
 * 1. 設計目的：
 *    協助使用者在美股、Bitget 美股永續合約與加密貨幣的震盪或跌勢反彈行情中，
 *    精準抓出「做空反轉壓力區間（開空點）」與「做多反轉支撐區間（抄底／回踩做多點）」，
 *    並自動算出結構停損價（SL）、第一目標價（TP1 布林中軌 MA20）、第二目標價（TP2 對側波段區間）與預估盈虧比（R 倍數）。
 * 2. 核心指標與結構依據：
 *    - 波段箱型結構（Swing High / Swing Low）：回看近期 `lookback = 24` 根已收盤 K 線（排除當根以抓出客觀前高／前低）。
 *    - 布林通道（Bollinger Bands 20, 2σ）：衡量統計學上的極端超買（上軌 `bollingerUpper`）與極端超賣（下軌 `bollingerLower`）。
 *    - 真實波動幅度（ATR 14）：用來動態調整反轉區間寬度與結構停損緩衝（`0.8 * ATR`），避免固定百分比在不同波動率商品失真。
 *    - 相對強弱指標（RSI 14）與 K 線上下影線／吞噬結構：確認價格進入反轉區間後是否真正出現「假突破收回（做空）」或「破底翻止跌（做多）」。
 * 3. 風控與無副作用保證：
 *    本模組為純計算函式，只讀已收盤 K 線，不觸發任何真實下單或通知副作用。
 */
import { IndicatorCache } from "./indicatorCache";
import type { Candle } from "./types";

/**
 * 單一方向（做多支撐或做空壓力）的反轉區間交易計畫
 */
export interface ReversalBandPlan {
  /** 方向：LONG 為做多支撐反轉區，SHORT 為做空壓力反轉區 */
  side: "LONG" | "SHORT";
  /** 反轉進場區間下緣（價格單位依商品：USD / USDT / TWD） */
  zoneLow: number;
  /** 反轉進場區間上緣（價格單位依商品：USD / USDT / TWD） */
  zoneHigh: number;
  /** 結構失效停損價（做多為跌破區間下緣減 0.8 ATR；做空為突破區間上緣加 0.8 ATR） */
  stopLoss: number;
  /** 第一目標價 TP1：回歸布林中軌（MA20 均值回歸目標） */
  target1: number;
  /** 第二目標價 TP2：對側波段區間邊界或 2R 延伸目標 */
  target2: number;
  /** 從區間參考進場價到停損價的風險百分比（%，正值） */
  riskPct: number;
  /** 以第二目標價計算的預估毛報酬風險比（R 倍數） */
  rewardRiskRatio: number;
}

/**
 * 反轉訊號狀態分類：
 * - LONG_CONFIRMED：已觸及或刺破做多支撐區間並收盤確認止跌回升（可執行做多）
 * - SHORT_CONFIRMED：已觸及或刺穿做空壓力區間並收盤確認受阻回落（可執行做空）
 * - APPROACHING_LONG：現價進入或逼近做多反轉支撐區（距離 <= 0.8 ATR），等待止跌 K 棒確認
 * - APPROACHING_SHORT：現價進入或逼近做空反轉壓力區（距離 <= 0.8 ATR），等待受阻 K 棒確認
 * - MID_RANGE：現價位於箱型區間中軸附近，多空皆無反轉邊際優勢，宜觀望
 */
export type ReversalSignalState =
  | "LONG_CONFIRMED"
  | "SHORT_CONFIRMED"
  | "APPROACHING_LONG"
  | "APPROACHING_SHORT"
  | "MID_RANGE";

/**
 * 完整的多空反轉區間分析結果
 */
export interface ReversalZoneAnalysis {
  /** 訊號對應的最後一根已收盤 K 線開盤時間戳（毫秒 UTC） */
  barTime: number;
  /** 最新已收盤價 */
  closePrice: number;
  /** 當前反轉狀態 */
  signalState: ReversalSignalState;
  /** 當前優先方向建議 */
  direction: "LONG" | "SHORT" | "NEUTRAL";
  /** 條件符合度評分（0～100），供掃描器與戰略面板排序 */
  score: number;
  /** 狀態中文短標籤 */
  badge: string;
  /** 詳細繁體中文觸發原因與操作劇本說明 */
  reason: string;
  /** 做多反轉支撐區間計畫（下方低吸／破底翻做多） */
  longZone: ReversalBandPlan;
  /** 做空反轉壓力區間計畫（上方摸頂／假突破做空） */
  shortZone: ReversalBandPlan;
  /** 關鍵技術指標快照 */
  metrics: {
    /** 近期波段箱頂（前高壓力） */
    swingHigh: number;
    /** 近期波段箱底（前低支撐） */
    swingLow: number;
    /** 布林通道上軌（20, 2σ） */
    bollingerUpper: number;
    /** 布林通道中軌（MA20） */
    bollingerBasis: number;
    /** 布林通道下軌（20, 2σ） */
    bollingerLower: number;
    /** 14 期真實波動幅度（ATR） */
    atr14: number;
    /** 14 期相對強弱指標（RSI） */
    rsi14: number;
    /** 200 期指數移動平均線（牛熊生命線，資料不足 200 根時為 EMA50） */
    emaTrend: number;
    /** 是否出現向上假突破前高／布林上軌後跌回 */
    isFakeBreakoutUp: boolean;
    /** 是否出現向下假跌破前低／布林下軌後收回 */
    isFakeBreakdownLow: boolean;
  };
}

/** 波段高低點回看根數（24 根已收盤 K 線：1h 代表 1 天、4h 代表 4 天、15m 代表 6 小時、1d 代表約 1 個月交易日） */
const SWING_LOOKBACK_BARS = 24;

/** 結構停損外推 ATR 倍數（0.8 倍 ATR，避免剛好停在高低點被流動性獵殺掃損） */
const STOP_BUFFER_ATR_MULT = 0.8;

/** 反轉區間帶寬 ATR 倍數（0.45 倍 ATR，形成具實戰容錯率的價格帶而非單一價位） */
const ZONE_WIDTH_ATR_MULT = 0.45;

/** 依價格大小格式化精確度，方便組入繁體中文理由字串 */
export function formatReversalPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  if (price >= 1000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  return price.toFixed(5);
}

/**
 * 【詳細繁體中文註解】
 * 針對已收盤 K 線序列計算「做多支撐反轉區間」與「做空壓力反轉區間」及即時確認訊號。
 * @param candles 已收盤 K 線陣列（呼叫端應先排除未收盤當根，至少需 30 根才能計算 BB20、RSI14、ATR14 與 24 根高低點）
 */
export function analyzeReversalZone(candles: Candle[]): ReversalZoneAnalysis | null {
  if (!candles || candles.length < 30) return null;

  const lastIdx = candles.length - 1;
  const current = candles[lastIdx];
  const prev = candles[lastIdx - 1];
  const prev2 = candles[lastIdx - 2] ?? prev;

  const indicators = new IndicatorCache(candles);
  const bb = indicators.bollinger(20, 2);
  const atrList = indicators.atr(14);
  const rsiList = indicators.rsi(14);
  const ema200List = candles.length >= 200 ? indicators.ema(200) : indicators.ema(50);

  const bollingerUpper = bb.upper[lastIdx];
  const bollingerBasis = bb.basis[lastIdx];
  const bollingerLower = bb.lower[lastIdx];
  const atr14 = atrList[lastIdx];
  const rsi14 = rsiList[lastIdx];
  const prevRsi14 = rsiList[lastIdx - 1] ?? rsi14;
  const emaTrend = ema200List[lastIdx] || bollingerBasis;

  if (
    ![bollingerUpper, bollingerBasis, bollingerLower, atr14, rsi14].every(
      (v) => Number.isFinite(v) && v > 0
    )
  ) {
    return null;
  }

  // 取當根之前的 24 根已收盤 K 線計算客觀的前波箱頂 (swingHigh) 與前波箱底 (swingLow)
  const historyStart = Math.max(0, lastIdx - SWING_LOOKBACK_BARS);
  const priorSlice = candles.slice(historyStart, lastIdx);
  const swingHigh = Math.max(...priorSlice.map((c) => c.high));
  const swingLow = Math.min(...priorSlice.map((c) => c.low));
  const midRange = (swingHigh + swingLow) / 2;

  // ============================================================================
  // 1. 計算【做多反轉支撐區間 (Long Reversal Zone)】
  // ============================================================================
  const longBaseLow = Math.min(swingLow, bollingerLower);
  const longAnchorHigh = Math.min(
    midRange,
    Math.max(swingLow, bollingerLower) + atr14 * 0.15
  );
  const longZoneLow = longBaseLow;
  const longZoneHigh = Math.max(
    longZoneLow + atr14 * 0.2,
    Math.min(longAnchorHigh, longZoneLow + atr14 * ZONE_WIDTH_ATR_MULT)
  );
  const longStopLoss = Math.max(longZoneLow * 0.5, longZoneLow - atr14 * STOP_BUFFER_ATR_MULT);
  const longEntryRef = longZoneHigh;
  const longRiskDist = Math.max(longEntryRef - longStopLoss, atr14 * 0.5);
  const longTarget1 = Math.max(bollingerBasis, longEntryRef + longRiskDist);
  const longTarget2 = Math.max(
    swingHigh - atr14 * 0.25,
    longEntryRef + longRiskDist * 2.0
  );
  const longRiskPct = (longRiskDist / longEntryRef) * 100;
  const longRewardRiskRatio = (longTarget2 - longEntryRef) / longRiskDist;

  const longZone: ReversalBandPlan = {
    side: "LONG",
    zoneLow: longZoneLow,
    zoneHigh: longZoneHigh,
    stopLoss: longStopLoss,
    target1: longTarget1,
    target2: longTarget2,
    riskPct: longRiskPct,
    rewardRiskRatio: longRewardRiskRatio,
  };

  // ============================================================================
  // 2. 計算【做空反轉壓力區間 (Short Reversal Zone)】
  // ============================================================================
  const shortBaseHigh = Math.max(swingHigh, bollingerUpper);
  const shortAnchorLow = Math.max(
    midRange,
    Math.min(swingHigh, bollingerUpper) - atr14 * 0.15
  );
  const shortZoneHigh = shortBaseHigh;
  const shortZoneLow = Math.min(
    shortZoneHigh - atr14 * 0.2,
    Math.max(shortAnchorLow, shortZoneHigh - atr14 * ZONE_WIDTH_ATR_MULT)
  );
  const shortStopLoss = shortZoneHigh + atr14 * STOP_BUFFER_ATR_MULT;
  const shortEntryRef = shortZoneLow;
  const shortRiskDist = Math.max(shortStopLoss - shortEntryRef, atr14 * 0.5);
  const shortTarget1 = Math.min(bollingerBasis, shortEntryRef - shortRiskDist);
  const shortTarget2 = Math.min(
    Math.max(longZoneHigh * 0.5, swingLow + atr14 * 0.25),
    Math.max(longZoneHigh * 0.5, shortEntryRef - shortRiskDist * 2.0)
  );
  const shortRiskPct = (shortRiskDist / shortEntryRef) * 100;
  const shortRewardRiskRatio = (shortEntryRef - shortTarget2) / shortRiskDist;

  const shortZone: ReversalBandPlan = {
    side: "SHORT",
    zoneLow: shortZoneLow,
    zoneHigh: shortZoneHigh,
    stopLoss: shortStopLoss,
    target1: shortTarget1,
    target2: shortTarget2,
    riskPct: shortRiskPct,
    rewardRiskRatio: shortRewardRiskRatio,
  };

  // ============================================================================
  // 3. 判讀【假突破做空 (Fake Breakout Short)】與【破底翻做多 (Spring / Reclaim Long)】
  // ============================================================================
  const candleRange = Math.max(current.high - current.low, 1e-8);
  /** 下影線比例（0~1）：衡量低檔承接買盤強度 */
  const lowerWickRatio = (Math.min(current.open, current.close) - current.low) / candleRange;
  /** 上影線比例（0~1）：衡量高檔調節賣壓強度 */
  const upperWickRatio = (current.high - Math.max(current.open, current.close)) / candleRange;

  const recentTouchedLow =
    current.low <= longZoneHigh * 1.003 ||
    prev.low <= longZoneHigh * 1.003 ||
    prev2.low <= longZoneHigh * 1.003;
  const recentTouchedHigh =
    current.high >= shortZoneLow * 0.997 ||
    prev.high >= shortZoneLow * 0.997 ||
    prev2.high >= shortZoneLow * 0.997;

  // 向下假跌破收回（破底翻）：近期最低點曾刺破前低或布林下軌，且當根收盤收回並轉強
  const isFakeBreakdownLow =
    (current.low < swingLow || prev.low < swingLow || current.low <= bollingerLower) &&
    current.close >= Math.min(swingLow, bollingerLower) &&
    (current.close > current.open || lowerWickRatio >= 0.35 || current.close > prev.close);

  // 向上假突破跌回（摸頂轉空）：近期最高點曾刺穿前高或布林上軌，且當根收盤跌回前高／上軌之下並轉弱
  const isFakeBreakoutUp =
    (current.high > swingHigh || prev.high > swingHigh || current.high >= bollingerUpper) &&
    current.close <= Math.max(swingHigh, bollingerUpper) &&
    (current.close < current.open || upperWickRatio >= 0.35 || current.close < prev.close);

  // 超賣支撐止跌確認：觸及支撐區且 RSI 低檔拐頭回升或收紅下影線
  const isOversoldBounce =
    recentTouchedLow &&
    current.close <= bollingerBasis &&
    ((rsi14 <= 42 && rsi14 > prevRsi14) ||
      (prevRsi14 <= 35 && current.close >= current.open));

  // 超買壓力受阻確認：觸及壓力區且 RSI 高檔拐頭向下或收黑上影線
  const isOverboughtReject =
    recentTouchedHigh &&
    current.close >= bollingerBasis &&
    ((rsi14 >= 58 && rsi14 < prevRsi14) ||
      (prevRsi14 >= 65 && current.close <= current.open));

  const distToLongAtr = (current.close - longZoneHigh) / atr14;
  const distToShortAtr = (shortZoneLow - current.close) / atr14;

  let signalState: ReversalSignalState = "MID_RANGE";
  let direction: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
  let score = 45;
  let badge = "⚪ 區間中軸・等待兩端反轉區";
  let reason = "";

  if ((isFakeBreakdownLow || isOversoldBounce) && current.close <= bollingerBasis) {
    signalState = "LONG_CONFIRMED";
    direction = "LONG";
    const trendBonus = current.close >= emaTrend ? 8 : 0;
    const reclaimBonus = isFakeBreakdownLow ? 12 : 5;
    score = Math.min(96, Math.round(76 + reclaimBonus + trendBonus + Math.max(0, (42 - rsi14) * 0.4)));
    badge = isFakeBreakdownLow
      ? "🟢 破底翻做多確認 (假跌破收回)"
      : "🟢 支撐區止跌做多確認";
    reason = `${
      isFakeBreakdownLow
        ? `測試前低／布林下軌後收出破底翻收回訊號`
        : `回測下軌支撐帶且 RSI(${rsi14.toFixed(1)}) 止跌回升`
    }｜建議做多區間 ${formatReversalPrice(longZoneLow)}～${formatReversalPrice(
      longZoneHigh
    )}，停損 ${formatReversalPrice(longStopLoss)}，目標 TP1 ${formatReversalPrice(
      longTarget1
    )} / TP2 ${formatReversalPrice(longTarget2)} (${longRewardRiskRatio.toFixed(1)}R)`;
  } else if ((isFakeBreakoutUp || isOverboughtReject) && current.close >= bollingerBasis) {
    signalState = "SHORT_CONFIRMED";
    direction = "SHORT";
    const trendBonus = current.close <= emaTrend ? 8 : 0;
    const rejectBonus = isFakeBreakoutUp ? 12 : 5;
    score = Math.min(96, Math.round(76 + rejectBonus + trendBonus + Math.max(0, (rsi14 - 58) * 0.4)));
    badge = isFakeBreakoutUp
      ? "🔴 假突破做空確認 (摸頂收回)"
      : "🔴 壓力區受阻做空確認";
    reason = `${
      isFakeBreakoutUp
        ? `刺穿前高／布林上軌後出現假突破跌回訊號`
        : `反彈觸及上軌壓力帶且 RSI(${rsi14.toFixed(1)}) 轉弱回落`
    }｜建議做空區間 ${formatReversalPrice(shortZoneLow)}～${formatReversalPrice(
      shortZoneHigh
    )}，停損 ${formatReversalPrice(shortStopLoss)}，目標 TP1 ${formatReversalPrice(
      shortTarget1
    )} / TP2 ${formatReversalPrice(shortTarget2)} (${shortRewardRiskRatio.toFixed(1)}R)`;
  } else if (distToLongAtr <= 0.85) {
    signalState = "APPROACHING_LONG";
    direction = "LONG";
    score = Math.min(75, Math.max(60, Math.round(72 - Math.max(0, distToLongAtr) * 10)));
    badge = "🟡 進入做多反轉支撐區";
    reason = `現價 (${formatReversalPrice(current.close)}) 已進入或逼近下方做多反轉區間 ${formatReversalPrice(
      longZoneLow
    )}～${formatReversalPrice(longZoneHigh)}（RSI ${rsi14.toFixed(
      1
    )}），留意下影線或收紅止跌即可分批做多，防守停損 ${formatReversalPrice(
      longStopLoss
    )}，反彈目標 ${formatReversalPrice(longTarget1)}。`;
  } else if (distToShortAtr <= 0.85) {
    signalState = "APPROACHING_SHORT";
    direction = "SHORT";
    score = Math.min(75, Math.max(60, Math.round(72 - Math.max(0, distToShortAtr) * 10)));
    badge = "🟠 進入做空反轉壓力區";
    reason = `現價 (${formatReversalPrice(current.close)}) 已進入或逼近上方做空反轉區間 ${formatReversalPrice(
      shortZoneLow
    )}～${formatReversalPrice(shortZoneHigh)}（RSI ${rsi14.toFixed(
      1
    )}），留意上影線或假突破收回即可分批開空，防守停損 ${formatReversalPrice(
      shortStopLoss
    )}，回落目標 ${formatReversalPrice(shortTarget1)}。`;
  } else {
    signalState = "MID_RANGE";
    direction = "NEUTRAL";
    score = 45;
    badge = "⚪ 位於箱型中段 (等待兩端反轉區)";
    reason = `現價 (${formatReversalPrice(
      current.close
    )}) 位於箱型中軸附近，不建議追價。請等待回落至下方【做多反轉區 ${formatReversalPrice(
      longZoneLow
    )}～${formatReversalPrice(longZoneHigh)}】低吸做多，或反彈至上方【做空反轉區 ${formatReversalPrice(
      shortZoneLow
    )}～${formatReversalPrice(shortZoneHigh)}】受阻開空。`;
  }

  return {
    barTime: current.openTime,
    closePrice: current.close,
    signalState,
    direction,
    score,
    badge,
    reason,
    longZone,
    shortZone,
    metrics: {
      swingHigh,
      swingLow,
      bollingerUpper,
      bollingerBasis,
      bollingerLower,
      atr14,
      rsi14,
      emaTrend,
      isFakeBreakoutUp,
      isFakeBreakdownLow,
    },
  };
}
