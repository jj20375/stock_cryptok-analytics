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

import type { Candle, OpenPositionState, StrategyModule } from '../strategy/types';
import { IndicatorCache } from '../strategy/indicatorCache';
import { calculateRiskBasedPosition } from '../positionSizing';
import { applySlippage, calculateFee, type CostModel } from './costs';

/** 成交模式:nextOpen = 訊號下一根開盤成交(預設);close = 訊號當根收盤成交 */
export type FillMode = 'nextOpen' | 'close';

export interface EngineConfig {
  /** 初始資金(USDT 或 USD) */
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
}

/** 待成交動作(fillMode='nextOpen' 時暫存到下一根執行) */
type PendingOrder =
  | { kind: 'ENTRY'; side: 'LONG' | 'SHORT'; stopLossPct: number; reason: string }
  | { kind: 'EXIT'; reason: string };

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
  tradeStartTime: number
): EngineResult => {
  const indicators = new IndicatorCache(candles);
  const trades: BacktestTradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];

  let cash = config.initialCapital;
  let position: OpenPositionState | null = null;
  let positionEntryFee = 0;
  let positionEntryReason = '';
  let pending: PendingOrder | null = null;

  // 找出第一個「暖機足夠且進入回測區間」的索引
  let firstEvaluatedIndex = -1;

  /** 目前權益(以指定價格評價持倉) */
  const equityAt = (price: number): number => {
    if (!position) return cash;
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
    index: number
  ) => {
    // 倉位計算與 live 引擎同一套(風險式倉位),本金基底 = 當前權益(複利)
    const sizing = calculateRiskBasedPosition({
      capitalBaseUsdt: equityAt(fillPrice),
      currentPrice: fillPrice,
      maxPositionSizePct: config.maxPositionSizePct,
      maxRiskPerTradePct: config.maxRiskPerTradePct,
      precision: config.precision,
      stopLossPct,
    });
    // 倉位過小(低於最小下單額)時放棄本次進場
    if (sizing.reason || sizing.quantity <= 0) return;

    const fee = calculateFee(fillPrice, sizing.quantity, config.cost);
    // 停損價:LONG 往下、SHORT 往上
    const stopLossPrice =
      side === 'LONG'
        ? fillPrice * (1 - stopLossPct / 100)
        : fillPrice * (1 + stopLossPct / 100);

    if (side === 'LONG') {
      cash -= sizing.quantity * fillPrice + fee;
    } else {
      // SHORT 簡化模型:不動用現金,只扣手續費
      cash -= fee;
    }

    position = {
      side,
      entryPrice: fillPrice,
      quantity: sizing.quantity,
      stopLossPrice,
      entryTime: time,
      entryIndex: index,
    };
    positionEntryFee = fee;
    positionEntryReason = reason;
  };

  /** 平倉:fillPrice 為套用滑價後成交價 */
  const closePosition = (fillPrice: number, reason: string, time: number, index: number) => {
    if (!position) return;
    const exitFee = calculateFee(fillPrice, position.quantity, config.cost);
    const grossPnl =
      position.side === 'LONG'
        ? (fillPrice - position.entryPrice) * position.quantity
        : (position.entryPrice - fillPrice) * position.quantity;
    const totalFee = positionEntryFee + exitFee;
    const netPnl = grossPnl - totalFee;
    const entryNotional = position.entryPrice * position.quantity;

    if (position.side === 'LONG') {
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
    });

    position = null;
    positionEntryFee = 0;
    positionEntryReason = '';
  };

  for (let i = strategy.warmupBars; i < candles.length; i++) {
    const candle = candles[i];
    const inTradeWindow = candle.openTime >= tradeStartTime;

    if (inTradeWindow && firstEvaluatedIndex === -1) {
      firstEvaluatedIndex = i;
    }

    // 1) 執行上一根排入的待成交動作(以當根開盤價成交)
    if (pending && inTradeWindow) {
      if (pending.kind === 'ENTRY' && !position) {
        const fillPrice = applySlippage(
          candle.open,
          pending.side === 'LONG' ? 'BUY' : 'SELL',
          config.cost
        );
        openPosition(pending.side, fillPrice, pending.stopLossPct, pending.reason, candle.openTime, i);
      } else if (pending.kind === 'EXIT' && position) {
        const fillPrice = applySlippage(
          candle.open,
          (position as OpenPositionState).side === 'LONG' ? 'SELL' : 'BUY',
          config.cost
        );
        closePosition(fillPrice, pending.reason, candle.openTime, i);
      }
      pending = null;
    }

    // 2) 停損檢查(盤中觸價模擬;保守假設:停損優先於任何策略出場訊號)
    if (position) {
      const pos = position as OpenPositionState;
      if (pos.stopLossPrice != null) {
        if (pos.side === 'LONG' && candle.low <= pos.stopLossPrice) {
          // 開盤已跳空低於停損 → 以開盤價成交(模擬跳空損失),否則以停損價成交
          const triggerPrice = Math.min(candle.open, pos.stopLossPrice);
          const fillPrice = applySlippage(triggerPrice, 'SELL', config.cost);
          closePosition(fillPrice, '觸及停損價,停損保護出場', candle.openTime, i);
        } else if (pos.side === 'SHORT' && candle.high >= pos.stopLossPrice) {
          const triggerPrice = Math.max(candle.open, pos.stopLossPrice);
          const fillPrice = applySlippage(triggerPrice, 'BUY', config.cost);
          closePosition(fillPrice, '觸及停損價,停損保護出場', candle.openTime, i);
        }
      }
    }

    // 3) 策略評估(嚴禁前視:evaluate 只能讀 index 及之前的資料)
    if (inTradeWindow) {
      const action = strategy.evaluate({
        candles,
        index: i,
        indicators,
        position,
        params,
      });

      if (action.type === 'ENTRY' && !position) {
        const stopLossPct = action.stopLossPct ?? config.defaultStopLossPct;
        if (config.fillMode === 'close') {
          const fillPrice = applySlippage(
            candle.close,
            action.side === 'LONG' ? 'BUY' : 'SELL',
            config.cost
          );
          openPosition(action.side, fillPrice, stopLossPct, action.reason, candle.openTime, i);
        } else {
          pending = { kind: 'ENTRY', side: action.side, stopLossPct, reason: action.reason };
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
          pending = { kind: 'EXIT', reason: action.reason };
        }
      }
    }

    // 4) 當根收盤權益
    if (inTradeWindow) {
      equityCurve.push({ time: candle.openTime, equity: equityAt(candle.close) });
    }
  }

  // 回測結束仍有持倉 → 以最後一根收盤價強制平倉(揭露用途,避免未實現損益被忽略)
  if (position && candles.length > 0) {
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

  return { trades, equityCurve, firstEvaluatedIndex };
};
