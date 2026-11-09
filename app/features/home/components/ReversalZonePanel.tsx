/**
 * @component 美股、加密貨幣與股票合約共用的「多空反轉區間作戰室」面板
 *
 * 【詳細繁體中文註解】：
 * 1. 針對當前選取標的與 K 線週期（排除最後一根未收盤 K 線以防假訊號重繪），
 *    即時透過 `analyzeReversalZone` 計算：
 *    - 🟢 【做多反轉支撐區間（Long Reversal Zone）】：前低箱底 + 布林下軌共振帶、結構停損價、TP1 中軌目標、TP2 波段目標與預估 R 倍數。
 *    - 🔴 【做空反轉壓力區間（Short Reversal Zone）】：前高箱頂 + 布林上軌共振帶、結構停損價、TP1 中軌目標、TP2 波段目標與預估 R 倍數。
 * 2. 明確標示當前處於「🟢 破底翻／支撐做多確認」「🔴 假突破／壓力做空確認」「🟡 進入做多支撐區」「🟠 進入做空壓力區」或「⚪ 區間中軸等待」，
 *    協助使用者在美股與虛擬幣精準抓出開空與做多的反轉價格帶。
 * 3. 本元件僅作行情與策略研究顯示，不直接觸發任何真實下單。
 */
import { ArrowDownRight, ArrowUpRight, Crosshair, ShieldAlert, Target } from 'lucide-react';
import { useMemo } from 'react';
import {
  analyzeReversalZone,
  formatReversalPrice,
  type ReversalBandPlan,
  type ReversalSignalState,
} from '../../../services/strategy/reversalZone';
import type { Candle } from '../../../services/strategy/types';
import type { StockDataPoint, Timeframe } from '../../../types';
import { cn } from '../../../utils/cn';

interface ReversalZonePanelProps {
  /** 商品代號（例如 NVDA、BTC/USD、NVDAUSDT） */
  symbol: string;
  /** 當前選擇的 K 線時間週期 */
  timeframe: Timeframe;
  /** K 線資料序列（若最後一根尚未收盤，內部會自動排除最後一根） */
  data: StockDataPoint[];
  /** 是否已完成排除未收盤 K 線（例如 Bitget 股票合約頁傳入的已是 closedCandles） */
  alreadyClosed?: boolean;
}

/** 依據反轉訊號狀態回傳頂部徽章樣式 */
function getStateBadgeStyle(state: ReversalSignalState): string {
  if (state === 'LONG_CONFIRMED') {
    return 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200';
  }
  if (state === 'SHORT_CONFIRMED') {
    return 'border-rose-400/60 bg-rose-500/20 text-rose-200';
  }
  if (state === 'APPROACHING_LONG') {
    return 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300';
  }
  if (state === 'APPROACHING_SHORT') {
    return 'border-amber-500/40 bg-amber-950/40 text-amber-300';
  }
  return 'border-white/20 bg-white/5 text-[#E4E3E0]/75';
}

/** 單側（做多支撐區 或 做空壓力區）的區間卡片子元件 */
function ZoneBandCard({
  plan,
  active,
  title,
  subtitle,
}: {
  plan: ReversalBandPlan;
  active: boolean;
  title: string;
  subtitle: string;
}) {
  const isLong = plan.side === 'LONG';
  return (
    <div
      className={cn(
        'rounded-sm border p-3 flex flex-col justify-between gap-2.5 transition-all',
        isLong
          ? active
            ? 'border-emerald-400 bg-emerald-950/35 shadow-sm'
            : 'border-emerald-500/25 bg-emerald-950/15'
          : active
          ? 'border-rose-400 bg-rose-950/35 shadow-sm'
          : 'border-rose-500/25 bg-rose-950/15'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div
            className={cn(
              'text-xs font-bold flex items-center gap-1',
              isLong ? 'text-emerald-300' : 'text-rose-300'
            )}
          >
            {isLong ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            {title}
          </div>
          <div className="text-[10px] font-mono opacity-65 mt-0.5">{subtitle}</div>
        </div>
        {active && (
          <span
            className={cn(
              'px-2 py-0.5 text-[10px] font-mono font-bold rounded-sm border',
              isLong
                ? 'border-emerald-400 bg-emerald-500/25 text-emerald-200'
                : 'border-rose-400 bg-rose-500/25 text-rose-200'
            )}
          >
            {isLong ? '⚡ 當前多方關注區' : '⚡ 當前空方關注區'}
          </span>
        )}
      </div>

      <div className="p-2.5 rounded-sm bg-black/45 border border-white/10">
        <div className="text-[10px] font-mono opacity-60">
          {isLong ? '建議分批做多／低吸反轉區間' : '建議分批做空／摸頂反轉區間'}
        </div>
        <div
          className={cn(
            'text-base md:text-lg font-mono font-bold mt-0.5',
            isLong ? 'text-emerald-300' : 'text-rose-300'
          )}
        >
          {formatReversalPrice(plan.zoneLow)} ～ {formatReversalPrice(plan.zoneHigh)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
        <div className="p-2 rounded-sm bg-black/35 border border-white/5">
          <div className="text-[9px] opacity-55 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            結構停損 (SL)
          </div>
          <div className="font-bold text-rose-300 mt-0.5">{formatReversalPrice(plan.stopLoss)}</div>
          <div className="text-[9px] opacity-55">風險 -{plan.riskPct.toFixed(2)}%</div>
        </div>

        <div className="p-2 rounded-sm bg-black/35 border border-white/5">
          <div className="text-[9px] opacity-55 flex items-center gap-1">
            <Target className="w-3 h-3 text-sky-400" />
            第一目標 (中軌)
          </div>
          <div className="font-bold text-sky-300 mt-0.5">{formatReversalPrice(plan.target1)}</div>
          <div className="text-[9px] opacity-55">MA20 均值回歸</div>
        </div>

        <div className="p-2 rounded-sm bg-black/35 border border-white/5">
          <div className="text-[9px] opacity-55 flex items-center gap-1">
            <Target className="w-3 h-3 text-amber-400" />
            波段目標 (TP2)
          </div>
          <div className="font-bold text-amber-300 mt-0.5">{formatReversalPrice(plan.target2)}</div>
          <div className="text-[9px] text-emerald-300 font-bold">
            預估 {plan.rewardRiskRatio.toFixed(1)}R
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReversalZonePanel({
  symbol,
  timeframe,
  data,
  alreadyClosed = false,
}: ReversalZonePanelProps) {
  const analysis = useMemo(() => {
    const closedData = !alreadyClosed && data.length > 35 ? data.slice(0, -1) : data;
    if (closedData.length < 30) return null;

    const candles: Candle[] = closedData.map((d) => ({
      openTime: d.timestamp,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

    return analyzeReversalZone(candles);
  }, [data, alreadyClosed]);

  if (!analysis) return null;

  const {
    closePrice,
    signalState,
    badge,
    reason,
    longZone,
    shortZone,
    metrics,
  } = analysis;

  const isLongFocus =
    signalState === 'LONG_CONFIRMED' || signalState === 'APPROACHING_LONG';
  const isShortFocus =
    signalState === 'SHORT_CONFIRMED' || signalState === 'APPROACHING_SHORT';

  return (
    <section
      aria-label={`${symbol} 多空反轉區間作戰室`}
      className="p-3 md:p-4 bg-[#141414] text-[#E4E3E0] border border-[#141414] rounded-sm space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <Crosshair className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="text-xs font-bold tracking-wide">
            🎯 多空反轉區間作戰室（{symbol} · {timeframe} 已收盤結構）
          </span>
          <span
            className={cn(
              'text-[10px] font-mono px-2 py-0.5 rounded-sm border font-bold',
              getStateBadgeStyle(signalState)
            )}
          >
            {badge}
          </span>
        </div>

        <div className="text-[11px] font-mono text-[#E4E3E0]/75 flex flex-wrap items-center gap-3">
          <span>
            最新收盤：<strong className="text-white">{formatReversalPrice(closePrice)}</strong>
          </span>
          <span>
            RSI(14)：
            <strong
              className={cn(
                metrics.rsi14 <= 35
                  ? 'text-emerald-300'
                  : metrics.rsi14 >= 65
                  ? 'text-rose-300'
                  : 'text-white'
              )}
            >
              {metrics.rsi14.toFixed(1)}
            </strong>
          </span>
          <span>
            ATR(14)：<strong className="text-cyan-300">{formatReversalPrice(metrics.atr14)}</strong>
          </span>
        </div>
      </div>

      {/* 即時反轉診斷結論 */}
      <div className="p-2.5 rounded-sm bg-white/[0.04] border border-white/10 text-xs leading-relaxed">
        <span className="font-mono text-cyan-300 font-bold mr-1.5">[反轉操作劇本]</span>
        {reason}
      </div>

      {/* 左右雙欄：做多反轉支撐區 vs 做空反轉壓力區 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ZoneBandCard
          plan={longZone}
          active={isLongFocus}
          title="🟢 做多反轉支撐區間 (Long Reversal Zone)"
          subtitle={`前低箱底 ${formatReversalPrice(metrics.swingLow)} × 布林下軌 ${formatReversalPrice(
            metrics.bollingerLower
          )} 共振帶`}
        />
        <ZoneBandCard
          plan={shortZone}
          active={isShortFocus}
          title="🔴 做空反轉壓力區間 (Short Reversal Zone)"
          subtitle={`前高箱頂 ${formatReversalPrice(metrics.swingHigh)} × 布林上軌 ${formatReversalPrice(
            metrics.bollingerUpper
          )} 共振帶`}
        />
      </div>
    </section>
  );
}
