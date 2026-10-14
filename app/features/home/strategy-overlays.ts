/** @file 以策略模組與回測引擎建立七個圖層；圖表重放不下單、不做結尾假平倉，警示與等待均明示。 */
import { runBacktestEngine, type EngineEvent } from '../../services/backtest/engine';
import { IndicatorCache } from '../../services/strategy/indicatorCache';
import { analyzeExtremeReversal } from '../../services/strategy/strategies/extremeReversal';
import { SQUEEZE_DEFAULTS } from '../../services/strategy/advancedIndicators';
import { STRATEGY_LAYER_META, STRATEGY_LAYER_MODULES } from './strategy-layer-meta';
import { confirmedStrategyCandles, type StrategyChartOptions } from './strategy-candles';
import type { Candle } from '../../services/strategy/types';
import type { StockDataPoint, StrategyEvent, StrategyOverlayId, StrategyOverlayLayer } from './types';

export { STRATEGY_LAYER_META } from './strategy-layer-meta';
export const STRATEGY_OVERLAY_GROUP_ID = 'strategy-signal-overlays';

function chartEvent(event: EngineEvent, label?: string, pending = false): StrategyEvent {
  const action = event.type === 'ENTRY' ? (event.side === 'LONG' ? '做多進場' : '做空進場')
    : event.type === 'EXIT' ? (event.side === 'LONG' ? '多單平倉' : '空單回補') : event.cancelled ? '進場取消' : '觀察警示';
  return { timestamp: event.timestamp, price: event.price, type: event.type, side: event.side, pending, cancelled: event.cancelled,
    label: label ?? action, reason: event.reason,
    icon: event.type === 'ENTRY' ? (event.side === 'LONG' ? '▲' : '▼') : event.type === 'EXIT' ? (event.side === 'LONG' ? '▼' : '▲') : '!' };
}

/** 圖表只保留近期 160 根線段，避免線段數量拖慢互動；成交／訊號明細保留全部可用歷史。 */
function addSeries(layer: StrategyOverlayLayer, candles: Candle[], values: number[], label: string, color: string | string[]) {
  for (let i = Math.max(1, candles.length - 160); i < candles.length; i++) {
    if (![values[i - 1], values[i]].every(value => Number.isFinite(value) && value > 0)) continue;
    layer.lines.push({ fromTimestamp: candles[i - 1].openTime, toTimestamp: candles[i].openTime,
      fromPrice: values[i - 1], toPrice: values[i], color: typeof color === 'string' ? color : color[i], label });
  }
}

function addObservationEvents(layer: StrategyOverlayLayer, candles: Candle[], indicators: IndicatorCache) {
  const module = STRATEGY_LAYER_MODULES[layer.strategyId];
  for (let index = module.warmupBars; index < candles.length; index++) {
    const ctx = { candles, index, indicators, params: module.defaultParams, position: null };
    if (layer.strategyId === 'volume_no_break') {
      const action = module.evaluate(ctx);
      if (action.type === 'ENTRY') layer.events.push(chartEvent({ type: 'WARNING', side: action.side,
        timestamp: candles[index].openTime, signalTime: candles[index].openTime, price: candles[index].close,
        reason: `僅觀察，不代表已放空：${action.reason}` }, '量增未破・做空觀察'));
    } else {
      const observation = analyzeExtremeReversal(ctx);
      if (observation?.warning) layer.events.push(chartEvent({ type: 'WARNING', side: observation.side,
        timestamp: candles[index].openTime, signalTime: candles[index].openTime, price: candles[index].close,
        reason: observation.reason }, '逆勢做空警示'));
    }
  }
  layer.events.sort((a, b) => a.timestamp - b.timestamp);
}

export function addStrategyLines(layers: StrategyOverlayLayer[], candles: Candle[], indicators: IndicatorCache) {
  for (const layer of layers) {
    if (layer.statusHint?.startsWith('不支援')) continue;
    if (layer.strategyId === 'big_fish' || layer.strategyId === 'futures_big_fish') {
      const st = indicators.bigFish();
      addSeries(layer, candles, st.line, '動態防守線', st.direction.map(dir => dir === -1 ? '#22c55e' : '#ef4444'));
      addSeries(layer, candles, indicators.ema(200), '牛熊生命線', '#94a3b8');
    } else if (layer.strategyId === 'extreme_reversal' || layer.strategyId === 'volatility_squeeze_breakout') {
      const bb = indicators.bollinger();
      addSeries(layer, candles, bb.upper, '布林上軌', '#94a3b8');
      addSeries(layer, candles, bb.lower, '布林下軌', '#94a3b8');
      if (layer.strategyId === 'extreme_reversal') addSeries(layer, candles, indicators.ema(200), '大趨勢 EMA 200', '#94a3b8');
    } else if (layer.strategyId === 'range_mean_reversion') {
      addSeries(layer, candles, indicators.ma(20), '均值參考 MA20', layer.color);
    }
  }
}

export function buildStrategyLayers(chartData: StockDataPoint[], options: StrategyChartOptions = { market: 'US', timeframe: '1d' }): StrategyOverlayLayer[] {
  const candles = confirmedStrategyCandles(chartData, options), indicators = new IndicatorCache(candles);
  const interval = options.timeframe === '60m' ? '1h' : options.timeframe;
  const layers = (Object.keys(STRATEGY_LAYER_META) as (keyof typeof STRATEGY_LAYER_META)[]).map(id => {
    const layer: StrategyOverlayLayer = { ...STRATEGY_LAYER_META[id], events: [], lines: [] };
    const module = STRATEGY_LAYER_MODULES[id], params = module.defaultParams;
    const warmup = module.warmupBarsForParams?.(params) ?? module.warmupBars;
    if (!module.markets.includes(options.market) || !module.supportedIntervals.includes(interval)) {
      layer.statusHint = '不支援目前市場／週期；請切換股票日線'; return layer;
    }
    if (candles.length <= warmup) {
      layer.statusHint = `已收盤 ${candles.length} 根，需至少 ${warmup + 1} 根`; return layer;
    }
    if (id !== 'volume_no_break') {
      /** 與回測預設費率及下一根開盤相同；示意資金只用來讓持倉重放可執行，不代表使用者帳戶。 */
      const result = runBacktestEngine(candles, module, params, {
        initialCapital: 1_000_000, cost: { feeRate: options.market === 'TW' ? 0.001425 : options.market === 'US' ? 0 : 0.001,
          slippageBps: 5, sellTaxRate: options.market === 'TW' ? 0.003 : 0 },
        fillMode: 'nextOpen', maxRiskPerTradePct: 1, maxPositionSizePct: 50, defaultStopLossPct: 5,
        precision: options.market === 'TW' ? 0 : 4, captureEvents: true, closeAtEnd: false,
      }, 0, indicators);
      layer.events = result.events.map(event => chartEvent(event));
      if (result.pendingSignal) layer.events.push(chartEvent(result.pendingSignal, '待下一根開盤確認', true));
    }
    if (id === 'volume_no_break' || id === 'extreme_reversal') addObservationEvents(layer, candles, indicators);
    if (id === 'volatility_squeeze_breakout') {
      const s = SQUEEZE_DEFAULTS;
      const state = indicators.squeeze(20, 2, s.widthLookback, s.widthPercentile, s.compressionBars, s.setupExpiryBars);
      layer.statusHint = state.active.at(-1) ? '收斂觀察中，等待放量突破' : '等待收斂後突破確認';
    } else if (id === 'range_mean_reversion') layer.statusHint = '僅弱趨勢、重返帶內且目標空間足夠才進場';
    return layer;
  });
  addStrategyLines(layers, candles, indicators);
  return layers;
}

export const filterStrategyLayersByVisibleData = (layers: StrategyOverlayLayer[], visibleData: StockDataPoint[]): StrategyOverlayLayer[] => {
  if (visibleData.length === 0) return layers.map(layer => ({ ...layer, events: [], lines: [] }));
  const start = visibleData[0].timestamp, end = visibleData.at(-1)!.timestamp;
  return layers.map(layer => ({ ...layer, events: layer.events.filter(event => event.timestamp >= start && event.timestamp <= end),
    lines: layer.lines.filter(line => line.toTimestamp >= start && line.fromTimestamp <= end) }));
};
