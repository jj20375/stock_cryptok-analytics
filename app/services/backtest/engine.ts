/** @file 逐根回測與圖表重放共用引擎；模擬成交及持倉，不下單或寫入資料庫。 */
/**
 * 【詳細繁體中文註解】：回測引擎核心 — 逐根 K 線重放
 *
 * 每根 K 線的處理順序(順序本身就是模擬假設,更動會改變回測結果):
 *   1. 執行上一根排入的待成交動作(fillMode='nextOpen' 時,訊號在下一根「開盤價」成交,嚴防前視)
 *   2. 持倉中先檢查停損:用當根 high/low 模擬「盤中觸價」
 *        LONG:low <= 停損價 → 成交價 = min(開盤價, 停損價)(開盤跳空低於停損時以開盤價成交,模擬跳空滑價)
 *        SHORT:high >= 停損價 → 成交價 = max(開盤價, 停損價)
 *   3. 呼叫策略 evaluate(index = 當根):
 *        fillMode='close'   → 當根收盤價立即成交(對齊 live 引擎市價單行為)
 *        fillMode='nextOpen'→ 排入下一根執行(預設,較保守且無前視爭議)
 *   4. 以收盤價計算當根權益(現金 + 持倉市值)
 *
 * 保守假設(報告中須揭露):
 *   - 同一根 K 線同時滿足「停損」與「策略出場」時,一律視為停損先觸發(較差的價格)。
 *   - SHORT 為回測模擬(現貨實盤不支援做空);空單以「不佔用本金的保證金簡化模型」計算,
 *     權益 = 現金 + (進場價 - 現價) × 數量,未模擬融資利息與強平。
 *   - 回測結束時若仍有持倉,以最後一根收盤價強制平倉(標記 exitReason)。
 *
 * 倉位計算重用 positionSizing.calculateRiskBasedPosition(與 live 引擎同一套風險式倉位),
 * 本金基底採「當前權益」(複利模式)。
 */

import type { Candle, OpenPositionState, StrategyModule, StrategyEntryPlan, StrategyAction } from '../strategy/types';
import { IndicatorCache } from '../strategy/indicatorCache';
import { calculateRiskBasedPosition } from '../positionSizing';
import { applySlippage, calculateFee, type CostModel } from './costs';
import { resolveEntryRisk } from './entryExecution';
import { futuresEntryRisk, futuresLeverageForStop, knownFundingBudget, liquidationEstimate, type FuturesSimulation } from './futures';
import { futuresFundingHours } from '../cryptoFutures/automation';
import { HOUR_MS, futuresRegime, type FuturesPhase } from '../strategy/futuresRegime';

/** 成交模式:nextOpen = 訊號下一根開盤成交(預設);close = 訊號當根收盤成交 */
export type FillMode = 'nextOpen' | 'close';

export interface EngineConfig {
  /** 初始資金，與標的報價同幣別（如 USDT／USD／TWD），不模擬匯率兌換。 */
  initialCapital: number;
  /** 成本模型(手續費 + 滑價) */
  cost: CostModel;
  fillMode: FillMode;
  /** 單筆風險佔本金 %(倉位計算用,與 users.maxRiskPerTradePct 同義) */
  maxRiskPerTradePct: number;
  /** 最大倉位佔本金 %(與 users.maxPositionSizePct 同義) */
  maxPositionSizePct: number;
  /** 預設停損 %:策略未宣告 stopLossPct 時使用(與 users.riskStopLossPct 同義) */
  defaultStopLossPct: number;
  /** 下單數量小數位數 */
  precision: number;
  /** 圖表不以資料結尾假造平倉；回測預設仍強制結算。 */
  closeAtEnd?: boolean;
  /** 圖表才收集逐筆成交／取消事件，回測績效路徑不增加事件記憶體。 */
  captureEvents?: boolean;
  /** 存在時改用永續逐倉資金模型；舊回測缺值仍完全沿用原有行為。 */
  futures?: FuturesSimulation;
}

export interface EngineEvent {
  type: 'ENTRY' | 'EXIT' | 'WARNING';
  side: 'LONG' | 'SHORT';
  timestamp: number;
  price: number;
  reason: string;
  signalTime: number;
  stopLossPrice?: number;
  targetPrice?: number;
  cancelled?: boolean;
}

/** 單筆已完成(或強制平倉)交易 */
export interface BacktestTradeRecord {
  side: 'LONG' | 'SHORT';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  /** 進出雙邊手續費合計 */
  fee: number;
  /** 已扣除手續費的淨損益 */
  pnl: number;
  /** 淨損益 / 進場名目金額 */
  pnlPct: number;
  holdingBars: number;
  entryReason: string;
  exitReason: string;
  fundingPnl?: number;
  initialMargin?: number;
}

/** 權益曲線單點(每根 K 線一點,downsample 交給 metrics) */
export interface EquityPoint {
  time: number;
  equity: number;
}

export interface EngineResult {
  trades: BacktestTradeRecord[];
  equityCurve: EquityPoint[];
  /** 實際開始評估的索引(暖機之後),供績效年化與除錯 */
  firstEvaluatedIndex: number;
  events: EngineEvent[];
  /** 最後一根已確認、但尚無下一根開盤可成交的訊號，圖表須標成等待。 */
  pendingSignal: EngineEvent | null;
  /** 只計算研究區間；未成立條件按空手根統計，取消按候選委託統計，不混成勝率。 */
  entryDiagnostics?: { evaluatedBars: number; signals: number; filled: number; cancelled: number; pending: number;
    phases: Record<FuturesPhase, number>; filters: Record<string, number>; rejections: Record<string, number> };
  /**
   * 一般（非合約）回測：空手時策略回傳 HOLD 的原因次數，只統計研究區間。
   * 用來回答「為什麼 0 筆成交」（例如 1h→4h 策略的 ATR 波動下限把 BTC 全部濾掉），不影響任何成交計算。
   */
  noEntryReasons?: Record<string, number>;
}

/** 未進場原因最多保留的種類數；含動態數字的原因若超過上限，其餘併入「其他原因」，避免結果 JSON 膨脹 */
const MAX_NO_ENTRY_REASON_KINDS = 20;

/** 待成交動作(fillMode='nextOpen' 時暫存到下一根執行) */
type PendingOrder =
  | { kind: 'ENTRY'; action: Extract<StrategyAction, { type: 'ENTRY' }>; signalTime: number }
  | { kind: 'EXIT'; reason: string; signalTime: number };

/**
 * 執行回測。
 * @param candles   完整 K 線序列(含暖機段,依 openTime 升冪)
 * @param strategy  策略模組(純函式,與 live 引擎共用同一份)
 * @param params    策略參數(已與 defaultParams 合併)
 * @param config    引擎設定
 * @param tradeStartTime 允許開始交易的時間(毫秒 UTC):暖機段之前的資料只算指標、不交易
 */
export const runBacktestEngine = (
  candles: Candle[],
  strategy: StrategyModule,
  params: Record<string, number>,
  config: EngineConfig,
  tradeStartTime: number,
  sharedIndicators?: IndicatorCache
): EngineResult => {
  if (strategy.requiresNextOpen && config.fillMode !== 'nextOpen') throw new Error('此策略需下一根開盤成交，不能使用當根收盤模式');
  if (strategy.futuresOnly && !config.futures) throw new Error('合約專用策略需 USDT 永續行情與合約資金模型');
  if (config.futures && !config.futures.fundingComplete) throw new Error('資金費率覆蓋不足，不能宣告完整合約回測');
  const indicators = sharedIndicators ?? new IndicatorCache(candles);
  const trades: BacktestTradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];
  const events: EngineEvent[] = [];
  /** 一般回測的空手 HOLD 原因統計（見 EngineResult.noEntryReasons） */
  const noEntryReasons: Record<string, number> = {};
  const entryDiagnostics: NonNullable<EngineResult['entryDiagnostics']> = { evaluatedBars: 0, signals: 0, filled: 0, cancelled: 0, pending: 0,
    phases: { UP: 0, DOWN: 0, RANGE: 0, WAIT: 0, SHOCK: 0 }, filters: {}, rejections: {} };
  const recordEvent = (event: EngineEvent) => {
    if (config.futures && event.type === 'ENTRY') entryDiagnostics.filled++;
    if (config.futures && event.cancelled) {
      entryDiagnostics.cancelled++;
      entryDiagnostics.rejections[event.reason] = (entryDiagnostics.rejections[event.reason] ?? 0) + 1;
    }
    if (config.captureEvents) events.push(event);
  };

  let cash = config.initialCapital;
  let position: OpenPositionState | null = null;
  let positionEntryFee = 0;
  let positionEntryReason = '';
  let pending: PendingOrder | null = null;
  let positionFunding = 0, initialMargin = 0, lossStreak = 0, cooldownUntil = 0;
  const dailyPnl = new Map<string, number>();
  const dayKey = (time: number) => new Date(time + 8 * HOUR_MS).toISOString().slice(0, 10);
  const marks = new Map(config.futures?.marks.map(c => [c.openTime, c]) ?? []);
  const funding = [...(config.futures?.funding ?? [])].sort((a, b) => a.time - b.time);
  let fundingIndex = 0;

  // 找出第一個「暖機足夠且進入回測區間」的索引
  let firstEvaluatedIndex = -1;

  /** 目前權益(以指定價格評價持倉) */
  const equityAt = (price: number): number => {
    if (!position) return cash;
    if (config.futures) return cash + (position.side === 'LONG' ? price - position.entryPrice : position.entryPrice - price) * position.quantity;
    if (position.side === 'LONG') return cash + position.quantity * price;
    // SHORT 簡化模型:現金未扣除,權益 = 現金 + 未實現損益
    return cash + (position.entryPrice - price) * position.quantity;
  };

  /** 開倉:fillPrice 為套用滑價後成交價 */
  const openPosition = (
    side: 'LONG' | 'SHORT',
    fillPrice: number,
    stopLossPct: number,
    reason: string,
    time: number,
    index: number,
    entryPlan?: StrategyEntryPlan,
    signalTime = time
  ) => {
    if (config.futures?.direction && config.futures.direction !== 'BOTH' && side !== config.futures.direction) {
      recordEvent({ type: 'WARNING', side, timestamp: time, signalTime, price: fillPrice, cancelled: true, reason: '進場取消：交易方向設定不允許' }); return;
    }
    if (config.futures && (time < cooldownUntil || (dailyPnl.get(dayKey(time)) ?? 0) <= -config.initialCapital * 0.01)) {
      recordEvent({ type: 'WARNING', side, timestamp: time, signalTime, price: fillPrice, cancelled: true, reason: '進場取消：台北日內虧損達 1% 或連虧冷卻中' });
      return;
    }
    const risk = resolveEntryRisk(side, fillPrice, stopLossPct, entryPlan, config.cost);
    if ('error' in risk) {
      recordEvent({ type: 'WARNING', side, timestamp: time, signalTime, price: fillPrice, cancelled: true, reason: `進場取消：${risk.error}` });
      return;
    }
    // 倉位計算與 live 引擎同一套(風險式倉位),本金基底 = 當前權益(複利)
    const sizing = calculateRiskBasedPosition({
      capitalBaseUsdt: equityAt(fillPrice),
      currentPrice: fillPrice,
      maxPositionSizePct: config.maxPositionSizePct,
      maxRiskPerTradePct: config.maxRiskPerTradePct,
      precision: config.precision,
      stopLossPct: risk.stopLossPct,
    });
    // 倉位過小(低於最小下單額)時放棄本次進場
    if (sizing.reason || sizing.quantity <= 0) {
      recordEvent({ type: 'WARNING', side, timestamp: time, signalTime, price: fillPrice, cancelled: true, reason: `進場取消：${sizing.reason ?? '倉位過小'}` });
      return;
    }

    /** 100% 部位仍須留出 BUY 手續費，不能讓模擬現貨帳戶透支；數量向下捨入以免超額。 */
    const scale = 10 ** config.precision;
    const affordableQuantity = Math.floor(cash / (fillPrice * (1 + config.cost.feeRate)) * scale) / scale;
    const fRisk = config.futures ? futuresEntryRisk(side, fillPrice, entryPlan, config.cost, equityAt(fillPrice),
      config.maxRiskPerTradePct, config.maxPositionSizePct, config.precision, config.futures.leverage,
      knownFundingBudget(funding, time - 1, side, futuresFundingHours(strategy.id, params)), stopLossPct) : null;
    if (fRisk && 'error' in fRisk) {
      recordEvent({ type: 'WARNING', side, timestamp: time, signalTime, price: fillPrice, cancelled: true, reason: `進場取消：${fRisk.error}` }); return;
    }
    let quantity = fRisk && 'quantity' in fRisk ? fRisk.quantity : side === 'LONG' ? Math.min(sizing.quantity, affordableQuantity) : sizing.quantity;
    if (config.futures?.quantityStep) quantity = Math.floor(quantity / config.futures.quantityStep + 1e-9) * config.futures.quantityStep;
    if (config.futures && (quantity < (config.futures.minQuantity ?? 0) || quantity * fillPrice < (config.futures.minNotional ?? 0))) {
      recordEvent({ type: 'WARNING', side, timestamp: time, signalTime, price: fillPrice, cancelled: true, reason: '進場取消：風險倉位低於合約最小下單限制' }); return;
    }
    if (quantity <= 0) {
      recordEvent({ type: 'WARNING', side, timestamp: time, signalTime, price: fillPrice, cancelled: true, reason: '進場取消：合約數量捨入後不足' }); return;
    }

    const fee = calculateFee(fillPrice, quantity, config.cost, side === 'LONG' ? 'BUY' : 'SELL');
    // 停損價:LONG 往下、SHORT 往上
    const stopLossPrice = risk.stopLossPrice;

    if (fRisk && 'quantity' in fRisk) {
      const leverage = futuresLeverageForStop(side, fillPrice, quantity, stopLossPrice, config.cost.feeRate,
        config.futures!.tiers, config.futures!.leverage, config.futures!.minLeverage ?? 1);
      if ('error' in leverage) {
        recordEvent({ type: 'WARNING', side, timestamp: time, signalTime, price: fillPrice, cancelled: true, reason: `進場取消：${leverage.error}` }); return;
      }
      initialMargin = leverage.margin;
      entryPlan = entryPlan ? { ...entryPlan, targetPrice: fRisk.targetPrice } : undefined;
    }

    if (config.futures) {
      cash -= fee;
      dailyPnl.set(dayKey(time), (dailyPnl.get(dayKey(time)) ?? 0) - fee);
    } else if (side === 'LONG') {
      cash -= quantity * fillPrice + fee;
    } else {
      // SHORT 簡化模型:不動用現金,只扣手續費
      cash -= fee;
    }

    position = {
      side,
      entryPrice: fillPrice,
      quantity,
      stopLossPrice,
      entryTime: time,
      entryIndex: index,
      entryPlan,
    };
    positionEntryFee = fee;
    positionEntryReason = reason;
    positionFunding = 0;
    recordEvent({ type: 'ENTRY', side, timestamp: time, signalTime, price: fillPrice, reason, stopLossPrice, targetPrice: entryPlan?.targetPrice });
  };

  /** 平倉:fillPrice 為套用滑價後成交價 */
  const closePosition = (fillPrice: number, reason: string, time: number, index: number, signalTime = time) => {
    if (!position) return;
    const exitFee = calculateFee(fillPrice, position.quantity, config.cost, position.side === 'LONG' ? 'SELL' : 'BUY');
    let grossPnl =
      position.side === 'LONG'
        ? (fillPrice - position.entryPrice) * position.quantity
        : (position.entryPrice - fillPrice) * position.quantity;
    /** 逐倉壓力強平最多耗用該筆配置保證金及費用，不將未配置資金當成全倉抵押。 */
    if (config.futures && reason.includes('模型強平')) grossPnl = Math.max(grossPnl, -initialMargin - positionFunding);
    const totalFee = positionEntryFee + exitFee;
    const netPnl = grossPnl - totalFee + positionFunding;
    const entryNotional = position.entryPrice * position.quantity;

    if (config.futures) {
      cash += grossPnl - exitFee;
      dailyPnl.set(dayKey(time), (dailyPnl.get(dayKey(time)) ?? 0) + grossPnl - exitFee);
      lossStreak = netPnl < 0 ? lossStreak + 1 : 0;
      if (lossStreak >= 3) { cooldownUntil = time + 6 * HOUR_MS; lossStreak = 0; }
    } else if (position.side === 'LONG') {
      cash += position.quantity * fillPrice - exitFee;
    } else {
      cash += grossPnl - exitFee;
    }

    trades.push({
      side: position.side,
      entryTime: position.entryTime,
      exitTime: time,
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      quantity: position.quantity,
      fee: totalFee,
      pnl: netPnl,
      pnlPct: entryNotional > 0 ? (netPnl / entryNotional) * 100 : 0,
      holdingBars: position.entryIndex != null ? index - position.entryIndex : 0,
      entryReason: positionEntryReason,
      exitReason: reason,
      ...(config.futures ? { fundingPnl: positionFunding, initialMargin } : {}),
    });

    recordEvent({ type: 'EXIT', side: position.side, timestamp: time, signalTime, price: fillPrice, reason });
    position = null;
    positionEntryFee = 0;
    positionEntryReason = '';
  };

  const warmupBars = strategy.warmupBarsForParams?.(params) ?? strategy.warmupBars;
  for (let i = warmupBars; i < candles.length; i++) {
    const candle = candles[i];
    const inTradeWindow = candle.openTime >= tradeStartTime;
    /** 整點結算先於同時刻平倉，該整點才建立的新倉不支付前一期資金費率；不假定八小時。 */
    while (fundingIndex < funding.length && funding[fundingIndex].time <= candle.openTime) {
      const point = funding[fundingIndex++];
      if (position && point.time > (position as OpenPositionState).entryTime) {
        const held = position as OpenPositionState, settlementMark = marks.get(point.time)?.open ?? candles[Math.max(0, i - 1)].close;
        const pnl = held.quantity * settlementMark * point.rate * (held.side === 'LONG' ? -1 : 1);
        cash += pnl; positionFunding += pnl;
        dailyPnl.set(dayKey(point.time), (dailyPnl.get(dayKey(point.time)) ?? 0) + pnl);
      }
    }

    if (inTradeWindow && firstEvaluatedIndex === -1) {
      firstEvaluatedIndex = i;
    }

    // 1) 執行上一根排入的待成交動作(以當根開盤價成交)
    if (pending && inTradeWindow) {
      if (pending.kind === 'ENTRY' && !position) {
        const { action } = pending;
        const fillPrice = applySlippage(
          candle.open,
          action.side === 'LONG' ? 'BUY' : 'SELL',
          config.cost
        );
        openPosition(action.side, fillPrice, action.stopLossPct ?? config.defaultStopLossPct, action.reason,
          candle.openTime, i, action.entryPlan, pending.signalTime);
      } else if (pending.kind === 'EXIT' && position) {
        const fillPrice = applySlippage(
          candle.open,
          (position as OpenPositionState).side === 'LONG' ? 'SELL' : 'BUY',
          config.cost
        );
        closePosition(fillPrice, pending.reason, candle.openTime, i, pending.signalTime);
      }
      pending = null;
    }

    // 2) 停損檢查(盤中觸價模擬;保守假設:停損優先於任何策略出場訊號)
    if (position && config.futures) {
      const pos = position as OpenPositionState, mark = marks.get(candle.openTime);
      const liquidation = liquidationEstimate(pos.side, pos.entryPrice, pos.quantity, initialMargin, positionFunding, config.cost.feeRate, config.futures.tiers);
      /** 小時 K 無法辨識先後：同根模型強平／停損採強平先發生的壓力情境，禁止樂觀宣告。 */
      if (mark && liquidation != null && (pos.side === 'LONG' ? mark.low <= liquidation : mark.high >= liquidation)) {
        const adverse = pos.side === 'LONG' ? Math.min(candle.open, candle.low, liquidation) : Math.max(candle.open, candle.high, liquidation);
        closePosition(applySlippage(adverse, pos.side === 'LONG' ? 'SELL' : 'BUY', config.cost), '目前級距模型強平壓力情境（非歷史真實強平）', candle.openTime, i);
      }
    }
    if (position) {
      const pos = position as OpenPositionState;
      /** 原生合約停損由標記價觸發；基差使停損價超出成交價範圍時取最近範圍端點，不假造精確 tick。 */
      const stopCandle = config.futures ? marks.get(candle.openTime) ?? candle : candle;
      if (pos.stopLossPrice != null) {
        if (pos.side === 'LONG' && stopCandle.low <= pos.stopLossPrice) {
          // 開盤已跳空低於停損 → 以開盤價成交(模擬跳空損失),否則以停損價成交
          const triggerPrice = config.futures ? Math.max(candle.low, Math.min(candle.high, candle.open, pos.stopLossPrice)) : Math.min(candle.open, pos.stopLossPrice);
          const fillPrice = applySlippage(triggerPrice, 'SELL', config.cost);
          closePosition(fillPrice, '觸及停損價,停損保護出場', candle.openTime, i);
        } else if (pos.side === 'SHORT' && stopCandle.high >= pos.stopLossPrice) {
          const triggerPrice = config.futures ? Math.min(candle.high, Math.max(candle.low, candle.open, pos.stopLossPrice)) : Math.max(candle.open, pos.stopLossPrice);
          const fillPrice = applySlippage(triggerPrice, 'BUY', config.cost);
          closePosition(fillPrice, '觸及停損價,停損保護出場', candle.openTime, i);
        }
      }
    }

    if (position && config.futures) {
      const pos = position as OpenPositionState, target = pos.entryPlan?.targetPrice;
      const targetCandle = marks.get(candle.openTime) ?? candle;
      if (target != null && (pos.side === 'LONG' ? targetCandle.high >= target : targetCandle.low <= target)) {
        /** 停損已先檢查；基差／跳空時目標限定在當根成交範圍，不使用不存在的成交價。 */
        const targetFill = Math.max(candle.low, Math.min(candle.high, target));
        closePosition(applySlippage(targetFill, pos.side === 'LONG' ? 'SELL' : 'BUY', config.cost), '合約固定目標出場（標記價觸發／成交範圍估算）', candle.openTime, i);
      }
    }

    if (position) {
      const pos = position as OpenPositionState;
      const triggerR = pos.entryPlan?.breakevenTriggerR;
      const excursionCandle = config.futures ? marks.get(candle.openTime) ?? candle : candle;
      if (triggerR != null && triggerR > 0 && pos.stopLossPrice != null) {
        /**
         * 1R 保本推進保護：僅在當根未觸及原始停損與固定目標後才檢查；
         * 一旦當根有利極值達 triggerR 倍初始價格風險，下一根起將停損移至含雙邊手續費緩衝的保本價，
         * 避免同根先假設觸及 1R 再保本的前視偏差，同時杜絕獲利單反轉變成全額 1R 虧損。
         */
        if (pos.side === 'LONG' && pos.stopLossPrice < pos.entryPrice) {
          const initialRisk = pos.entryPrice - pos.stopLossPrice;
          if (excursionCandle.high >= pos.entryPrice + initialRisk * triggerR) {
            const feeRate = config.cost.feeRate;
            pos.stopLossPrice = Math.max(pos.stopLossPrice, pos.entryPrice * (1 + feeRate) / Math.max(1e-6, 1 - feeRate));
          }
        } else if (pos.side === 'SHORT' && pos.stopLossPrice > pos.entryPrice) {
          const initialRisk = pos.stopLossPrice - pos.entryPrice;
          if (excursionCandle.low <= pos.entryPrice - initialRisk * triggerR) {
            const feeRate = config.cost.feeRate;
            pos.stopLossPrice = Math.min(pos.stopLossPrice, pos.entryPrice * (1 - feeRate) / (1 + feeRate));
          }
        }
      }
    }

    // 3) 策略評估(嚴禁前視:evaluate 只能讀 index 及之前的資料)
    if (inTradeWindow) {
      const context = {
        candles,
        index: i,
        indicators,
        position,
        params,
      };
      if (config.futures) {
        entryDiagnostics.evaluatedBars++;
        entryDiagnostics.phases[strategy.id === 'futures_big_fish' ? (indicators.bigFish().direction[i] === -1 ? 'UP' : 'DOWN') : futuresRegime(context).phase]++;
      }
      const action = strategy.evaluate(context);
      if (config.futures && !position && action.type === 'HOLD') {
        const reason = action.reason ?? '策略條件尚未成立';
        entryDiagnostics.filters[reason] = (entryDiagnostics.filters[reason] ?? 0) + 1;
      } else if (!config.futures && !position && action.type === 'HOLD') {
        const raw = action.reason ?? '策略條件尚未成立';
        const reason = raw in noEntryReasons || Object.keys(noEntryReasons).length < MAX_NO_ENTRY_REASON_KINDS ? raw : '其他原因';
        noEntryReasons[reason] = (noEntryReasons[reason] ?? 0) + 1;
      }

      if (action.type === 'ENTRY' && !position) {
        if (config.futures) entryDiagnostics.signals++;
        const stopLossPct = action.stopLossPct ?? config.defaultStopLossPct;
        if (config.fillMode === 'close') {
          const fillPrice = applySlippage(
            candle.close,
            action.side === 'LONG' ? 'BUY' : 'SELL',
            config.cost
          );
          openPosition(action.side, fillPrice, stopLossPct, action.reason, candle.openTime, i, action.entryPlan);
        } else {
          pending = { kind: 'ENTRY', action, signalTime: candle.openTime };
        }
      } else if (action.type === 'EXIT' && position) {
        if (config.fillMode === 'close') {
          const fillPrice = applySlippage(
            candle.close,
            (position as OpenPositionState).side === 'LONG' ? 'SELL' : 'BUY',
            config.cost
          );
          closePosition(fillPrice, action.reason, candle.openTime, i);
        } else {
          pending = { kind: 'EXIT', reason: action.reason, signalTime: candle.openTime };
        }
      }
    }

    // 4) 當根收盤權益
    if (inTradeWindow) {
      /** 永續未實現損益以標記價評價；實際進出損益仍使用成交價，不把兩種序列混算。 */
      const valuationPrice = config.futures ? marks.get(candle.openTime)?.close ?? candle.close : candle.close;
      equityCurve.push({ time: candle.openTime, equity: equityAt(valuationPrice) });
    }
  }

  // 回測結束仍有持倉 → 以最後一根收盤價強制平倉(揭露用途,避免未實現損益被忽略)
  if (config.closeAtEnd !== false && position && candles.length > 0) {
    const lastIndex = candles.length - 1;
    const lastCandle = candles[lastIndex];
    const fillPrice = applySlippage(
      lastCandle.close,
      (position as OpenPositionState).side === 'LONG' ? 'SELL' : 'BUY',
      config.cost
    );
    closePosition(fillPrice, '回測結束強制平倉', lastCandle.openTime, lastIndex);
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = { time: lastCandle.openTime, equity: cash };
    }
  }

  const waiting = (config.closeAtEnd === false ? pending : null) as PendingOrder | null;
  const pendingSignal: EngineEvent | null = waiting && candles.length > 0 ? {
    type: 'WARNING', side: waiting.kind === 'ENTRY' ? waiting.action.side : (position as OpenPositionState | null)?.side ?? 'LONG',
    timestamp: waiting.signalTime, signalTime: waiting.signalTime, price: candles.at(-1)!.close,
    reason: `${waiting.kind === 'ENTRY' ? '進場' : '平倉'}待下一根開盤確認：${waiting.kind === 'ENTRY' ? waiting.action.reason : waiting.reason}`,
  } : null;
  entryDiagnostics.pending = pending?.kind === 'ENTRY' ? 1 : 0;
  return { trades, equityCurve, firstEvaluatedIndex, events, pendingSignal, ...(config.futures ? { entryDiagnostics } : { noEntryReasons }) };
};
