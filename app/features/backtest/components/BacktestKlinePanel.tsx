/**
 * 【詳細繁體中文註解】：回測 K 線圖面板(KlineCharts v9)
 *
 * 職責:
 *   1. 繪製回測區間 K 線 + MA20 主圖指標 + 成交量副圖
 *   2. 以 overlay 標記每筆交易的進出場點(重用 home 頁策略圖層的視覺語彙:
 *      進場 ▲ 綠色標在 K 棒低點下方、出場 ▼ 紅色標在高點上方、停損出場橙色)
 *   3. selectedTrade 變動時,scrollToTimestamp 捲動定位該筆交易
 */

import { useEffect, useRef } from 'react';
import { dispose, init, type Chart } from 'klinecharts';
import type { BacktestTrade, ChartKline } from '../types';

const OVERLAY_GROUP_ID = 'backtest-trade-overlays';

interface BacktestKlinePanelProps {
  klines: ChartKline[];
  trades: BacktestTrade[];
  selectedTrade: BacktestTrade | null;
  truncated?: boolean;
}

/** 依出場原因決定顏色:停損=橙、一般出場=紅 */
const exitColor = (trade: BacktestTrade) =>
  trade.exitReason?.includes('停損') ? '#f97316' : '#f43f5e';

export function BacktestKlinePanel({ klines, trades, selectedTrade, truncated }: BacktestKlinePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);

  // 初始化圖表(僅一次);樣式沿用 home 頁慣例(漲紅跌綠)
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = init(containerRef.current);
    chartRef.current = chart;

    chart?.setStyles({
      grid: {
        horizontal: { show: true, color: '#ededed' },
        vertical: { show: false },
      },
      candle: {
        bar: { upColor: '#ef4444', downColor: '#22c55e', noChangeColor: '#888888' },
        tooltip: { showRule: 'follow_cross' as any, showType: 'standard' as any },
      },
    } as any);
    chart?.createIndicator({ name: 'MA', calcParams: [20] }, false, { id: 'main' } as any);
    chart?.createIndicator('VOL', false, { id: 'pane_vol' } as any);

    return () => {
      if (containerRef.current) dispose(containerRef.current);
      chartRef.current = null;
    };
  }, []);

  // K 線資料更新
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const formatted = klines.map((k) => ({
      timestamp: k.openTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
    (chart as any).applyNewData(formatted);
    chart.resize();
  }, [klines]);

  // 交易進出場標記
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || klines.length === 0) return;

    try {
      chart.removeOverlay({ groupId: OVERLAY_GROUP_ID });

      const overlays = trades.flatMap((trade) => {
        const items: any[] = [];
        // 進出場標記位置:進場放低點下方、出場放高點上方(偏移 0.6% 避免遮住 K 棒)
        const entryOffset = trade.entryPrice * 0.006;

        items.push({
          name: 'simpleAnnotation',
          groupId: OVERLAY_GROUP_ID,
          lock: true,
          zLevel: 20,
          points: [{ timestamp: trade.entryTime, value: trade.entryPrice - entryOffset }],
          extendData: `▲ ${trade.side === 'LONG' ? '多' : '空'}進場`,
          styles: annotationStyle(trade.side === 'LONG' ? '#22c55e' : '#0ea5e9'),
        });

        if (trade.exitTime && trade.exitPrice != null) {
          const color = exitColor(trade);
          items.push({
            name: 'simpleAnnotation',
            groupId: OVERLAY_GROUP_ID,
            lock: true,
            zLevel: 20,
            points: [{ timestamp: trade.exitTime, value: trade.exitPrice + entryOffset }],
            extendData: `▼ 出場 ${trade.pnl != null ? (trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2) : ''}`,
            styles: annotationStyle(color),
          });
        }
        return items;
      });

      if (overlays.length > 0) chart.createOverlay(overlays as any, 'main');
    } catch (error) {
      console.error('繪製回測標記失敗:', error);
    }
  }, [trades, klines]);

  // 點擊明細表 → 捲動定位到該筆交易的進場時間
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !selectedTrade) return;
    try {
      (chart as any).scrollToTimestamp(selectedTrade.entryTime, 300);
    } catch (error) {
      console.error('圖表定位失敗:', error);
    }
  }, [selectedTrade]);

  return (
    <div className="bg-white border border-[#141414] rounded-sm p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold font-serif">K 線與進出場標記</h3>
        {truncated && (
          <span className="text-[10px] font-mono text-amber-600">
            ⚠️ K 線量過大,僅顯示最近 10,000 根
          </span>
        )}
      </div>
      <div ref={containerRef} className="w-full h-[420px]" />
    </div>
  );
}

/** 進出場標記的統一樣式(重用 home 頁 simpleAnnotation 視覺) */
const annotationStyle = (color: string) => ({
  line: { color, size: 2, style: 'solid' },
  polygon: { color, borderColor: color, borderSize: 1, style: 'fill' },
  text: {
    color: '#ffffff',
    size: 10,
    family: 'monospace',
    weight: 700,
    backgroundColor: color,
    borderColor: color,
    borderSize: 1,
    borderRadius: 2,
    paddingLeft: 4,
    paddingRight: 4,
    paddingTop: 2,
    paddingBottom: 2,
  },
});
