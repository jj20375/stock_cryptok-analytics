/** @component 市場、標的與策略選擇；成交設定交由子元件，資料由回測 API 驗證及保存。 */
/**
 * 【詳細繁體中文註解】：回測設定表單
 * 市場 → 標的 → 策略 → 週期 → 範圍 → 進階設定(資金/費率/滑價/成交模式)→ 策略參數(動態表單)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { BacktestSymbolPicker } from './BacktestSymbolPicker';
import { BacktestMarketPicker, BacktestSettings, getExecutionFields, type ExecutionSettings } from './BacktestSettings';
import { NumericInput } from '../../../components/NumericInput';
import { numericFieldError, validateNumericInputs } from '../../../utils/numericInput';
import { strategyParamError } from '../../../services/strategy/parameters';
import { cn } from '../../../utils/cn';
import { getSymbolsByMarket, mergeExtraUsTickers, RANGE_OPTIONS } from '../constants';
import type { BacktestFormValues, StrategyMeta } from '../types';

interface BacktestFormProps {
  strategies: StrategyMeta[];
  isBusy: boolean;
  /** Bitget 股票代幣清單(僅擴充美股標的選單用,可能為空陣列) */
  extraUsTickers?: string[];
  /** 由網址參數帶入的初始市場/代號/策略(例如首頁 Hot Picks 一鍵跳轉回測),僅套用一次 */
  initialMarket?: 'CRYPTO' | 'US' | 'TW' | null;
  initialSymbol?: string | null;
  initialStrategyId?: string | null;
  initialFutures?: boolean;
  onSubmit: (values: BacktestFormValues) => void;
}

const VALID_MARKETS = ['CRYPTO', 'US', 'TW'] as const;

/** 依市場慣例正規化代號(加密貨幣支援 BTC/USD、BTC-USD 自動轉為 BTCUSDT) */
const normalizeSymbol = (raw: string, market: 'CRYPTO' | 'US' | 'TW'): string => {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return '';
  if (market === 'CRYPTO') {
    const cleaned = trimmed.replace(/[\/\-]USDT$/, '').replace(/[\/\-]USD$/, '').replace(/[^A-Z0-9]/g, '');
    return cleaned.endsWith('USDT') ? cleaned : `${cleaned}USDT`;
  }
  return trimmed;
};

export function BacktestForm({
  strategies,
  isBusy,
  extraUsTickers = [],
  initialMarket,
  initialSymbol,
  initialStrategyId,
  initialFutures = false,
  onSubmit,
}: BacktestFormProps) {
  const validInitialMarket = VALID_MARKETS.includes(initialMarket as any)
    ? (initialMarket as 'CRYPTO' | 'US' | 'TW')
    : 'CRYPTO';

  const [market, setMarket] = useState<'CRYPTO' | 'US' | 'TW'>(validInitialMarket);
  const [symbol, setSymbol] = useState(() =>
    initialSymbol ? normalizeSymbol(initialSymbol, validInitialMarket) : 'BTCUSDT'
  );
  // 【詳細繁體中文註解】：是否使用「自行輸入代號」模式,取代下拉選單(供清單外標的回測,
  // 網址帶入 symbol 參數時預設開啟,避免掛載時的市場切換 effect 把代號洗回清單第一筆)
  const [useCustomSymbol, setUseCustomSymbol] = useState(() => !!initialSymbol);
  const [customSymbolInput, setCustomSymbolInput] = useState(() => initialSymbol ?? '');
  const [strategyId, setStrategyId] = useState(() => initialStrategyId ?? '');
  const [interval, setInterval] = useState('4h');
  const [rangeDays, setRangeDays] = useState(180);
  const [futures, setFutures] = useState(initialFutures);
  const [futuresInstrument, setFuturesInstrument] = useState<'BITGET_USDT_PERP' | 'BYBIT_USDT_PERP'>('BITGET_USDT_PERP');
  const [leverage, setLeverage] = useState(3);
  const [direction, setDirection] = useState<'BOTH' | 'LONG' | 'SHORT'>('BOTH');
  /** 成交假設集中保存；切換市場僅重設該市場的費率，不重設使用者資金。 */
  const [execution, setExecution] = useState<ExecutionSettings>({ initialCapital: 1000, feeRatePct: initialFutures ? 0.06 : 0.1,
    sellTaxRatePct: 0, slippageBps: 5, fillMode: 'nextOpen', maxRiskPerTradePct: initialFutures ? 0.25 : 1, maxPositionSizePct: initialFutures ? 5 : 50 });
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>({});
  /** 原生form以外的回測按鈕也須驗證；收合進階欄位後仍由狀態檢查其邊界。 */
  const formRef = useRef<HTMLDivElement>(null);

  const symbols = useMemo(() => {
    const base = getSymbolsByMarket(market);
    // 美股市場才合併 Bitget 股票代幣清單(擴充選單,不影響資料來源仍為 Yahoo)
    return market === 'US' ? mergeExtraUsTickers(base, extraUsTickers) : base;
  }, [market, extraUsTickers]);
  const marketStrategies = useMemo(
    () => strategies.filter((s) => s.markets.includes(market) && (futures ? s.supportedIntervals.includes('1h') && (s.futuresOnly || s.id === 'big_fish' || s.id === 'big_fish_pro') : !s.futuresOnly)),
    [strategies, market, futures]
  );
  const selectedStrategy = marketStrategies.find((s) => s.id === strategyId) ?? null;
  // 美股/台股僅支援日線(Yahoo 歷史資料限制,回測不走即時聚合)
  const availableIntervals = useMemo(() => {
    if (!selectedStrategy) return [];
    return futures ? ['1h'] : market !== 'CRYPTO'
      ? selectedStrategy.supportedIntervals.filter((i) => i === '1d')
      : selectedStrategy.supportedIntervals;
  }, [selectedStrategy, market, futures]);

  /** 切換市場時重設交易費及 SELL 稅率；個別商品差異可在進階設定覆寫。 */
  // 標的只在「清單模式」下才重設為第一筆,避免切換市場時洗掉使用者自訂輸入的代號。
  useEffect(() => {
    if (!useCustomSymbol) {
      const list = getSymbolsByMarket(market);
      setSymbol(list[0]?.symbol ?? '');
    }
    setExecution(previous => ({ ...previous, feeRatePct: market === 'US' ? 0 : market === 'TW' ? 0.1425 : 0.1, sellTaxRatePct: market === 'TW' ? 0.3 : 0 }));
  }, [market]);
  useEffect(() => {
    if (futures) {
      setMarket('CRYPTO'); setInterval('1h');
      setStrategyId(initialStrategyId?.startsWith('futures_') || initialStrategyId === 'big_fish_pro' ? initialStrategyId : 'futures_trend_retest');
      setExecution(previous => ({ ...previous, feeRatePct: 0.06, sellTaxRatePct: 0, maxRiskPerTradePct: 0.25, maxPositionSizePct: 5, fillMode: 'nextOpen' }));
    }
  }, [futures]);

  /** 將使用者輸入的自訂代號正規化(依市場慣例),更新後同步寫入 symbol */
  const applyCustomSymbol = (raw: string) => {
    setCustomSymbolInput(raw);
    setSymbol(normalizeSymbol(raw, market));
  };

  const toggleCustomSymbol = (custom: boolean) => {
    setUseCustomSymbol(custom);
    if (custom) {
      // 切到自訂模式:若已有輸入過的內容就套用,否則先清空等待輸入
      applyCustomSymbol(customSymbolInput);
    } else {
      const list = getSymbolsByMarket(market);
      setSymbol(list[0]?.symbol ?? '');
    }
  };

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
    // 波段研究預設限制單幣曝險；選定此模式時改用下一根成交，避免樂觀成交假設。
    if (selectedStrategy.id === 'crypto_wave') {
      setExecution(previous => ({ ...previous, maxRiskPerTradePct: 1, maxPositionSizePct: 25, fillMode: 'nextOpen' }));
    }
    if (selectedStrategy.requiresNextOpen) setExecution(previous => ({ ...previous, fillMode: 'nextOpen' }));
    if (!availableIntervals.includes(interval)) {
      setInterval(availableIntervals[0] ?? '1d');
    }
  }, [selectedStrategy?.id, availableIntervals.join(',')]);

  const invalidExecution = getExecutionFields(futures).find(field => !!numericFieldError(execution[field.key], field));
  const numericError = (selectedStrategy && strategyParamError(selectedStrategy, strategyParams))
    || (invalidExecution && `${invalidExecution.label}：${numericFieldError(execution[invalidExecution.key], invalidExecution)}`)
    || (futures && numericFieldError(leverage, { min: 1, max: 75, step: 1 }));
  const invalidNumbers = !!numericError;
  const handleSubmit = () => {
    if (!selectedStrategy || !symbol || isBusy || !validateNumericInputs(formRef.current) || invalidNumbers) return;
    onSubmit({
      market,
      symbol,
      strategyId: selectedStrategy.id,
      interval,
      rangeDays,
      ...execution,
      strategyParams,
      ...(futures ? { futures: { instrument: futuresInstrument, leverage, direction } } : {}),
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
    <div ref={formRef} className="bg-white/80 border border-[#141414] rounded-sm p-4 flex flex-col gap-4">
      <h2 className="text-sm font-bold font-serif border-b border-[#141414]/20 pb-2">回測設定</h2>
      <label className="text-xs flex gap-2 items-center"><input type="checkbox" checked={futures} onChange={event => setFutures(event.target.checked)} />USDT 永續合約研究</label>
      {futures && <fieldset className="border p-2 flex flex-col gap-2 text-xs">
        <legend>合約研究設定</legend>
        <label>行情來源 <select value={futuresInstrument} onChange={event => setFuturesInstrument(event.target.value as typeof futuresInstrument)} className={selectClass}>
          <option value="BITGET_USDT_PERP">Bitget 永續</option><option value="BYBIT_USDT_PERP">Bybit 永續（研究比較）</option>
        </select></label>
        {/* 75倍只代表研究上限；共用引擎仍依商品級距與停損緩衝降低實際倍數。 */}
        <label>槓桿上限 <NumericInput aria-label="研究槓桿上限" min="1" max="75" step="1" value={leverage} onValueChange={setLeverage} className={selectClass} /></label>
        <label>交易方向 <select value={direction} onChange={event => setDirection(event.target.value as typeof direction)} className={selectClass}><option value="BOTH">多空雙向研究</option><option value="LONG">僅做多</option><option value="SHORT" disabled={!selectedStrategy?.supportsShort}>僅做空</option></select></label>
        <p>{selectedStrategy?.id === 'futures_big_fish' ? '1H吃大魚Pine條件，僅做多，沒有4H進場濾網。' : '4H 判斷盤勢、1H 確認。'}預設費率 0.06% 是研究假設，請在進階設定填入你的實際帳戶費率。風險上限 0.25%、名目部位上限 5%。</p>
      </fieldset>}
      {selectedStrategy?.id === 'crypto_wave' && <p className="text-xs text-amber-800">
        翻倍僅為研究目標。預設單筆風險 1%、單幣上限 25%，可在進階設定調整；請分開驗證不同幣種及行情區間。
      </p>}

      <BacktestMarketPicker market={market} onChange={value => { setMarket(value); if (value !== 'CRYPTO') setFutures(false); }} chipClass={chipClass} />

      <BacktestSymbolPicker market={market} futures={futures} custom={useCustomSymbol} input={customSymbolInput} symbol={symbol}
        symbols={symbols} onCustomChange={toggleCustomSymbol} onInputChange={applyCustomSymbol} onSymbolChange={setSymbol} />

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
        <div className="flex gap-1 flex-wrap">
          {/* 公開費率約九十天，研究保留前兩次結算，加入89天而不改動原有3M快捷鍵。 */}
          {[...RANGE_OPTIONS, ...(futures ? [{ label: '89D', days: 89 }] : [])].filter(option => !futures || option.days <= 366).sort((a, b) => a.days - b.days).map((option) => (
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

      <BacktestSettings strategy={selectedStrategy} params={strategyParams} execution={execution} market={market} futures={futures}
        onParamChange={(key, value) => setStrategyParams(previous => ({ ...previous, [key]: value }))}
        onExecutionChange={change => setExecution(previous => ({ ...previous, ...change }))} />

      <button
        onClick={handleSubmit}
        disabled={isBusy || !selectedStrategy || invalidNumbers}
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
      {invalidNumbers && <p role="status" className="text-xs text-rose-600">{numericError}；請修正欄位數值後再開始回測。</p>}

      <p className="text-[10px] leading-relaxed opacity-50">
        ⚠️ 回測績效基於歷史資料與模擬假設(停損優先、估計滑價/手續費、SHORT 僅模擬),不代表未來獲利。
      </p>
    </div>
  );
}
