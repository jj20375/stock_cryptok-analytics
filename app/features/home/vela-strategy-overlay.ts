/** @file 系統策略一次送入資料圖層，避免數百個互動繪圖逐筆建立歷史快照。 */
import { registerNativeIndicator, unregisterNativeIndicator } from '@luxalgo/vela/plugin';
import type { DrawingLabel, DrawingLine, NativeIndicatorContext, NativeIndicatorOutput } from '@luxalgo/vela/plugin';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import type { StrategyOverlayLayer } from './types';
import { getSignalAction, getSignalItems, groupChartSignals, SIGNAL_STRATEGIES } from './signal-display';
import { chartDateFormatter } from '../../utils/chartDate';

/** 標籤沿用既有 UTC 日期語意；只改顯示語系，不調整訊號所在 K 棒。 */
const labelDateFormat = chartDateFormatter('Etc/UTC', false);

/** 策略線使用原生線段，縮放只計入可見線段；長路徑會把畫面外的歷史低價也算入，壓扁近期 K 線。 */
export function buildStrategyOutput(layers: StrategyOverlayLayer[], range?: { from: number; to: number }, width?: number): NativeIndicatorOutput {
  const lines: DrawingLine[] = [], labels: DrawingLabel[] = [];
  for (const layer of layers) {
    for (const line of layer.lines) {
      lines.push({ id: `${layer.strategyId}:${lines.length}`, paneId: 'price', xloc: 'bar_time',
        x1: line.fromTimestamp, y1: line.fromPrice, x2: line.toTimestamp, y2: line.toPrice,
        color: line.color, width: line.label === '牛熊生命線' ? 1 : 2,
        style: 'solid', extend: 'none', overlay: true, invisible: false, arrowLeft: false, arrowRight: false });
    }
  }
  for (const group of groupChartSignals(getSignalItems(layers), range, width)) {
    const first = group.items[0], single = group.items.length === 1;
    const action = group.items.every(item => getSignalAction(item) === getSignalAction(first)) ? getSignalAction(first) : '訊號';
    const titles = [...new Set(group.items.map(item => `${SIGNAL_STRATEGIES[item.strategyId].name}・${getSignalAction(item)}`))];
    // 合併仍顯示策略名稱；最多兩列名稱加剩餘筆數，避免退回只有數字而無法辨識的標籤。
    const text = single ? titles[0] : titles.length === group.items.length && titles.length <= 3
      ? titles.join('\n') : `${titles.slice(0, 2).join('\n')}\n共 ${group.items.length} 筆${action}`;
    labels.push({ id: `${group.timestamp}:${group.below}`, paneId: 'price', xloc: 'bar_time', x: group.timestamp,
      y: first.price, yloc: group.below ? 'belowbar' : 'abovebar',
      text,
      style: group.below ? 'label_up' : 'label_down', color: single ? SIGNAL_STRATEGIES[first.strategyId].color : '#334155',
      textColor: '#ffffff', size: 'normal', textAlign: 'center', fontFamily: 'default', bold: true,
      tooltip: group.items.map(item => `${labelDateFormat.format(item.timestamp)} ${item.strategyName} · ${item.label}：${item.reason}`).join('\n'), overlay: true });
  }
  return { lines, labels };
}

/** 每個圖表獨立註冊與清理，避免首頁或復盤的多個實例互相覆蓋輸出。 */
export function createStrategyOverlay(chart: VelaWorkspace['chart']) {
  const type = `app-strategy-${crypto.randomUUID()}`;
  let context: NativeIndicatorContext | null = null, layers: StrategyOverlayLayer[] = [], width = 1000;
  const emit = () => context?.emit(buildStrategyOutput(layers, chart.getVisibleRange() ?? undefined, width));
  const noop = () => {};
  registerNativeIndicator({ type, title: '策略訊號', paneHint: 'price', overlay: true, legend: false, reactsToViewport: true,
    inputsSchema: () => [], defaultInputs: () => ({}), create: () => ({
      start: ctx => { context = ctx; emit(); }, onBars: noop, onViewport: emit, setInputs: noop,
      suspend: noop, resume: emit, stop: () => { context = null; },
    }),
  });
  const handle = chart.addNativeIndicator(type);
  return {
    update(nextLayers: StrategyOverlayLayer[], nextWidth = 1000) { layers = nextLayers; width = nextWidth; emit(); },
    destroy() { handle.remove(); unregisterNativeIndicator(type); context = null; },
  };
}
