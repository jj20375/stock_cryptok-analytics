/**
 * @file 首頁「吃大魚 Pro · 15m 勝利方程式 ＆ 江恩波動率倍數表格」即時戰情面板
 *
 * 【詳細繁體中文註解】：
 * 1. 直接對當前載入的 K 線序列（排除最後一根未收盤 K 線）執行「吃大魚 Pro」與「江恩波動率倍數表格」即時運算。
 * 2. 完整呈現使用者 TradingView 截圖中的「江恩波動率倍數表格」（1.0595 ~ 1.2355 七階「低點往上乘」與「高點往下除」），
 *    並支援自動波段極值偵測與手動輸入基準高低點（例如輸入 265.6 與 270.5 即刻對齊 TradingView 目標價）。
 * 3. 內建「TradingView Pine Script v5（吃大魚 Pro 3.0 防雙巴＋江恩表格）」一鍵複製功能，方便使用者同步升級 TradingView 圖表。
 */

import { Check, Copy, Code2, Fish, ShieldCheck, Sparkles, Table2, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { StockDataPoint, Timeframe } from '../../../types';
import { IndicatorCache } from '../../../services/strategy/indicatorCache';
import bigFishPro, {
  calculateGannVolatilityTable,
  evaluateBigFishProAt,
} from '../../../services/strategy/strategies/bigFishPro';
import type { Candle } from '../../../services/strategy/types';
import { cn } from '../../../utils/cn';

interface BigFishProGannPanelProps {
  symbol: string;
  timeframe: Timeframe;
  data: StockDataPoint[];
}

const PINE_SCRIPT_PRO_V5 = `//@version=5
strategy("吃大魚策略 Pro 3.0 (15m 防雙巴勝利方程式 + 江恩波動率表格)", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_value=0.05)

// === 1. 吃大魚核心參數 ===
atrPeriod = input.int(10, "Supertrend ATR 長度", group="吃大魚 Pro 核心")
factor = input.float(4.0, "Supertrend 倍數", step=0.1, group="吃大魚 Pro 核心")
emaLen = input.int(200, "生命線 EMA 長度", group="吃大魚 Pro 核心")
minRedBars = input.int(12, "一號槍：翻綠前最少紅K洗盤數", minval=4, maxval=40, group="15m 防雙巴過濾")
minCloseStr = input.float(0.55, "最低收盤實體強度 (0~1)", minval=0.3, maxval=0.9, step=0.05, group="15m 防雙巴過濾")
maxStopDistPct = input.float(6.0, "距綠線最大防守風險 %", minval=1.5, maxval=15.0, step=0.5, group="15m 防雙巴過濾")
pivotLen = input.int(20, "江恩基準高低點回看根數", minval=5, maxval=100, group="江恩波動率表格")

// === 2. 指標計算 ===
[supertrend, direction] = ta.supertrend(factor, atrPeriod)
ema200 = ta.ema(close, emaLen)
[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)

// 計算連續紅線根數（洗盤完整度）
var int priorRedBars = 0
if direction[1] == 1
    priorRedBars := priorRedBars + 1
else if direction[1] == -1
    priorRedBars := 0

candleRange = high - low
closeStrength = candleRange > 0 ? (close - low) / candleRange : 0.6
volAvg20 = ta.sma(volume, 20)
volRatio = volAvg20 > 0 ? volume / volAvg20 : 1.0
stopDistPct = direction == -1 and supertrend > 0 ? ((close - supertrend) / close) * 100 : 99.0
emaDistPct = ema200 > 0 ? ((close / ema200) - 1) * 100 : 0.0

// === 3. 15m 勝利方程式雙模式進場（徹底廢除紅線下 MACD 假金叉雙巴） ===
// 一號槍：長紅洗盤後 Supertrend 首次翻綠突破
bottomFlipLong = barstate.isconfirmed and direction == -1 and direction[1] == 1 and priorRedBars >= minRedBars and closeStrength >= minCloseStr and stopDistPct <= maxStopDistPct and volRatio >= 1.0

// 二號槍：Supertrend 已處於綠線 + 站穩上升 EMA200 + MACD 金叉共振
trendResonanceLong = barstate.isconfirmed and direction == -1 and close > ema200 and ema200 >= ema200[4] * 0.999 and ta.crossover(macdLine, signalLine) and closeStrength >= 0.5 and emaDistPct <= 6.0 and stopDistPct <= maxStopDistPct

// 江恩基準高低點與目標
pivotLow = ta.lowest(low, pivotLen)
pivotHigh = ta.highest(high, pivotLen)
gannTarget1 = pivotLow * 1.0595
gannTarget2 = pivotLow * 1.08

// === 4. 1R 自動保本與出場管理 ===
var float entryStop = na
var float oneRTarget = na
var bool movedToBreakeven = false

if (bottomFlipLong or trendResonanceLong) and strategy.position_size == 0
    entryStop := supertrend
    riskDist = math.max(close * 0.01, close - supertrend)
    oneRTarget := close + riskDist
    movedToBreakeven := false
    strategy.entry("吃大魚Pro多", strategy.long, comment=bottomFlipLong ? "吃大魚一號槍(翻綠)" : "吃大魚二號槍(共振)")

if strategy.position_size > 0
    if high >= oneRTarget
        movedToBreakeven := true
    activeStop = movedToBreakeven ? math.max(entryStop, strategy.position_avg_price * 1.0015) : entryStop
    strategy.exit("保本/江恩停利", "吃大魚Pro多", stop=activeStop, limit= math.max(strategy.position_avg_price * 1.08, gannTarget2))
    if barstate.isconfirmed and direction == 1
        strategy.close("吃大魚Pro多", comment="Supertrend翻紅出場")

plot(direction == -1 ? supertrend : na, "綠線多頭防守", color=color.new(color.lime, 0), style=plot.style_linebr, linewidth=2)
plot(direction == 1 ? supertrend : na, "紅線空頭壓力", color=color.new(color.red, 0), style=plot.style_linebr, linewidth=2)
plot(ema200, "EMA 200 生命線", color=color.new(color.yellow, 0), linewidth=2)

// === 5. 右上角江恩波動率倍數表格 ===
var table gannTbl = table.new(position.top_right, 3, 9, bgcolor=color.new(#111827, 10), border_width=1, border_color=color.new(color.gray, 60))
if barstate.islast
    table.cell(gannTbl, 0, 0, "江恩波動率倍數表格", text_color=color.white, bgcolor=color.new(#1f2937, 0))
    table.merge_cells(gannTbl, 0, 0, 2, 0)
    table.cell(gannTbl, 0, 1, "波動率倍數", text_color=color.silver, bgcolor=color.new(#1f2937, 20))
    table.cell(gannTbl, 1, 1, "低點往上(乘)\\n[" + str.tostring(pivotLow, "#.#") + "]", text_color=color.lime, bgcolor=color.new(#064e3b, 30))
    table.cell(gannTbl, 2, 1, "高點往下(除)\\n[" + str.tostring(pivotHigh, "#.#") + "]", text_color=color.red, bgcolor=color.new(#7f1d1d, 30))
    mults = array.from(1.0595, 1.08, 1.1225, 1.144, 1.1664, 1.2121, 1.2355)
    for i = 0 to array.size(mults) - 1
        m = array.get(mults, i)
        table.cell(gannTbl, 0, i + 2, str.tostring(m), text_color=color.white)
        table.cell(gannTbl, 1, i + 2, str.tostring(pivotLow * m, "#.#"), text_color=color.lime, bgcolor=color.new(#064e3b, 65))
        table.cell(gannTbl, 2, i + 2, str.tostring(pivotHigh / m, "#.#"), text_color=color.fuchsia, bgcolor=color.new(#7f1d1d, 65))
`;

const formatPrice = (val: number) => {
  if (!Number.isFinite(val) || val <= 0) return '-';
  if (val >= 100) return val.toFixed(1);
  if (val >= 1) return val.toFixed(3);
  return val.toFixed(5);
};

export function BigFishProGannPanel({ symbol, timeframe, data }: BigFishProGannPanelProps) {
  const [customLow, setCustomLow] = useState<string>('');
  const [customHigh, setCustomHigh] = useState<string>('');
  const [showPineModal, setShowPineModal] = useState(false);
  const [copiedPine, setCopiedPine] = useState(false);

  // 切換標的或週期時清空自訂基準點，改回自動偵測當下波段高低點
  useEffect(() => {
    setCustomLow('');
    setCustomHigh('');
  }, [symbol, timeframe]);

  const analysis = useMemo(() => {
    // 排除最後一根未收盤 K 線，確保訊號與防守線不重繪
    const closedData = data.length > 60 ? data.slice(0, -1) : data;
    if (closedData.length < 52) return null;

    const candles: Candle[] = closedData.map(d => ({
      openTime: d.timestamp,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
    const indicators = new IndicatorCache(candles);
    const lastIdx = candles.length - 1;
    const latestSig = evaluateBigFishProAt(candles, lastIdx, indicators, bigFishPro.defaultParams);
    const st = indicators.bigFish();
    const isGreen = st.direction[lastIdx] === -1;

    // 找出最近一次在歷史已收盤 K 線觸發的一號槍或二號槍買點
    let lastTriggered: {
      barTime: number;
      mode: 'BOTTOM_FLIP' | 'TREND_RESONANCE';
      entryPrice: number;
      stopPrice: number;
      oneRPrice: number;
      gann1: number;
      gann2: number;
    } | null = null;

    for (let i = lastIdx; i >= Math.max(50, lastIdx - 120); i--) {
      const sig = i === lastIdx ? latestSig : evaluateBigFishProAt(candles, i, indicators, bigFishPro.defaultParams);
      if (sig.triggered && (sig.mode === 'BOTTOM_FLIP' || sig.mode === 'TREND_RESONANCE')) {
        lastTriggered = {
          barTime: candles[i].openTime,
          mode: sig.mode,
          entryPrice: sig.closePrice,
          stopPrice: sig.supertrend,
          oneRPrice: sig.closePrice + sig.stopDistance,
          gann1: sig.gannTable.levels[0]?.upTarget ?? sig.closePrice * 1.0595,
          gann2: sig.gannTable.levels[1]?.upTarget ?? sig.closePrice * 1.08,
        };
        break;
      }
    }

    return {
      latestSig,
      isGreen,
      lastClose: candles[lastIdx].close,
      lastTriggered,
    };
  }, [data]);

  if (!analysis) return null;

  const { latestSig, isGreen, lastClose, lastTriggered } = analysis;
  const parsedLow = Number(customLow);
  const parsedHigh = Number(customHigh);
  const activeLow = Number.isFinite(parsedLow) && parsedLow > 0 ? parsedLow : latestSig.gannTable.pivotLow;
  const activeHigh = Number.isFinite(parsedHigh) && parsedHigh > 0 ? parsedHigh : latestSig.gannTable.pivotHigh;
  const gannTable = calculateGannVolatilityTable(activeLow, activeHigh);

  const stopDistPct = latestSig.supertrend > 0
    ? (((lastClose - latestSig.supertrend) / lastClose) * 100)
    : 0;
  const oneRPrice = lastClose + latestSig.stopDistance;

  const handleCopyPine = async () => {
    try {
      await navigator.clipboard.writeText(PINE_SCRIPT_PRO_V5);
      setCopiedPine(true);
      setTimeout(() => setCopiedPine(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  return (
    <div className="p-3 md:p-4 bg-[#141414] text-[#E4E3E0] border border-[#141414] rounded-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Fish className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold tracking-wide">
            吃大魚 Pro · 15m 勝利方程式 ＆ 江恩波動率倍數表格
          </span>
          <span
            className={cn(
              'text-[10px] font-mono px-2 py-0.5 rounded-sm font-bold',
              isGreen
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
            )}
          >
            {isGreen ? '🟢 Supertrend 綠線多頭護航' : '🔴 Supertrend 紅線壓制（防雙巴保護中）'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowPineModal(prev => !prev)}
          className="text-[10px] font-mono px-2.5 py-1 rounded-sm border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 flex items-center gap-1.5 transition-colors"
        >
          <Code2 className="w-3.5 h-3.5" />
          {showPineModal ? '收起 TradingView Pro 腳本' : '複製 TradingView 吃大魚 Pro 腳本'}
        </button>
      </div>

      {showPineModal && (
        <div className="mb-4 p-3 bg-black/60 border border-emerald-500/30 rounded-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono text-emerald-300">
              TradingView Pine Script v5 — 吃大魚策略 Pro 3.0（廢除紅線下假金叉雙巴 ＋ 1R 自動保本 ＋ 江恩波動率表格）
            </span>
            <button
              type="button"
              onClick={handleCopyPine}
              className="text-[10px] font-mono px-2.5 py-1 bg-emerald-500 text-[#141414] font-bold rounded-sm flex items-center gap-1 hover:bg-emerald-400"
            >
              {copiedPine ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedPine ? '已複製腳本' : '一鍵複製 Pine Script'}
            </button>
          </div>
          <pre className="text-[10px] font-mono text-[#E4E3E0]/80 overflow-x-auto max-h-48 p-2 bg-black/80 rounded border border-white/10">
            {PINE_SCRIPT_PRO_V5}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* 左側：吃大魚 Pro 勝利方程式即時診斷與買點雷達 */}
        <div className="xl:col-span-7 flex flex-col justify-between gap-3 bg-white/5 border border-white/10 rounded-sm p-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider opacity-60 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                當前 K 線勝利方程式診斷 ({symbol} · {timeframe})
              </span>
              <span className="text-[10px] font-mono text-emerald-400">
                已收盤價 {formatPrice(lastClose)}
              </span>
            </div>

            <div className="p-2.5 rounded-sm bg-black/40 border border-white/10 text-xs leading-relaxed">
              <div className="font-bold text-emerald-300 mb-1">{latestSig.reason}</div>
              <div className="text-[11px] opacity-75">
                {isGreen
                  ? `目前處於 Supertrend(10,4) 綠線之上（防守價 ${formatPrice(latestSig.supertrend)}，風險距離 ${stopDistPct.toFixed(2)}%）。若在此進場，漲至 ${formatPrice(oneRPrice)}（+1R）即自動推至保本，波段目標看江恩 1.0595x（${formatPrice(gannTable.levels[0]?.upTarget ?? 0)}）與 1.08x（${formatPrice(gannTable.levels[1]?.upTarget ?? 0)}）。`
                  : `目前 Supertrend(10,4) 為紅線空頭壓制（上軌壓力 ${formatPrice(latestSig.supertrend)}，已連續紅線 ${latestSig.priorRedBars} 根）。吃大魚 Pro 嚴格禁止在紅線下因為 MACD 小金叉進場，為您避開盤整連環雙巴！請耐心等待「洗盤滿 12 根後長紅突破翻綠（一號槍）」。`}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
              <div className="p-2 bg-black/30 border border-white/5 rounded-sm">
                <div className="text-[9px] opacity-50">Supertrend 防守/壓力</div>
                <div className={cn('font-bold mt-0.5', isGreen ? 'text-emerald-400' : 'text-rose-400')}>
                  {formatPrice(latestSig.supertrend)}
                </div>
              </div>
              <div className="p-2 bg-black/30 border border-white/5 rounded-sm">
                <div className="text-[9px] opacity-50">EMA200 生命線</div>
                <div className="font-bold text-amber-300 mt-0.5">
                  {formatPrice(latestSig.ema200)}
                </div>
              </div>
              <div className="p-2 bg-black/30 border border-white/5 rounded-sm">
                <div className="text-[9px] opacity-50">1R 自動保本觸發價</div>
                <div className="font-bold text-sky-300 mt-0.5">
                  {isGreen ? formatPrice(oneRPrice) : '等待翻綠'}
                </div>
              </div>
              <div className="p-2 bg-black/30 border border-white/5 rounded-sm">
                <div className="text-[9px] opacity-50">當根實體強度 / 量比</div>
                <div className="font-bold mt-0.5">
                  {Math.round(latestSig.closeStrength * 100)}% / {latestSig.volumeRatio.toFixed(1)}x
                </div>
              </div>
            </div>
          </div>

          {lastTriggered && (
            <div className="p-2.5 rounded-sm bg-emerald-950/30 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  最近觸發訊號：
                  <strong className="text-emerald-300 ml-1">
                    {lastTriggered.mode === 'BOTTOM_FLIP' ? '【一號槍：底部洗盤翻綠】' : '【二號槍：綠線均線共振】'}
                  </strong>
                  （進場 <span className="text-white">{formatPrice(lastTriggered.entryPrice)}</span>｜防守{' '}
                  <span className="text-rose-300">{formatPrice(lastTriggered.stopPrice)}</span>）
                </span>
              </div>
              <div className="text-emerald-300">
                1R 保本 {formatPrice(lastTriggered.oneRPrice)} → 江恩目標 {formatPrice(lastTriggered.gann1)} / {formatPrice(lastTriggered.gann2)}
              </div>
            </div>
          )}
        </div>

        {/* 右側：TradingView 同款「江恩波動率倍數表格」 */}
        <div className="xl:col-span-5 bg-white/5 border border-white/10 rounded-sm p-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold font-mono flex items-center gap-1.5 text-white">
              <Table2 className="w-3.5 h-3.5 text-emerald-400" />
              江恩波動率倍數表格
            </span>
            <div className="flex items-center gap-1.5 text-[10px] font-mono">
              <label className="flex items-center gap-1 text-emerald-300">
                低點:
                <input
                  type="number"
                  step="any"
                  placeholder={formatPrice(latestSig.gannTable.pivotLow)}
                  value={customLow}
                  onChange={e => setCustomLow(e.target.value)}
                  className="w-20 px-1.5 py-0.5 bg-black/60 border border-emerald-500/40 rounded text-white text-[10px]"
                />
              </label>
              <label className="flex items-center gap-1 text-rose-300">
                高點:
                <input
                  type="number"
                  step="any"
                  placeholder={formatPrice(latestSig.gannTable.pivotHigh)}
                  value={customHigh}
                  onChange={e => setCustomHigh(e.target.value)}
                  className="w-20 px-1.5 py-0.5 bg-black/60 border border-rose-500/40 rounded text-white text-[10px]"
                />
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono border-collapse text-center">
              <thead>
                <tr className="border-b border-white/15 bg-black/40">
                  <th className="py-1.5 px-2 text-left text-white/70">波動率倍數</th>
                  <th className="py-1.5 px-2 bg-emerald-950/50 text-emerald-300">
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      低點往上 (乘) [{formatPrice(gannTable.pivotLow)}]
                    </span>
                  </th>
                  <th className="py-1.5 px-2 bg-rose-950/50 text-rose-300">
                    <span className="inline-flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" />
                      高點往下 (除) [{formatPrice(gannTable.pivotHigh)}]
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {gannTable.levels.map((lv, idx) => {
                  const isNextUpTarget =
                    lv.upTarget >= lastClose &&
                    (idx === 0 || gannTable.levels[idx - 1].upTarget < lastClose);
                  return (
                    <tr key={lv.multiple} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-1 px-2 text-left text-white/80 font-bold">
                        {lv.multiple}
                        {idx === 0 && <span className="ml-1 text-[9px] text-amber-300">(減倉)</span>}
                        {idx === 1 && <span className="ml-1 text-[9px] text-emerald-300">(波段)</span>}
                      </td>
                      <td
                        className={cn(
                          'py-1 px-2 font-bold',
                          isNextUpTarget
                            ? 'bg-emerald-500/30 text-emerald-200 underline decoration-emerald-400'
                            : 'bg-emerald-950/25 text-emerald-400'
                        )}
                      >
                        {formatPrice(lv.upTarget)}
                      </td>
                      <td className="py-1 px-2 bg-rose-950/25 text-fuchsia-300 font-bold">
                        {formatPrice(lv.downTarget)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
