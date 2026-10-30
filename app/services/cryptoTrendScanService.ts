import type { StockDataPoint } from '../types';
import { getKlines } from './binanceService';
import { calculateEMA, calculateMACD, calculateRSI, calculateSupertrend } from './indicators/technical';
import { fetchStockData } from './stockService';

/**
 * 【詳細繁體中文註解】：虛擬幣 4H 雙向趨勢掃描結果型別
 */
export interface CryptoTrendScanResult {
  signal: 'LONG' | 'SHORT' | 'HOLD';
  reason: string;
  price: number;
  indicators: {
    price?: number;
    rsi?: string;
    macdHist?: string;
    trend?: 'UP' | 'DOWN';
    macdCross?: 'GOLDEN' | 'DEATH';
    ema200?: string;
    volumeRatio?: string;
    closeStrength?: string;
    /** 已收盤 K 線時間戳（毫秒 UTC），供外層排程按 K 線去重，避免同一根 4H K 線重複發送通知 */
    barTime?: number;
  };
}

/**
 * 【詳細繁體中文註解】：計算單根 K 線的多方收盤位置強度（0 ~ 1）
 * - 接近 1 代表收在當根最高點附近（強勢實體收紅，無長上影線拋壓）。
 * - 接近 0 代表收在當根最低點附近（空方壓制或長上影線倒錘頭）。
 */
const computeCandleCloseStrength = (bar: Pick<StockDataPoint, 'high' | 'low' | 'close'>): number => {
  const range = bar.high - bar.low;
  if (!(range > 0)) return 0.5;
  return Math.max(0, Math.min(1, (bar.close - bar.low) / range));
};

/**
 * 【詳細繁體中文註解】：純函式評估虛擬幣雙向趨勢共振策略（防重繪強化版）
 *
 * 勝率改善核心設計：
 * 1. 嚴格使用最後一根「已收盤」K 線（`data.slice(0, -1)`）：
 *    Binance 與行情來源回傳的最後一根 K 線（`data[data.length - 1]`）通常仍在盤中跳動，
 *    若直接取最後一根計算 Supertrend 翻向與 MACD 金叉／死叉，盤中上下插針會反覆觸發假訊號（Repainting）。
 *    因此必須排除最後一根未收盤 K 線，僅以已收盤序列（`closedData`）計算全部技術指標。
 * 2. 引入 EMA200（樣本不足 200 根時退回 EMA50）長線多空分水嶺：
 *    - 順勢做多（A1 趨勢反轉、A2 多頭加倉）要求收盤價不低於長線均線（A1 容許 2% 緩衝啟動轉折，A2 必須站穩均線之上），防止空頭大趨勢中死貓跳追高。
 *    - 順勢做空（B1 趨勢反轉、B2 空頭加速）要求收盤價不高於長線均線（B1 容許 2% 緩衝，B2 必須位於均線之下），防止多頭主升段逆勢摸頂。
 * 3. 加入 20 期均量確認與 K 線收盤強度門檻：
 *    - 趨勢翻轉（A1 / B1）要求當根量能 >= 20 期均量的 1.2 倍且同向收盤強度 >= 0.55，過濾無量假突破與長影線騙線。
 *    - 動能延續（A2 / B2）要求當根量能 >= 20 期均量的 1.0 倍，且 RSI 尚未進入極端過熱／超賣鈍化區（多單 RSI < 72、空單 RSI > 28）。
 * 4. 修正超跌／超買反轉（A3 / B3）為真實可成交且具反轉 K 棒確認的門檻：
 *    - 4H 週期原 `RSI < 15` 或 `RSI > 85` 極罕見且多為崩盤／軋空主段，改為 `RSI <= 28`（做多）與 `RSI >= 72`（做空），
 *      並強制要求 MACD 柱狀圖收斂加上當根收出明確同向反轉實體（收盤強度 >= 0.55），不接無止跌跡象的飛刀。
 */
export const evaluateCryptoTrendFromData = (data: StockDataPoint[]): CryptoTrendScanResult => {
  // 至少需要 52 根（扣除最後 1 根未收盤後仍有 51 根已收盤資料供指標暖機）
  if (data.length < 52) {
    return { signal: 'HOLD', reason: '資料量不足', price: 0, indicators: {} };
  }

  // 排除最後一根未收盤 K 線，防止盤中插針重繪
  const closedData = data.slice(0, data.length - 1);
  const current = closedData[closedData.length - 1];
  const prev = closedData[closedData.length - 2];
  const price = current.close;
  const prices = closedData.map(d => d.close);

  // 1. Supertrend (ATR 倍數 3.0、週期 10)：dir = -1 代表多頭趨勢，dir = 1 代表空頭趨勢
  const { dir } = calculateSupertrend(closedData, 3.0, 10);
  const currDir = dir[dir.length - 1];
  const prevDir = dir[dir.length - 2];

  // 2. MACD (12, 26, 9) 動能指標
  const macd = calculateMACD(prices);
  const currHist = macd.hist[macd.hist.length - 1];
  const prevHist = macd.hist[macd.hist.length - 2];
  const currMacd = macd.dif[macd.dif.length - 1];
  const currSignal = macd.macd[macd.macd.length - 1];

  // 3. RSI (14) 強弱指標
  const rsiList = calculateRSI(prices, 14);
  const currRsi = rsiList[rsiList.length - 1] ?? 50;

  // 4. 長線趨勢均線（優先使用 EMA200；若歷史根數不足 200 則退回 EMA50）
  const emaPeriod = closedData.length >= 200 ? 200 : 50;
  const emaSeries = calculateEMA(prices, emaPeriod);
  const trendEma = emaSeries[emaSeries.length - 1] ?? price;

  // 5. 前 20 根已收盤均量與當根量能比、收盤強度
  const volumeWindow = closedData.slice(Math.max(0, closedData.length - 21), closedData.length - 1);
  const avgVolume20 = volumeWindow.length > 0
    ? volumeWindow.reduce((sum, bar) => sum + bar.volume, 0) / volumeWindow.length
    : current.volume;
  const volumeRatio = avgVolume20 > 0 ? current.volume / avgVolume20 : 1;
  const closeStrength = computeCandleCloseStrength(current);
  const bearishCloseStrength = 1 - closeStrength;

  const indicators: CryptoTrendScanResult['indicators'] = {
    price,
    rsi: currRsi.toFixed(2),
    macdHist: currHist?.toFixed(4),
    trend: currDir === -1 ? 'UP' : 'DOWN',
    macdCross: currMacd > currSignal ? 'GOLDEN' : 'DEATH',
    ema200: trendEma.toFixed(4),
    volumeRatio: volumeRatio.toFixed(2),
    closeStrength: closeStrength.toFixed(2),
    barTime: current.timestamp ?? 0,
  };

  // --- A. 做多策略 (LONG) ---
  // A1. 趨勢反轉做多：Supertrend 由紅翻綠 + RSI > 45 + 價格不低於長線均線 -2% + 量能放大 >= 1.2x + 多方收盤強度 >= 0.55
  if (
    currDir === -1 &&
    prevDir === 1 &&
    currRsi > 45 &&
    currRsi < 75 &&
    price >= trendEma * 0.98 &&
    volumeRatio >= 1.2 &&
    closeStrength >= 0.55
  ) {
    return {
      signal: 'LONG',
      reason: '【趨勢反轉】已收盤 Supertrend 翻綠 + 帶量站穩長線均線，多頭動能啟動',
      price,
      indicators,
    };
  }

  // A2. 順勢動能加倉做多：多頭趨勢中 MACD 金叉轉正 + 價格位於長線均線之上 + RSI 介於 50~72 + 量能不萎縮 (>= 1.0x)
  if (
    currDir === -1 &&
    currMacd > currSignal &&
    prevHist < 0 &&
    currHist > 0 &&
    currRsi > 50 &&
    currRsi < 72 &&
    price >= trendEma &&
    volumeRatio >= 1.0 &&
    closeStrength >= 0.5
  ) {
    return {
      signal: 'LONG',
      reason: '【多頭加倉】趨勢向上且 MACD 金叉翻紅、量能支撐，順勢延續行情',
      price,
      indicators,
    };
  }

  // A3. 超跌止跌反彈做多：4H RSI <= 28 超賣 + MACD 綠柱收斂 + 當根收紅且收盤位於上半部 (>= 0.55)
  if (
    currRsi <= 28 &&
    currHist > prevHist &&
    current.close > current.open &&
    closeStrength >= 0.55 &&
    volumeRatio >= 1.0
  ) {
    return {
      signal: 'LONG',
      reason: '【超跌止跌】RSI 進入超賣區且空頭動能收斂、收出止跌紅 K，預期技術性反彈',
      price,
      indicators,
    };
  }

  // --- B. 做空策略 (SHORT) ---
  // B1. 趨勢反轉做空：Supertrend 由綠翻紅 + RSI < 55 + 價格不高於長線均線 +2% + 量能放大 >= 1.2x + 空方收盤強度 >= 0.55
  if (
    currDir === 1 &&
    prevDir === -1 &&
    currRsi < 55 &&
    currRsi > 25 &&
    price <= trendEma * 1.02 &&
    volumeRatio >= 1.2 &&
    bearishCloseStrength >= 0.55
  ) {
    return {
      signal: 'SHORT',
      reason: '【趨勢反轉】已收盤 Supertrend 翻紅 + 帶量跌破均線支撐，空頭勢力介入',
      price,
      indicators,
    };
  }

  // B2. 順勢動能加速做空：空頭趨勢中 MACD 跌破訊號線轉負 + 價格位於長線均線之下 + RSI 介於 28~45 + 量能不萎縮 (>= 1.0x)
  if (
    currDir === 1 &&
    currMacd < currSignal &&
    prevHist > 0 &&
    currHist < 0 &&
    currRsi < 45 &&
    currRsi > 28 &&
    price <= trendEma &&
    volumeRatio >= 1.0 &&
    bearishCloseStrength >= 0.5
  ) {
    return {
      signal: 'SHORT',
      reason: '【空頭加速】趨勢向下且 MACD 跌破訊號線、空頭動能擴大，跌勢延續',
      price,
      indicators,
    };
  }

  // B3. 超買見頂回調做空：4H RSI >= 72 過熱 + MACD 紅柱衰退 + 當根收黑且收盤位於下半部 (空方強度 >= 0.55)
  if (
    currRsi >= 72 &&
    currHist < prevHist &&
    current.close < current.open &&
    bearishCloseStrength >= 0.55 &&
    volumeRatio >= 1.0
  ) {
    return {
      signal: 'SHORT',
      reason: '【超買見頂】RSI 過熱且多頭動能衰退、收出轉弱黑 K，預期出現回調',
      price,
      indicators,
    };
  }

  return {
    signal: 'HOLD',
    reason: '目前訊號不明確或未通過均線／量能確認，建議觀望等待共振點',
    price,
    indicators,
  };
};

/**
 * 【詳細繁體中文註解】：評估虛擬幣雙向趨勢策略 (Long/Short)
 * - 針對 `*USDT` 交易對優先使用 Binance / OKX 原生 K 線（`getKlines`），避免 Yahoo Finance 對 USDT 現貨代號查無資料；
 *   若原生 K 線異常或為其他金融商品代號，則自動 fallback 至 `fetchStockData`。
 * - 內部委派 `evaluateCryptoTrendFromData`，嚴格以最後一根「已收盤」K 線進行判斷。
 */
export const evaluateCryptoStrategy = async (
  symbol: string,
  interval: string = '4h'
): Promise<CryptoTrendScanResult> => {
  try {
    let data: StockDataPoint[] = [];
    if (symbol.toUpperCase().endsWith('USDT')) {
      try {
        const klines = await getKlines(symbol.toUpperCase(), interval, 240);
        data = klines.map(k => ({
          date: new Date(k.openTime).toISOString(),
          timestamp: k.openTime,
          price: k.close,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
          currency: 'USD',
          isMock: false,
        }));
      } catch {
        // 原生加密貨幣 K 線失敗時退回通用行情抓取
      }
    }
    if (data.length < 52) {
      const fetched = await fetchStockData(symbol, 200, interval);
      data = fetched.data;
    }
    return evaluateCryptoTrendFromData(data);
  } catch {
    return { signal: 'HOLD', reason: '系統評估異常', price: 0, indicators: {} };
  }
};
