import { calculateEMA, calculateMACD, calculateRSI, calculateSupertrend } from '../../services/stockService';
import type {
  StockDataPoint,
  StrategyEvent,
  StrategyEventType,
  StrategyOverlayId,
  StrategyOverlayLayer,
} from './types';

export const STRATEGY_OVERLAY_GROUP_ID = 'strategy-signal-overlays';

export const STRATEGY_LAYER_META: Record<StrategyOverlayId, Omit<StrategyOverlayLayer, 'events'>> = {
  big_fish: {
    strategyId: 'big_fish',
    strategyName: 'SOL 吃大魚策略 2.0',
    shortName: '吃大魚 2.0',
    color: '#a855f7',
    icon: 'fish',
    lines: [],
  },
  extreme_reversal: {
    strategyId: 'extreme_reversal',
    strategyName: '專業操盤手：高勝率極值策略',
    shortName: '極值反彈',
    color: '#0f766e',
    icon: 'zap',
    lines: [],
  },
  trend: {
    strategyId: 'trend',
    strategyName: '多空趨勢強勢追蹤',
    shortName: '趨勢追蹤',
    color: '#2563eb',
    icon: 'trend',
    lines: [],
  },
  consecutive_volume: {
    strategyId: 'consecutive_volume',
    strategyName: '量能連續兩期以上放大',
    shortName: '連續爆量',
    color: '#059669',
    icon: 'volume',
    lines: [],
  },
  volume_no_break: {
    strategyId: 'volume_no_break',
    strategyName: '量增但未突破前高',
    shortName: '量增未破',
    color: '#ea580c',
    icon: 'warning',
    lines: [],
  },
};

const STRATEGY_EVENT_ICON: Record<StrategyEventType, string> = {
  ENTRY: '▲',
  EXIT: '▼',
  WARNING: '!',
};

const STRATEGY_EVENT_COLOR: Record<StrategyEventType, string> = {
  ENTRY: '#22c55e',
  EXIT: '#f43f5e',
  WARNING: '#f97316',
};

const createEvent = (
  candle: StockDataPoint,
  type: StrategyEventType,
  label: string,
  reason: string,
  color?: string
): StrategyEvent => {
  // 訊號標記位置：進場放在 K 棒低點下方，出場/警示放在高點上方，避免遮住 candle。
  const priceOffset = candle.close * 0.006;
  const price = type === 'ENTRY'
    ? Math.max(candle.low - priceOffset, 0)
    : candle.high + priceOffset;

  return {
    timestamp: candle.timestamp,
    price,
    type,
    label,
    reason,
    icon: STRATEGY_EVENT_ICON[type],
    color: color ?? STRATEGY_EVENT_COLOR[type],
  };
};

const calculateBollingerBands = (
  prices: number[],
  period = 20,
  multiplier = 2
): { basis: number[]; upper: number[]; lower: number[] } => {
  const basis = Array(prices.length).fill(null);
  const upper = Array(prices.length).fill(null);
  const lower = Array(prices.length).fill(null);

  for (let i = period - 1; i < prices.length; i++) {
    const window = prices.slice(i - period + 1, i + 1);
    const average = window.reduce((sum, price) => sum + price, 0) / period;
    const variance = window.reduce((sum, price) => sum + Math.pow(price - average, 2), 0) / period;
    const deviation = Math.sqrt(variance);

    basis[i] = average;
    upper[i] = average + deviation * multiplier;
    lower[i] = average - deviation * multiplier;
  }

  return { basis, upper, lower };
};

export const buildStrategyLayers = (chartData: StockDataPoint[]): StrategyOverlayLayer[] => {
  const layers: Record<StrategyOverlayId, StrategyOverlayLayer> = {
    big_fish: { ...STRATEGY_LAYER_META.big_fish, events: [], lines: [] },
    extreme_reversal: { ...STRATEGY_LAYER_META.extreme_reversal, events: [], lines: [] },
    trend: { ...STRATEGY_LAYER_META.trend, events: [] },
    consecutive_volume: { ...STRATEGY_LAYER_META.consecutive_volume, events: [] },
    volume_no_break: { ...STRATEGY_LAYER_META.volume_no_break, events: [] },
  };

  const prices = chartData.map(item => item.close);
  // EMA200 是大趨勢濾網，低於 200 根 K 時策略只畫可用線段、不產生正式訊號。
  const ema200 = calculateEMA(prices, 200);
  const rsi14 = calculateRSI(prices, 14);
  const bollinger = calculateBollingerBands(prices, 20, 2);
  const macd = calculateMACD(prices, 12, 26, 9);
  const supertrend = calculateSupertrend(chartData, 4.0, 10);
  const lineStartIndex = Math.max(1, chartData.length - 160);

  for (let i = 6; i < chartData.length; i++) {
    const current = chartData[i];
    const prev = chartData[i - 1];

    if (i >= lineStartIndex) {
      const prevSt = supertrend.trend[i - 1];
      const currSt = supertrend.trend[i];
      const prevEma200 = ema200[i - 1];
      const currEma200 = ema200[i];
      const prevUpper = bollinger.upper[i - 1];
      const currUpper = bollinger.upper[i];
      const prevLower = bollinger.lower[i - 1];
      const currLower = bollinger.lower[i];

      if (prevSt > 0 && currSt > 0) {
        layers.big_fish.lines.push({
          fromTimestamp: prev.timestamp,
          fromPrice: prevSt,
          toTimestamp: current.timestamp,
          toPrice: currSt,
          color: supertrend.dir[i] === 1 ? '#ef4444' : '#22c55e',
          label: '動態防守線',
        });
      }

      if (prevEma200 > 0 && currEma200 > 0) {
        layers.big_fish.lines.push({
          fromTimestamp: prev.timestamp,
          fromPrice: prevEma200,
          toTimestamp: current.timestamp,
          toPrice: currEma200,
          color: '#e5e7eb',
          label: '牛熊生命線',
        });

        layers.extreme_reversal.lines.push({
          fromTimestamp: prev.timestamp,
          fromPrice: prevEma200,
          toTimestamp: current.timestamp,
          toPrice: currEma200,
          color: '#f8fafc',
          label: '大趨勢 EMA 200',
        });
      }

      if (prevUpper > 0 && currUpper > 0) {
        layers.extreme_reversal.lines.push({
          fromTimestamp: prev.timestamp,
          fromPrice: prevUpper,
          toTimestamp: current.timestamp,
          toPrice: currUpper,
          color: '#94a3b8',
          label: '布林上軌',
        });
      }

      if (prevLower > 0 && currLower > 0) {
        layers.extreme_reversal.lines.push({
          fromTimestamp: prev.timestamp,
          fromPrice: prevLower,
          toTimestamp: current.timestamp,
          toPrice: currLower,
          color: '#94a3b8',
          label: '布林下軌',
        });
      }
    }

    if (i >= 200) {
      const macdGoldenCross = macd.dif[i - 1] <= macd.macd[i - 1] && macd.dif[i] > macd.macd[i];
      const earlyLong = macdGoldenCross && current.close > ema200[i] * 0.98;
      const trendLong = supertrend.dir[i] === -1 && supertrend.dir[i - 1] === 1;
      const trendExit = supertrend.dir[i] === 1 && supertrend.dir[i - 1] === -1;

      if (earlyLong || trendLong) {
        layers.big_fish.events.push(createEvent(
          current,
          'ENTRY',
          '吃大魚進場',
          earlyLong ? 'MACD 金叉且價格高於 EMA200 的 0.98 倍' : 'Supertrend 翻綠，趨勢確認'
        ));
      }

      if (trendExit) {
        layers.big_fish.events.push(createEvent(
          current,
          'EXIT',
          '趨勢反轉平倉',
          'Supertrend 翻紅，趨勢徹底反轉',
          '#fb7185'
        ));
      }
    }

    if (i >= 200) {
      const recentStartIndex = Math.max(0, i - 3);
      const touchedLowerRecently = chartData
        .slice(recentStartIndex, i + 1)
        .some((item, offset) => {
          const bandIndex = recentStartIndex + offset;
          return bollinger.lower[bandIndex] > 0 && item.close <= bollinger.lower[bandIndex] * 1.005;
        });
      const touchedUpperRecently = chartData
        .slice(recentStartIndex, i + 1)
        .some((item, offset) => {
          const bandIndex = recentStartIndex + offset;
          return bollinger.upper[bandIndex] > 0 && item.close >= bollinger.upper[bandIndex] * 0.995;
        });
      const rsiRecoverFromExtreme = rsi14[i - 1] <= 15 && rsi14[i] > 15;
      const rsiCoolFromExtreme = rsi14[i - 1] >= 85 && rsi14[i] < 85;
      const isBullRegime = current.close >= ema200[i];
      const isBearRegime = current.close <= ema200[i];

      if (touchedLowerRecently && rsiRecoverFromExtreme) {
        layers.extreme_reversal.events.push(createEvent(
          current,
          'ENTRY',
          isBullRegime ? '順勢反彈' : '逆勢反彈',
          isBullRegime
            ? 'RSI 從 15 以下回升，近期觸碰布林下軌，且價格位於 EMA200 之上'
            : 'RSI 從 15 以下回升，近期觸碰布林下軌，但仍低於 EMA200，屬逆勢抄底',
          isBullRegime ? '#10b981' : '#f59e0b'
        ));
      }

      if (touchedUpperRecently && rsiCoolFromExtreme) {
        layers.extreme_reversal.events.push(createEvent(
          current,
          isBearRegime ? 'ENTRY' : 'WARNING',
          isBearRegime ? '順勢做空' : '逆勢做空',
          isBearRegime
            ? 'RSI 從 85 以上回落，近期觸碰布林上軌，且價格位於 EMA200 之下'
            : 'RSI 從 85 以上回落，近期觸碰布林上軌，但仍高於 EMA200，屬逆勢摸頭',
          isBearRegime ? '#ef4444' : '#fb7185'
        ));
      }
    }

    if (current.ma20 && prev.ma20) {
      if (prev.close <= prev.ma20 && current.close > current.ma20) {
        layers.trend.events.push(createEvent(current, 'ENTRY', '趨勢進場', '收盤價強勢站上 MA20'));
      }

      if (prev.close >= prev.ma20 && current.close < current.ma20) {
        layers.trend.events.push(createEvent(current, 'EXIT', '趨勢出場', '收盤價跌破 MA20'));
      }
    }

    const history = chartData.slice(i - 5, i);
    const avgVolume = history.reduce((sum, item) => sum + item.volume, 0) / history.length;
    const prevHistory = chartData.slice(i - 6, i - 1);
    const prevAvgVolume = prevHistory.reduce((sum, item) => sum + item.volume, 0) / prevHistory.length;
    const isVolumeSurge = avgVolume > 0 && current.volume > avgVolume * 1.5;
    const wasVolumeSurge = prevAvgVolume > 0 && prev.volume > prevAvgVolume * 1.5;

    if (isVolumeSurge && wasVolumeSurge) {
      layers.consecutive_volume.events.push(
        createEvent(current, 'ENTRY', '連續爆量', '成交量連續兩期大於 5 期均量 1.5 倍')
      );
    }

    if (isVolumeSurge && current.high <= prev.high) {
      layers.volume_no_break.events.push(
        createEvent(current, 'WARNING', '量增未破', '爆量但未突破前一根高點，留意壓力或洗盤')
      );
    }
  }

  return Object.values(layers).map(layer => ({
    ...layer,
    events: layer.events.slice(-24),
  }));
};

export const filterStrategyLayersByVisibleData = (
  layers: StrategyOverlayLayer[],
  visibleData: StockDataPoint[]
): StrategyOverlayLayer[] => {
  if (visibleData.length === 0) return layers.map(layer => ({ ...layer, events: [], lines: [] }));

  const start = visibleData[0].timestamp;
  const end = visibleData[visibleData.length - 1].timestamp;

  return layers.map(layer => ({
    ...layer,
    events: layer.events.filter(event => event.timestamp >= start && event.timestamp <= end),
    lines: layer.lines.filter(line =>
      line.toTimestamp >= start &&
      line.fromTimestamp <= end
    ),
  }));
};
