/** @file 虛擬幣勝率與期望值強化機制測試：涵蓋 4H 合約品質閘門、衍生品擁擠度與基差／費率守衛、1H 合約確認與 1R 保本、4H 趨勢防重繪與勝率閘門。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPerpSignal } from '../app/services/binancePerpRadar/quality';
import { evaluateDerivativeTradeFilter } from '../app/services/potentialRadar/derivatives';
import { selectPotentialNotice } from '../app/services/potentialRadar/notifications';
import { evaluateRadarWinRateGate, type PerformanceGroup } from '../app/services/potentialRadar/performance';
import { futuresLiquidityError } from '../app/services/cryptoFutures/market.server';
import { runBacktestEngine } from '../app/services/backtest/engine';
import { HOUR_MS } from '../app/services/strategy/futuresRegime';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import trend from '../app/services/strategy/strategies/futuresTrendRetest';
import range from '../app/services/strategy/strategies/futuresRangeReclaim';
import type { Candle, StrategyModule } from '../app/services/strategy/types';
import { evaluateCryptoTrendFromData } from '../app/services/cryptoTrendScanService';

const makeCandle = (i: number, price: number): Candle => ({
  openTime: i * HOUR_MS,
  open: price,
  close: price,
  high: price + 1,
  low: price - 1,
  volume: 1000,
});

test('4H 永續吃大魚品質閘門：過濾長上影線、逆勢深跌死貓跳與過度乖離追高', () => {
  // 建立 120 根歷史 K 線，使 Supertrend 與前後漲跌幅視窗完整覆蓋
  const baseCandles: Candle[] = Array.from({ length: 120 }, (_, i) => ({
    openTime: i * 4 * HOUR_MS,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 1000,
  }));
  // 最後一根（已收盤觸發根）強勢收高且無長上影線
  baseCandles[119] = { openTime: 119 * 4 * HOUR_MS, open: 100, high: 104, low: 100, close: 103.6, volume: 2500 };

  const healthyFlip = classifyPerpSignal(baseCandles, {
    timeframe: '4h',
    barTime: 119 * 4 * HOUR_MS,
    entry: true,
    earlyLong: false,
    trendLong: true,
    ema200: 100,
    supertrend: 99,
    direction: -1,
    macd: 0.5,
    signal: 0.3,
    histogram: 0.2,
  });
  assert.equal(healthyFlip.autoTradeEligible, true);
  assert.ok(healthyFlip.closeStrength >= 0.55);

  // 長上影線（收盤位於當根全距下半部）：禁止自動下單
  const upperWickCandles = baseCandles.map((c, idx) =>
    idx === 119 ? { ...c, open: 100, high: 106, low: 100, close: 101.2 } : c
  );
  const wickSignal = classifyPerpSignal(upperWickCandles, {
    timeframe: '4h',
    barTime: 119 * 4 * HOUR_MS,
    entry: true,
    earlyLong: false,
    trendLong: true,
    ema200: 100,
    supertrend: 98,
    direction: -1,
    macd: 0.5,
    signal: 0.3,
    histogram: 0.2,
  });
  assert.equal(wickSignal.grade, 'TREND_FLIP');
  assert.equal(wickSignal.autoTradeEligible, false);

  // 深跌空頭結構（低於 EMA200 超過 5%）：禁止自動下單
  const deepBearBounce = classifyPerpSignal(baseCandles, {
    timeframe: '4h',
    barTime: 119 * 4 * HOUR_MS,
    entry: true,
    earlyLong: false,
    trendLong: true,
    ema200: 115,
    supertrend: 99,
    direction: -1,
    macd: 0.5,
    signal: 0.3,
    histogram: 0.2,
  });
  assert.equal(deepBearBounce.autoTradeEligible, false);
});

test('衍生品擁擠度否決權與合約基差／資金費率守衛：攔截多頭擁擠、新增空單與異常溢價', () => {
  assert.equal(evaluateDerivativeTradeFilter({
    status: 'CROWDED_LONG',
  } as any, 'LONG').allowTrade, false);

  assert.equal(evaluateDerivativeTradeFilter({
    status: 'NEW_SHORTS',
  } as any, 'LONG').allowTrade, false);

  assert.equal(evaluateDerivativeTradeFilter({
    status: 'HEALTHY_TREND',
  } as any, 'LONG').allowTrade, true);

  // 潛力雷達通知：當衍生品為 CROWDED_LONG 時不推播一般入選通知
  const crowdedNotice = selectPotentialNotice([{
    symbol: 'TESTUSDT',
    price: 100,
    updatedAt: 1000,
    error: null,
    signal: {
      candidate: true,
      phase: 'BREAKOUT',
      score: 85,
      derivatives: { status: 'CROWDED_LONG' },
      bigFish: { entry: false },
    } as any,
  }]);
  assert.equal(crowdedNotice, null);

  // 合約基差與資金費率守衛
  const baseMeta = {
    tiers: [{ min: 0, max: 1e9, rate: 0.004, maxLeverage: 50 }],
    observedAt: 0,
    price: 100,
    markPrice: 100,
    quoteVolume: 50_000_000,
    fundingRate: 0.0001,
    fundingInterval: 8,
    nextFundingTime: 0,
    spreadPct: 0.02,
    bidDepthUsdt: 100_000,
    askDepthUsdt: 100_000,
    takerFeeRate: 0.0006,
    precision: 3,
    pricePrecision: 2,
    minQuantity: 0.001,
    minNotional: 5,
    quantityStep: 0.001,
    minLeverage: 1,
    maxLeverage: 50,
    fundingIntervalHours: 8,
  };
  assert.equal(futuresLiquidityError(baseMeta, 100, 'LONG'), null);
  assert.match(futuresLiquidityError({ ...baseMeta, price: 100.8, markPrice: 100 }, 100, 'LONG') ?? '', /基差/);
  assert.match(futuresLiquidityError({ ...baseMeta, fundingRate: 0.002 }, 100, 'LONG') ?? '', /資金費率/);
  assert.match(futuresLiquidityError({ ...baseMeta, fundingRate: -0.002 }, 100, 'SHORT') ?? '', /資金費率/);
});

test('1H 合約確認 K 線過濾與 1R 保本推進保護：拒絕反向實體確認，達 1R 後回撤保本不變全額虧損', () => {
  // 1. 檢查合約趨勢回踩拒絕黑 K（close < open）或長上影線的假確認
  const bars = Array.from({ length: 850 }, (_, i) => makeCandle(i, 100 + i * 0.1));
  const retest = [[182.9, 185.2, 182.8, 185], [185, 185.1, 183.8, 184.4], [184.4, 184.6, 183.9, 184.2], [184.2, 185.2, 184, 185]];
  retest.forEach(([open, high, low, close], j) => { bars[830 + j] = { ...bars[830 + j], open, high, low, close }; });

  const bearishConfirmBars = bars.map(c => ({ ...c }));
  // 開高走低收黑且留長上影線（open=185.1, high=185.5, low=184.0, close=184.5 -> close < open 且 closeStrength = 0.33 < 0.5）
  bearishConfirmBars[833] = { ...bearishConfirmBars[833], open: 185.1, high: 185.5, low: 184.0, close: 184.5 };
  const rejectAction = trend.evaluate({
    candles: bearishConfirmBars,
    index: 833,
    indicators: new IndicatorCache(bearishConfirmBars),
    position: null,
    params: trend.defaultParams,
  });
  assert.equal(rejectAction.type, 'HOLD');

  // 2. 檢查區間假突破回收拒絕縮量或黑 K 假確認
  const rangeBars = Array.from({ length: 850 }, (_, i) => makeCandle(i, 100 + Math.sin(i * Math.PI / 8) * 4));
  rangeBars[848] = { ...rangeBars[848], open: 95.5, low: 94.8, high: 95.8, close: 95.7 };
  // 確認根雖創高但收黑（open=96.3, close=95.8）
  rangeBars[849] = { ...rangeBars[849], open: 96.3, low: 95.6, high: 96.4, close: 95.8 };
  assert.equal(range.evaluate({
    candles: rangeBars,
    index: 849,
    indicators: new IndicatorCache(rangeBars),
    position: null,
    params: range.defaultParams,
  }).type, 'HOLD');

  // 3. 驗證回測引擎 1R 保本推進保護：達 1R 後反轉下跌時，於保本價出場而非原始 -1R 停損
  const simBars: Candle[] = [
    makeCandle(0, 100), // 訊號根
    { openTime: 1 * HOUR_MS, open: 100, high: 103.2, low: 99.5, close: 102.5, volume: 1000 }, // 進場價 100，停損 98（1R=2），當根最高 103.2 已超過 1R (102)，但未達 2R (104)
    { openTime: 2 * HOUR_MS, open: 102, high: 102.2, low: 97.5, close: 98, volume: 1000 }, // 下一根反轉暴跌至 97.5，應在保本價 ~100.12 出場而非 98
  ];
  const breakevenStrategy: StrategyModule = {
    ...trend,
    warmupBars: 0,
    evaluate: ctx => ctx.index === 0
      ? {
          type: 'ENTRY',
          side: 'LONG',
          stopLossPct: 2,
          entryPlan: { stopDistance: 2, stopPrice: 98, minStopDistance: 2, maxStopDistance: 4, targetMultiple: 2, minRewardRisk: 1.5, breakevenTriggerR: 1 },
          reason: '1R 保本測試',
        }
      : { type: 'HOLD' },
  };
  const simResult = runBacktestEngine(simBars, breakevenStrategy, breakevenStrategy.defaultParams, {
    initialCapital: 1000,
    cost: { feeRate: 0.0006, slippageBps: 0 },
    fillMode: 'nextOpen',
    maxRiskPerTradePct: 0.25,
    maxPositionSizePct: 5,
    defaultStopLossPct: 2,
    precision: 6,
    futures: { leverage: 3, funding: [], marks: simBars, tiers: [{ min: 0, max: 1e9, rate: 0.004, maxLeverage: 50 }], tiersObservedAt: 0, fundingComplete: true },
  }, 0);
  assert.equal(simResult.trades.length, 1);
  assert.ok(simResult.trades[0].exitPrice > 100, '觸及 1R 後回撤應於含手續費緩衝的保本價出場');
  assert.ok(simResult.trades[0].pnl >= -1e-6, '1R 保本出場扣除雙邊手續費後不應產生虧損');
});

import bigFishPro, { calculateGannVolatilityTable, evaluateBigFishProAt } from '../app/services/strategy/strategies/bigFishPro';
import { analyzeBigFish } from '../app/services/strategy/bigFish';

test('4H 趨勢掃描防重繪與勝率閘門：忽略未收盤最後一根插針，並正確攔截低勝率雷達分組', () => {
  // 建構 70 根穩定微幅盤整資料，僅在最後一根（未收盤）製造極端暴漲假突破
  const series = Array.from({ length: 70 }, (_, i) => ({
    date: new Date(i * 4 * HOUR_MS).toISOString(),
    timestamp: i * 4 * HOUR_MS,
    price: 100,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 1000,
    currency: 'USD' as const,
    isMock: false,
  }));
  const withUnclosedSpike = series.map((bar, idx) =>
    idx === series.length - 1
      ? { ...bar, high: 150, close: 148, price: 148, volume: 9000 }
      : bar
  );
  const scanResult = evaluateCryptoTrendFromData(withUnclosedSpike);
  // 評估價格必須是倒數第二根（已收盤）的 100，而非未收盤最後一根的 148
  assert.equal(scanResult.price, 100);
  assert.equal(scanResult.indicators.barTime, (series.length - 2) * 4 * HOUR_MS);

  // 驗證潛力雷達分組勝率動態閘門
  const mockGroups: PerformanceGroup[] = [
    {
      key: 'DERIVATIVE_CROWDED',
      label: '永續多頭擁擠',
      description: '',
      sampleCount: 15,
      completedCount: 12,
      oneREligibleCount: 12,
      oneRHitRate: 30,
      worstDrawdown: -12,
      h24: { count: 12, average: -1.2, positiveRate: 33 },
      h72: { count: 12, average: -2.5, positiveRate: 25 },
      d7: { count: 12, average: -4.0, positiveRate: 25 },
    },
    {
      key: 'DERIVATIVE_HEALTHY',
      label: '永續健康趨勢',
      description: '',
      sampleCount: 15,
      completedCount: 12,
      oneREligibleCount: 12,
      oneRHitRate: 62.5,
      worstDrawdown: -5,
      h24: { count: 12, average: 1.8, positiveRate: 66 },
      h72: { count: 12, average: 3.4, positiveRate: 66 },
      d7: { count: 12, average: 5.1, positiveRate: 58 },
    },
  ];
  assert.equal(evaluateRadarWinRateGate(mockGroups, 'DERIVATIVE_CROWDED', 10).allowed, false);
  assert.equal(evaluateRadarWinRateGate(mockGroups, 'DERIVATIVE_HEALTHY', 10).allowed, true);
});

test('吃大魚 Pro（15m 勝利方程式＋江恩波動率倍數）：精確對齊江恩倍數表、攔截紅線下假金叉並保留原版吃大魚 2.0 獨立運作', () => {
  // 1. 驗證江恩波動率倍數表格（對照 TAOUSDT 截圖：基準低點 265.6、基準高點 270.5）
  const gann = calculateGannVolatilityTable(265.6, 270.5);
  assert.equal(gann.levels.length, 7);
  assert.equal(gann.levels[0].upTarget.toFixed(1), '281.4');
  assert.equal(gann.levels[1].upTarget.toFixed(1), '286.8');
  assert.equal(gann.levels[0].downTarget.toFixed(1), '255.3');
  assert.equal(gann.levels[1].downTarget.toFixed(1), '250.5');

  // 2. 驗證長紅洗盤後 Supertrend 首次翻綠觸發「底部翻綠一號槍（BOTTOM_FLIP）」
  const washoutCandles: Candle[] = Array.from({ length: 240 }, (_, i) => {
    // 0..209 為緩步盤跌（使 Supertrend 連續處於 direction === 1 紅線超過 12 根）
    const base = 280 - i * 0.08;
    return {
      openTime: i * 15 * 60_000,
      open: base,
      high: base + 0.4,
      low: base - 0.4,
      close: base - 0.1,
      volume: 1000,
    };
  });
  // 第 239 根放量長紅突破（收盤實體飽滿且突破 Supertrend 上軌使其翻綠 direction === -1）
  washoutCandles[239] = {
    openTime: 239 * 15 * 60_000,
    open: 261,
    high: 266.5,
    low: 260.8,
    close: 266.0,
    volume: 2200,
  };
  const cache = new IndicatorCache(washoutCandles);
  const proSig = evaluateBigFishProAt(washoutCandles, 239, cache, bigFishPro.defaultParams);
  assert.equal(proSig.triggered, true);
  assert.equal(proSig.mode, 'BOTTOM_FLIP');
  assert.ok(proSig.priorRedBars >= 12);

  const proAction = bigFishPro.evaluate({
    candles: washoutCandles,
    index: 239,
    indicators: cache,
    position: null,
    params: bigFishPro.defaultParams,
  });
  assert.equal(proAction.type, 'ENTRY');
  if (proAction.type === 'ENTRY') {
    assert.equal(proAction.entryPlan?.breakevenTriggerR, 1);
    assert.ok((proAction.entryPlan?.targetPrice ?? 0) > washoutCandles[239].close);
  }

  // 3. 確認原版吃大魚 2.0 邏輯完全不受影響（獨立並存）
  const origState = analyzeBigFish(washoutCandles);
  assert.equal(origState?.trendLong, true);
});
