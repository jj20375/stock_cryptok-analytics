/**
 * 【詳細繁體中文註解】：回測設定表單
 * 市場 → 標的 → 策略 → 週期 → 範圍 → 進階設定(資金/費率/滑價/成交模式)→ 策略參數(動態表單)
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Play, RefreshCw } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { getSymbolsByMarket, mergeExtraUsTickers, RANGE_OPTIONS } from '../constants';
import type { BacktestFormValues, StrategyMeta } from '../types';

interface BacktestFormProps {
  strategies: StrategyMeta[];
  isBusy: boolean;
  /** Bitget 股票代幣清單(僅擴充美股標的選單用,可能為空陣列) */
  extraUsTickers?: string[];
  onSubmit: (values: BacktestFormValues) => void;
}

export function BacktestForm({ strategies, isBusy, extraUsTickers = [], onSubmit }: BacktestFormProps) {
  const [market, setMarket] = useState<'CRYPTO' | 'US' | 'TW'>('CRYPTO');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [strategyId, setStrategyId] = useState('');
  const [interval, setInterval] = useState('4h');
  const [rangeDays, setRangeDays] = useState(180);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [initialCapital, setInitialCapital] = useState(1000);
  const [feeRatePct, setFeeRatePct] = useState(0.1);
  const [slippageBps, setSlippageBps] = useState(5);
  const [fillMode, setFillMode] = useState<'nextOpen' | 'close'>('nextOpen');
  const [maxRiskPerTradePct, setMaxRiskPerTradePct] = useState(1);
  const [maxPositionSizePct, setMaxPositionSizePct] = useState(50);
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>({});

  const symbols = useMemo(() => {
    const base = getSymbolsByMarket(market);
    // 美股市場才合併 Bitget 股票代幣清單(擴充選單,不影響資料來源仍為 Yahoo)
    return market === 'US' ? mergeExtraUsTickers(base, extraUsTickers) : base;
  }, [market, extraUsTickers]);
  const marketStrategies = useMemo(
    () => strategies.filter((s) => s.markets.includes(market)),
    [strategies, market]
  );
  const selectedStrategy = marketStrategies.find((s) => s.id === strategyId) ?? null;
  // 美股/台股僅支援日線(Yahoo 歷史資料限制,回測不走即時聚合)
  const availableIntervals = useMemo(() => {
    if (!selectedStrategy) return [];
    return market !== 'CRYPTO'
      ? selectedStrategy.supportedIntervals.filter((i) => i === '1d')
      : selectedStrategy.supportedIntervals;
  }, [selectedStrategy, market]);

  // 切換市場時重設標的/費率預設(美股免佣 → 0;台股約 0.1425% 手續費,未計入賣出證交稅 0.3%)
  useEffect(() => {
    const list = getSymbolsByMarket(market);
    setSymbol(list[0]?.symbol ?? '');
    setFeeRatePct(market === 'US' ? 0 : market === 'TW' ? 0.1425 : 0.1);
  }, [market]);

  // 策略清單載入或切換市場後,自動選第一個可用策略
  useEffect(() => {
    if (marketStrategies.length > 0 && !marketStrategies.some((s) => s.id === strategyId)) {
      setStrategyId(marketStrategies[0].id);
    }
  }, [marketStrategies, strategyId]);

  // 切換策略時重設參數為預設值,並確保週期合法
  useEffect(() => {
    if (!selectedStrategy) return;
    setStrategyParams({ ...selectedStrategy.defaultParams });
    if (!availableIntervals.includes(interval)) {
      setInterval(availableIntervals[0] ?? '1d');
    }
  }, [selectedStrategy?.id, availableIntervals.join(',')]);

  const handleSubmit = () => {
    if (!selectedStrategy || !symbol || isBusy) return;
    onSubmit({
      market,
      symbol,
      strategyId: selectedStrategy.id,
      interval,
      rangeDays,
      initialCapital,
      feeRatePct,
      slippageBps,
      fillMode,
      maxRiskPerTradePct,
      maxPositionSizePct,
      strategyParams,
    });
  };

  const selectClass =
    'w-full border border-[#141414] bg-white px-2 py-1.5 text-xs font-mono rounded-sm focus:outline-none';
  const labelClass = 'text-[10px] font-mono font-bold uppercase opacity-50';
  const chipClass = (active: boolean) =>
    cn(
      'px-2 py-1 text-[10px] font-mono border border-[#141414] transition-all rounded-sm',
      active ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'
    );

  return (
    <div className="bg-white/80 border border-[#141414] rounded-sm p-4 flex flex-col gap-4">
      <h2 className="text-sm font-bold font-serif border-b border-[#141414]/20 pb-2">回測設定</h2>

      {/* 市場切換 */}
      <div className="flex flex-col gap-1">
        <span className={labelClass}>市場</span>
        <div className="flex gap-1">
          <button className={chipClass(market === 'CRYPTO')} onClick={() => setMarket('CRYPTO')}>
            加密貨幣
          </button>
          <button className={chipClass(market === 'US')} onClick={() => setMarket('US')}>
            美股
          </button>
          <button className={chipClass(market === 'TW')} onClick={() => setMarket('TW')}>
            台股
          </button>
        </div>
        {market === 'US' && (
          <p className="text-[9px] font-mono opacity-40 mt-1">
            含虛擬幣概念股(COIN/MSTR 等)與一般大型股,可任意搭配已註冊策略
          </p>
        )}
      </div>

      {/* 標的 */}
      <div className="flex flex-col gap-1">
        <span className={labelClass}>標的</span>
        <select className={selectClass} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {symbols.map((s) => (
            <option key={s.symbol} value={s.symbol}>
              {s.name} ({s.symbol})
            </option>
          ))}
        </select>
      </div>

      {/* 策略 */}
      <div className="flex flex-col gap-1">
        <span className={labelClass}>策略</span>
        <select
          className={selectClass}
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
        >
          {marketStrategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {selectedStrategy && (
          <p className="text-[10px] leading-relaxed opacity-60 mt-1">{selectedStrategy.description}</p>
        )}
      </div>

      {/* 週期與範圍 */}
      <div className="flex flex-col gap-1">
        <span className={labelClass}>K 線週期</span>
        <div className="flex gap-1 flex-wrap">
          {availableIntervals.map((option) => (
            <button key={option} className={chipClass(interval === option)} onClick={() => setInterval(option)}>
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className={labelClass}>回測範圍</span>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.label}
              className={chipClass(rangeDays === option.days)}
              onClick={() => setRangeDays(option.days)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 策略參數(動態表單) */}
      {selectedStrategy && selectedStrategy.paramMeta.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={labelClass}>策略參數</span>
          <div className="grid grid-cols-2 gap-2">
            {selectedStrategy.paramMeta.map((meta) => (
              <label key={meta.key} className="flex flex-col gap-0.5" title={meta.description}>
                <span className="text-[10px] font-mono opacity-70">{meta.label}</span>
                <input
                  type="number"
                  className={selectClass}
                  value={strategyParams[meta.key] ?? ''}
                  min={meta.min}
                  max={meta.max}
                  step={meta.step}
                  onChange={(e) =>
                    setStrategyParams((prev) => ({ ...prev, [meta.key]: Number(e.target.value) }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 進階設定 */}
      <button
        className="flex items-center gap-1 text-[10px] font-mono uppercase opacity-60 hover:opacity-100"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        進階設定(資金 / 成本 / 成交模式)
      </button>
      {showAdvanced && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-mono opacity-70">初始資金 (USDT/USD)</span>
            <input type="number" className={selectClass} value={initialCapital} min={100}
              onChange={(e) => setInitialCapital(Number(e.target.value))} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-mono opacity-70">手續費率 %(單邊)</span>
            <input type="number" className={selectClass} value={feeRatePct} min={0} step={0.01}
              onChange={(e) => setFeeRatePct(Number(e.target.value))} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-mono opacity-70">滑價 (bps)</span>
            <input type="number" className={selectClass} value={slippageBps} min={0} step={1}
              onChange={(e) => setSlippageBps(Number(e.target.value))} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-mono opacity-70">成交模式</span>
            <select className={selectClass} value={fillMode}
              onChange={(e) => setFillMode(e.target.value as 'nextOpen' | 'close')}>
              <option value="nextOpen">下一根開盤(保守,無前視)</option>
              <option value="close">訊號當根收盤(對齊實盤)</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-mono opacity-70">單筆風險 %</span>
            <input type="number" className={selectClass} value={maxRiskPerTradePct} min={0.1} step={0.1}
              onChange={(e) => setMaxRiskPerTradePct(Number(e.target.value))} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-mono opacity-70">最大倉位 %</span>
            <input type="number" className={selectClass} value={maxPositionSizePct} min={1} max={100} step={1}
              onChange={(e) => setMaxPositionSizePct(Number(e.target.value))} />
          </label>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={isBusy || !selectedStrategy}
        className={cn(
          'flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono font-bold border border-[#141414] rounded-sm transition-all',
          isBusy
            ? 'opacity-50 cursor-not-allowed'
            : 'bg-[#141414] text-[#E4E3E0] hover:opacity-80'
        )}
      >
        {isBusy ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
        {isBusy ? '回測執行中...' : '開始回測'}
      </button>

      <p className="text-[10px] leading-relaxed opacity-50">
        ⚠️ 回測績效基於歷史資料與模擬假設(停損優先、估計滑價/手續費、SHORT 僅模擬),不代表未來獲利。
      </p>
    </div>
  );
}
