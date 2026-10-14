/** @component Vela K 線、成交量與策略圖層；已確認訊號重放與視窗呈現分離，卸載釋放圖表資源。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OHLCV, VelaTheme } from '@luxalgo/vela';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import type { StockDataPoint, Timeframe } from '../../../types';
import type { MarketKey, StrategyOverlayId, StrategyOverlayLayer } from '../types';
import { getSignalItems, type SignalItem } from '../signal-display';
import { SignalDetails } from './SignalDetails';
import { chartDateFormatter, MARKET_CHART_TIMEZONES as MARKET_TIMEZONES } from '../../../utils/chartDate';

interface VelaChartProps {
  market: MarketKey;
  symbol: string;
  timeframe: Timeframe;
  data: StockDataPoint[];
  strategyLayers: StrategyOverlayLayer[];
  allStrategyLayers: StrategyOverlayLayer[];
  enabledStrategyLayerIds: StrategyOverlayId[];
  /** 可選的觀看區間（UTC 毫秒），完整 K 線仍保留以暖機指標；一般首頁沿用原有縮放。 */
  visibleRange?: { from: number; to: number };
}

interface VelaChartSnapshot {
  market: MarketKey;
  symbol: string;
  timeframe: Timeframe;
  bars: OHLCV[];
  strategyLayers: StrategyOverlayLayer[];
  allStrategyLayers: StrategyOverlayLayer[];
  enabledStrategyLayerIds: StrategyOverlayId[];
  visibleRange?: { from: number; to: number };
}

/** Vela 白底色盤沿用首頁 K 線圖的紅漲綠跌習慣與細格線。 */
const THEME: VelaTheme = {
  background: '#ffffff',
  textColor: '#141414',
  gridColor: '#ededed',
  borderColor: '#d4d4d4',
  upColor: '#ef4444',
  downColor: '#22c55e',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** 把首頁行情欄位轉成 Vela 使用的毫秒時間 OHLCV 格式，避免改動既有資料來源與策略計算。 */
function toVelaBars(data: StockDataPoint[]): OHLCV[] {
  return data
    .filter(candle => Number.isFinite(candle.timestamp) &&
      [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(candle => ({
      time: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Number.isFinite(candle.volume) ? candle.volume : 0,
    }));
}

/** 時間軸保留可點開的訊號說明，策略線與價格圖示由批次資料圖層負責。 */
function syncTimelineMarks(chart: VelaWorkspace['chart'], snapshot: VelaChartSnapshot) {
  const enabledIds = new Set(snapshot.enabledStrategyLayerIds);
  const dateFormat = chartDateFormatter(MARKET_TIMEZONES[snapshot.market]);
  for (const layer of snapshot.allStrategyLayers) {
    chart.marks.defineGroup({
      id: layer.strategyId,
      label: layer.shortName,
      visible: enabledIds.has(layer.strategyId),
    });
    chart.marks.setGroupVisible(layer.strategyId, enabledIds.has(layer.strategyId));
  }

  chart.marks.set(snapshot.strategyLayers.flatMap(layer => layer.events.map((event, index) => ({
    id: `${layer.strategyId}:${event.type}:${event.timestamp}:${index}`,
    time: event.timestamp,
    title: `${layer.shortName} · ${event.label}`,
    tooltip: `${layer.shortName}：${event.label}`,
    group: layer.strategyId,
    glyph: {
      shape: 'pin' as const,
      color: event.color ?? layer.color,
      letter: event.icon,
    },
    // 時間軸說明沿用圖表的市場時區，避免與 UTC 加密貨幣 K 線相差八小時。
    content: { text: `${event.reason}\n${dateFormat.format(event.timestamp)} ${MARKET_TIMEZONES[snapshot.market]}` },
  }))));

}

/** 延續舊首頁預設的均線、成交量、RSI、MACD 與 KDJ；研究線不會直接觸發自動下單。 */
function addDefaultIndicators(chart: VelaWorkspace['chart']) {
  // 成交量以來源 OHLCV 的原始數量顯示；待原生指標就緒才搬到獨立副圖，避免被價格線遮住。
  const volume = chart.addNativeIndicator('volume', {
    inputs: { upColor: THEME.upColor, downColor: THEME.downColor },
  });
  const stopVolumeReady = volume.on('ready', () => {
    volume.moveTo({ newPane: { after: 'price' } });
    stopVolumeReady();
  });
  const simpleMovingAverages = [
    [5, '#2563eb'], [10, '#7c3aed'], [20, '#d97706'], [60, '#0891b2'], [120, '#4d7c0f'],
  ] as const;
  for (const [length, color] of simpleMovingAverages) {
    chart.addNativeIndicator('sma', {
      inputs: { length, color },
    });
  }

  for (const [length, color] of [[12, '#111827'], [26, '#6366f1']] as const) {
    chart.addNativeIndicator('ema', { inputs: { length, color } });
  }

  chart.addNativeIndicator('rsi');
  chart.addNativeIndicator('macd');
  chart.addNativeIndicator('stochastic', {
    inputs: { kLength: 9, kSmoothing: 3, dLength: 3 },
  });
}

export function VelaChart({
  market,
  symbol,
  timeframe,
  data,
  strategyLayers,
  allStrategyLayers,
  enabledStrategyLayerIds,
  visibleRange,
}: VelaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<VelaWorkspace | null>(null);
  const overlayRef = useRef<ReturnType<typeof import('../vela-strategy-overlay').createStrategyOverlay> | null>(null);
  const frameRef = useRef<number | null>(null);
  const marketVersionRef = useRef(0);
  const marketPendingRef = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const bars = useMemo(() => toVelaBars(data), [data]);
  const signalItems = useMemo(() => getSignalItems(strategyLayers).reverse(), [strategyLayers]);
  const latestSnapshotRef = useRef<VelaChartSnapshot>({
    market,
    symbol,
    timeframe,
    bars,
    strategyLayers,
    allStrategyLayers,
    enabledStrategyLayerIds,
    visibleRange,
  });
  latestSnapshotRef.current = {
    market,
    symbol,
    timeframe,
    bars,
    strategyLayers,
    allStrategyLayers,
    enabledStrategyLayerIds,
    visibleRange,
  };

  /** 合併 React 同次行情與圖層更新，待資料載入完成才提交，避免重複繪製整組策略。 */
  const scheduleOverlayUpdate = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const workspace = workspaceRef.current;
      if (!workspace || marketPendingRef.current) return;
      const snapshot = latestSnapshotRef.current;
      overlayRef.current?.update(snapshot.strategyLayers, containerRef.current?.clientWidth);
      syncTimelineMarks(workspace.chart, snapshot);
    });
  }, []);

  /** 容器變窄時重新合併標籤，僅更新原生資料圖層，不重建整個圖表。 */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(scheduleOverlayUpdate);
    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleOverlayUpdate]);

  const focusSignal = (item: SignalItem) => {
    setSelectedSignalId(item.id);
    /** 以事件前後各約 12 根定位；尾端保留未來空白，避免較長的方向標籤被價格軸裁掉。 */
    const index = bars.findIndex(bar => bar.time === item.timestamp);
    if (index < 0) return;
    const from = bars[Math.max(0, index - 12)].time;
    const intervalMs = timeframe === '1d' ? 86_400_000 : timeframe === '4h' ? 14_400_000 : timeframe === '60m' ? 3_600_000 : 900_000;
    const endIndex = Math.min(bars.length - 1, index + 12);
    const to = bars[endIndex].time + Math.max(0, index + 12 - endIndex) * intervalMs;
    if (to > from) workspaceRef.current?.chart.setVisibleRange({ from, to });
  };

  useEffect(() => {
    let cancelled = false;

    void Promise.all([import('@luxalgo/vela/workspace'), import('../vela-strategy-overlay')]).then(([{ VelaWorkspace: Workspace }, { createStrategyOverlay }]) => {
      const container = containerRef.current;
      if (cancelled || !container) return;

      const snapshot = latestSnapshotRef.current;
      const workspace = new Workspace(container, {
        layout: false,
        symbol: snapshot.symbol,
        timeframe: snapshot.timeframe,
        data: snapshot.bars,
        live: false,
        // 明確建立成交量，停用工作區延遲自動加入，避免不同初始化順序改變預設副圖。
        volume: false,
        theme: THEME,
        timezone: MARKET_TIMEZONES[snapshot.market],
        statusline: true,
        watermark: true,
        bottombar: false,
        topbar: {
          left: ['style', 'indicators', 'undo-redo'],
          right: ['panels', 'screenshot'],
        },
      });

      workspaceRef.current = workspace;
      addDefaultIndicators(workspace.chart);
      overlayRef.current = createStrategyOverlay(workspace.chart);
      if (snapshot.visibleRange) workspace.chart.setVisibleRange(snapshot.visibleRange);
      scheduleOverlayUpdate();
      setLoadError(false);
    }).catch(error => {
      console.error('[Vela] 圖表載入失敗:', error);
      if (!cancelled) setLoadError(true);
    });

    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      overlayRef.current?.destroy();
      overlayRef.current = null;
      workspaceRef.current?.destroy();
      workspaceRef.current = null;
      marketPendingRef.current = false;
    };
  }, [scheduleOverlayUpdate]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    let active = true;
    const version = ++marketVersionRef.current;
    marketPendingRef.current = true;

    void workspace.chart.setMarket({ symbol, timeframe, data: bars }).then(() => {
      if (active && workspaceRef.current === workspace && version === marketVersionRef.current) {
        marketPendingRef.current = false;
        /** 行情完成後套用最新選擇，避免載入途中切換範圍後被舊快照覆蓋。 */
        const range = latestSnapshotRef.current.visibleRange;
        if (range) workspace.chart.setVisibleRange(range);
        scheduleOverlayUpdate();
      }
    }).catch(error => {
      if (active && version === marketVersionRef.current) marketPendingRef.current = false;
      console.error('[Vela] 更新行情失敗:', error);
    });

    return () => {
      active = false;
    };
  }, [symbol, timeframe, bars, scheduleOverlayUpdate]);

  /** 只在觀看按鈕改變時定位；開關圖層與容器縮放不重設使用者拖曳的位置。 */
  useEffect(() => {
    if (visibleRange && !marketPendingRef.current) workspaceRef.current?.chart.setVisibleRange(visibleRange);
  }, [visibleRange]);

  useEffect(() => {
    scheduleOverlayUpdate();
  }, [strategyLayers, allStrategyLayers, enabledStrategyLayerIds, scheduleOverlayUpdate]);

  return (
    <div className="relative flex h-full min-h-[560px] w-full flex-col overflow-hidden rounded-sm bg-white">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2" aria-label="訊號標籤說明">
        <div className="text-xs leading-relaxed text-slate-600"><strong>策略名稱・交易方向</strong><span className="ml-3">已收盤 K 線・預設參數重放</span><span className="ml-3">觀察／待確認不代表成交；密集處放大可展開</span></div>
        <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}
          className="rounded-md px-3 py-2 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: '#1e293b', color: '#ffffff' }}>訊號明細（{signalItems.length}）</button>
      </div>
      {loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 p-6 text-center font-mono text-sm text-rose-700">
          圖表載入失敗，請重新整理頁面。
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <div ref={containerRef} className="min-h-0 min-w-0 flex-1" aria-label={`${symbol} ${timeframe} K 線圖`} />
        {detailsOpen && <SignalDetails items={signalItems} timezone={MARKET_TIMEZONES[market]}
          selectedId={selectedSignalId} onSelect={focusSignal} onClose={() => setDetailsOpen(false)} />}
      </div>
    </div>
  );
}
