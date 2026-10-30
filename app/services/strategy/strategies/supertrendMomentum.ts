/**
 * 【詳細繁體中文註解】：策略 — Supertrend + MACD + RSI 雙向趨勢共振(V2)
 *
 * 來源:移植自 stockService.ts 的 evaluateCryptoStrategy()(4h 線雙向趨勢策略)。
 * 原函式只評估「最後一根 K 線」且自行 fetch 行情;本模組改為讀取 ctx.index 位置,
 * 使同一份邏輯可被回測引擎逐根重放,也可被 live 引擎以最後一根已收盤 K 線評估。
 *
 * 方向慣例(沿用 stockService.calculateSupertrend):dir = -1 代表多頭趨勢、dir = 1 代表空頭趨勢。
 *
 * 進場邏輯(六組條件,與原函式一致):
 *   做多 LONG:
 *     A1. Supertrend 翻多(dir 由 1 → -1)且 RSI > rsiLongTrend(45):趨勢反轉啟動
 *     A2. 多頭趨勢中 MACD 零軸上方二次金叉且 RSI > rsiLongMomentum(50):多頭加速
 *     A3. RSI < rsiExtremeOversold(15) 且 MACD 柱狀圖回升:超跌搶反彈
 *   做空 SHORT(僅回測模擬,現貨實盤不支援做空):
 *     B1. Supertrend 翻空(dir 由 -1 → 1)且 RSI < rsiShortTrend(55):趨勢反轉向下
 *     B2. 空頭趨勢中 MACD 跌破訊號線且柱狀圖轉負且 RSI < rsiShortMomentum(45):跌勢擴大
 *     B3. RSI > rsiExtremeOverbought(85) 且 MACD 柱狀圖衰退:超買見頂
 *
 * 出場邏輯(原函式缺出場規則,回測必須補上;採最直觀的趨勢跟隨出場):
 *   LONG 持倉:Supertrend 翻空(dir 轉為 1)即平倉
 *   SHORT 持倉:Supertrend 翻多(dir 轉為 -1)即平倉
 *   另有停損由引擎以 K 線 high/low 盤中觸價判斷。
 *
 * 風險假設:趨勢策略在盤整期會被 Supertrend 反覆巴來巴去(whipsaw),
 * 適合波動明確的加密貨幣 4h 週期;短週期(15m)雜訊多,回測時請留意交易成本侵蝕。
 */

import type { StrategyModule, StrategyContext, StrategyAction } from '../types';

const supertrendMomentum: StrategyModule = {
  id: 'supertrend_momentum',
  name: 'Supertrend 動能共振(雙向)',
  description:
    'Supertrend(3.0, 10) 趨勢方向 + MACD 動能 + RSI 強弱三重共振,雙向進場;Supertrend 翻向或停損出場。',
  // 加密貨幣以 4h 為主;虛擬幣概念美股(COIN/MSTR 等)走日線波段,趨勢邏輯同樣適用
  markets: ['CRYPTO', 'US'],
  supportedIntervals: ['1h', '4h', '1d'],
  // 暖機根數:MACD 慢線 26 + 訊號 9 需 ~35 根、Supertrend 需 period+1 根;取 60 根保守留裕度
  warmupBars: 60,
  supportsShort: true,
  defaultParams: {
    // Supertrend 參數:factor 3.0 / period 10(沿用原 evaluateCryptoStrategy 設定)
    stFactor: 3,
    stPeriod: 10,
    // RSI 週期
    rsiPeriod: 14,
    // 做多門檻:趨勢反轉需 RSI > 45(進入強勢區)、動能加速需 RSI > 50
    rsiLongTrend: 45,
    rsiLongMomentum: 50,
    // 做空門檻:趨勢反轉需 RSI < 55(轉弱)、動能擴大需 RSI < 45
    rsiShortTrend: 55,
    rsiShortMomentum: 45,
    // 極端值搶反彈/見頂門檻:28 / 72 為 4H 波段真實可成交且搭配反轉 K 線確認的超賣/超買門檻
    rsiExtremeOversold: 28,
    rsiExtremeOverbought: 72,
    // 停損百分比:5 代表反向 5% 停損
    stopLossPct: 5,
  },
  paramMeta: [
    { key: 'stFactor', label: 'Supertrend 倍數', description: 'ATR 通道倍數,越大越不敏感', min: 1, max: 6, step: 0.5 },
    { key: 'stPeriod', label: 'Supertrend 週期', description: 'ATR 計算週期', min: 5, max: 20, step: 1 },
    { key: 'rsiPeriod', label: 'RSI 週期', description: 'RSI 計算週期', min: 5, max: 30, step: 1 },
    { key: 'rsiLongTrend', label: '做多 RSI 門檻', description: 'Supertrend 翻多時 RSI 須高於此值', min: 30, max: 60, step: 1 },
    { key: 'rsiShortTrend', label: '做空 RSI 門檻', description: 'Supertrend 翻空時 RSI 須低於此值', min: 40, max: 70, step: 1 },
    { key: 'stopLossPct', label: '停損 %', description: '進場價反向此百分比觸發停損', min: 1, max: 20, step: 0.5 },
  ],

  evaluate(ctx: StrategyContext): StrategyAction {
    const { candles, index, indicators, position, params } = ctx;
    // 需要前一根資料比較趨勢翻轉,index 0 無法評估
    if (index < 1) return { type: 'HOLD' };

    const { dir } = indicators.supertrend(params.stFactor, params.stPeriod);
    const macd = indicators.macd();
    const rsiList = indicators.rsi(params.rsiPeriod);
    const ema50List = indicators.ema(50);

    const currDir = dir[index];
    const prevDir = dir[index - 1];
    const currHist = macd.hist[index];
    const prevHist = macd.hist[index - 1];
    const currMacd = macd.dif[index];
    const currSignal = macd.macd[index];
    const currRsi = rsiList[index];
    const current = candles[index];
    const ema50 = ema50List[index] ?? current.close;

    if (currRsi == null) return { type: 'HOLD' };

    // --- 持倉中:趨勢跟隨出場(停損由引擎判斷) ---
    if (position) {
      if (position.side === 'LONG' && currDir === 1) {
        return { type: 'EXIT', reason: 'Supertrend 翻空,多單趨勢出場' };
      }
      if (position.side === 'SHORT' && currDir === -1) {
        return { type: 'EXIT', reason: 'Supertrend 翻多,空單趨勢出場' };
      }
      return { type: 'HOLD' };
    }

    // 計算前 20 根均量與當根收盤強度，排除縮量騙線與長反向影線
    const volSlice = candles.slice(Math.max(0, index - 20), index);
    const avgVol20 = volSlice.length > 0 ? volSlice.reduce((sum, b) => sum + b.volume, 0) / volSlice.length : current.volume;
    const volumeRatio = avgVol20 > 0 ? current.volume / avgVol20 : 1;
    const range = current.high - current.low;
    const closeStrength = range > 0 ? (current.close - current.low) / range : 0.5;
    const bearishCloseStrength = 1 - closeStrength;

    // --- 空手:六組進場條件(含均線、量能與 K 線實體確認) ---

    // A1. 做多:Supertrend 翻多 + RSI 進入強勢區 + 站穩均線緩衝區 + 帶量收強
    if (currDir === -1 && prevDir === 1 && currRsi > params.rsiLongTrend && currRsi < 75
      && current.close >= ema50 * 0.98 && volumeRatio >= 1.1 && closeStrength >= 0.5) {
      return {
        type: 'ENTRY', side: 'LONG', stopLossPct: params.stopLossPct,
        reason: `【趨勢反轉】Supertrend 翻綠 + RSI ${currRsi.toFixed(2)} 進入強勢區,多頭動能啟動`,
      };
    }
    // A2. 做多:多頭趨勢中 MACD 零軸上方二次金叉 + 位於均線之上
    if (currDir === -1 && currMacd > currSignal && prevHist < 0 && currHist > 0
      && currRsi > params.rsiLongMomentum && currRsi < 72 && current.close >= ema50 && volumeRatio >= 0.9) {
      return {
        type: 'ENTRY', side: 'LONG', stopLossPct: params.stopLossPct,
        reason: `【多頭加倉】趨勢向上且 MACD 零軸上方二次金叉,RSI ${currRsi.toFixed(2)}`,
      };
    }
    // A3. 做多:超賣 + 空頭動能萎縮 + 當根收紅止跌,搶反彈
    if (currRsi <= params.rsiExtremeOversold && currHist > prevHist && current.close > current.open && closeStrength >= 0.55) {
      return {
        type: 'ENTRY', side: 'LONG', stopLossPct: params.stopLossPct,
        reason: `【超跌抄底】RSI ${currRsi.toFixed(2)} 超賣且空頭動能萎縮、收出止跌紅 K,預期反彈`,
      };
    }
    // B1. 做空:Supertrend 翻空 + RSI 轉弱 + 跌破均線緩衝區 + 帶量收弱
    if (currDir === 1 && prevDir === -1 && currRsi < params.rsiShortTrend && currRsi > 25
      && current.close <= ema50 * 1.02 && volumeRatio >= 1.1 && bearishCloseStrength >= 0.5) {
      return {
        type: 'ENTRY', side: 'SHORT', stopLossPct: params.stopLossPct,
        reason: `【趨勢反轉】Supertrend 翻紅 + RSI ${currRsi.toFixed(2)} 轉弱,空頭勢力介入`,
      };
    }
    // B2. 做空:空頭趨勢中 MACD 跌破訊號線且柱狀圖轉負 + 位於均線之下
    if (currDir === 1 && currMacd < currSignal && prevHist > 0 && currHist < 0
      && currRsi < params.rsiShortMomentum && currRsi > 28 && current.close <= ema50 && volumeRatio >= 0.9) {
      return {
        type: 'ENTRY', side: 'SHORT', stopLossPct: params.stopLossPct,
        reason: `【空頭加速】趨勢向下且 MACD 跌破訊號線、動能轉負,RSI ${currRsi.toFixed(2)},跌勢可能擴大`,
      };
    }
    // B3. 做空:超買 + 多頭動能衰退 + 當根收黑轉弱,見頂回調
    if (currRsi >= params.rsiExtremeOverbought && currHist < prevHist && current.close < current.open && bearishCloseStrength >= 0.55) {
      return {
        type: 'ENTRY', side: 'SHORT', stopLossPct: params.stopLossPct,
        reason: `【超買見頂】RSI ${currRsi.toFixed(2)} 過熱且多頭動能衰退、收出轉弱黑 K,預期回調`,
      };
    }

    return { type: 'HOLD' };
  },
};

export default supertrendMomentum;
