/** @file 七個策略圖層的顯示開關；資料不足與不支援週期明示，操作不觸發交易或重新判斷歷史。 */
import { Activity, ArrowLeftRight, CircleAlert, Fish, LayoutGrid, Minimize2, TrendingUp, Zap } from 'lucide-react';
import { cn } from '../../../utils/cn';
import type { StrategyOverlayId, StrategyOverlayLayer } from '../types';

const StrategyLayerIcon = ({
  type,
  className,
}: {
  type: StrategyOverlayLayer['icon'];
  className?: string;
}) => {
  if (type === 'fish') return <Fish className={className} />;
  if (type === 'volume') return <Activity className={className} />;
  if (type === 'warning') return <CircleAlert className={className} />;
  if (type === 'zap') return <Zap className={className} />;
  if (type === 'squeeze') return <Minimize2 className={className} />;
  if (type === 'range') return <ArrowLeftRight className={className} />;
  return <TrendingUp className={className} />;
};

interface StrategyLayerPanelProps {
  strategyLayers: StrategyOverlayLayer[];
  allStrategyLayers: StrategyOverlayLayer[];
  enabledStrategyLayers: StrategyOverlayId[];
  activeStrategySignalCount: number;
  totalStrategySignalCount: number;
  onToggleStrategyLayer: (strategyId: StrategyOverlayId) => void;
  onSetEnabledStrategyLayers: (strategyIds: StrategyOverlayId[]) => void;
}

export function StrategyLayerPanel({
  strategyLayers,
  allStrategyLayers,
  enabledStrategyLayers,
  activeStrategySignalCount,
  totalStrategySignalCount,
  onToggleStrategyLayer,
  onSetEnabledStrategyLayers,
}: StrategyLayerPanelProps) {
  const allEnabled = strategyLayers.every(layer => enabledStrategyLayers.includes(layer.strategyId));
  const noneEnabled = strategyLayers.every(layer => !enabledStrategyLayers.includes(layer.strategyId));
  return (
    <div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LayoutGrid size={14} className="opacity-60" />
            <span className="text-[10px] font-mono font-bold uppercase opacity-50">策略圖層</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 bg-[#141414] text-[#E4E3E0] rounded-sm">
              {activeStrategySignalCount}/{totalStrategySignalCount} SIGNALS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={allEnabled}
              onClick={() => onSetEnabledStrategyLayers(strategyLayers.map(layer => layer.strategyId))}
              className="text-[10px] border border-[#141414]/20 px-2 py-1 rounded-sm hover:bg-[#141414]/5 disabled:opacity-40">
              全開
            </button>
            <button type="button" disabled={noneEnabled} onClick={() => onSetEnabledStrategyLayers([])}
              className="text-[10px] border border-[#141414]/20 px-2 py-1 rounded-sm hover:bg-[#141414]/5 disabled:opacity-40">
              全關
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {strategyLayers.map(layer => {
            const isEnabled = enabledStrategyLayers.includes(layer.strategyId);
            const totalLayerEvents = allStrategyLayers.find(item => item.strategyId === layer.strategyId)?.events.length || 0;
            return (
              <button
                key={layer.strategyId}
                type="button"
                role="switch"
                aria-checked={isEnabled}
                aria-label={`${layer.shortName}策略圖層`}
                title={`${layer.strategyName}：目前範圍 ${layer.events.length} 次，全資料 ${totalLayerEvents} 次觸發。${layer.statusHint ?? '以預設參數重放已收盤 K 線'}`}
                onClick={() => onToggleStrategyLayer(layer.strategyId)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 border rounded-sm text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
                  isEnabled
                    ? "bg-[#141414] text-[#E4E3E0] border-[#141414]"
                    : "bg-white/60 border-[#141414]/10 hover:border-[#141414]/40"
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center justify-center flex-shrink-0" style={{ color: layer.color }}>
                    <StrategyLayerIcon type={layer.icon} className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-bold truncate">{layer.shortName}</span>
                    <span className={cn("block text-[10px] font-mono", isEnabled ? "opacity-70" : "opacity-50")}>
                      {layer.events.length}/{totalLayerEvents} 次觸發
                    </span>
                    {layer.statusHint && (
                      <span className={cn("block max-w-[220px] text-[9px] mt-0.5", isEnabled ? "opacity-70" : "opacity-60")}>
                        {layer.statusHint}
                      </span>
                    )}
                    {layer.strategyId === 'extreme_reversal' && totalLayerEvents === 0 && !layer.statusHint && (
                      <span className={cn("block text-[8px] mt-0.5", isEnabled ? "opacity-50" : "opacity-35")}>
                        等待 RSI 極值回歸
                      </span>
                    )}
                  </span>
                </span>
                <span className={cn(
                  "ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold flex-shrink-0",
                  isEnabled ? "bg-emerald-500/20 text-emerald-400" : "bg-[#141414]/5 opacity-60"
                )}>
                  {isEnabled ? '開' : '關'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
