import { Activity, CircleAlert, Fish, LayoutGrid, TrendingUp, Zap } from 'lucide-react';
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
  return (
    <div className="border-t border-[#141414]/10 pt-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LayoutGrid size={14} className="opacity-60" />
            <span className="text-[10px] font-mono font-bold uppercase opacity-50">策略圖層</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 bg-[#141414] text-[#E4E3E0] rounded-sm">
              {activeStrategySignalCount}/{totalStrategySignalCount} SIGNALS
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onSetEnabledStrategyLayers(
                enabledStrategyLayers.length === strategyLayers.length
                  ? []
                  : strategyLayers.map(layer => layer.strategyId)
              );
            }}
            className="text-[10px] font-mono border border-[#141414] px-2 py-1 rounded-sm hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
          >
            {enabledStrategyLayers.length === strategyLayers.length ? 'CLEAR' : 'ALL'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
          {strategyLayers.map(layer => {
            const isEnabled = enabledStrategyLayers.includes(layer.strategyId);
            const totalLayerEvents = allStrategyLayers.find(item => item.strategyId === layer.strategyId)?.events.length || 0;
            return (
              <button
                key={layer.strategyId}
                type="button"
                onClick={() => onToggleStrategyLayer(layer.strategyId)}
                className={cn(
                  "flex items-center justify-between gap-3 p-3 border rounded-sm text-left transition-all min-h-[58px]",
                  isEnabled
                    ? "bg-[#141414] text-[#E4E3E0] border-[#141414]"
                    : "bg-white/60 border-[#141414]/10 hover:border-[#141414]/40"
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "w-8 h-8 rounded-sm border flex items-center justify-center flex-shrink-0",
                      isEnabled ? "bg-white/10" : "bg-white"
                    )}
                    style={{
                      borderColor: layer.color,
                      color: layer.color,
                    }}
                  >
                    <StrategyLayerIcon type={layer.icon} className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold truncate">{layer.shortName}</span>
                    <span className={cn("block text-[9px] font-mono", isEnabled ? "opacity-60" : "opacity-40")}>
                      {layer.events.length}/{totalLayerEvents} 次觸發
                    </span>
                    {layer.strategyId === 'big_fish' && totalLayerEvents === 0 && (
                      <span className={cn("block text-[8px] mt-0.5", isEnabled ? "opacity-50" : "opacity-35")}>
                        需 200 根 K，條件偏嚴
                      </span>
                    )}
                    {layer.strategyId === 'extreme_reversal' && totalLayerEvents === 0 && (
                      <span className={cn("block text-[8px] mt-0.5", isEnabled ? "opacity-50" : "opacity-35")}>
                        等待 RSI 極值回歸
                      </span>
                    )}
                  </span>
                </span>
                <span className={cn(
                  "w-5 h-5 rounded-sm border flex items-center justify-center text-[10px] font-bold flex-shrink-0",
                  isEnabled ? "border-[#E4E3E0] text-[#E4E3E0]" : "border-[#141414]/20 text-transparent"
                )}>
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
