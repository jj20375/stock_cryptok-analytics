/**
 * 【詳細繁體中文註解】：回測前端狀態機 hook
 *
 * 流程:create(建任務)→ prepare 輪詢(補歷史資料,complete=false 時持續輪詢)
 *       → run(引擎計算)→ 載入結果與 K 線 → done
 * 任一步失敗 → error(顯示後端回傳的錯誤訊息)。
 *
 * 外部 API 副作用註記:prepare 會觸發後端向 Binance / Yahoo 抓歷史資料,
 * 為避免無限輪詢,設有 MAX_PREPARE_POLLS 上限(超過視為異常中止)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BacktestDetail,
  BacktestFormValues,
  BacktestListItem,
  BacktestPhase,
  BacktestTrade,
  ChartKline,
  StrategyMeta,
} from './types';
import { getSymbolsByMarket } from './constants';

// prepare 輪詢上限:2 年 15m 約 7 萬根,每趟最多 4 萬根,理論 2~3 趟即完成;30 趟是絕對安全上限
const MAX_PREPARE_POLLS = 30;

const postJson = async (body: unknown) => {
  const response = await fetch('/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as any;
  if (!response.ok) throw new Error(data?.error || `API 錯誤 (${response.status})`);
  return data;
};

const getJson = async (query: string) => {
  const response = await fetch(`/api/backtest?${query}`);
  const data = (await response.json()) as any;
  if (!response.ok) throw new Error(data?.error || `API 錯誤 (${response.status})`);
  return data;
};

export const useBacktest = () => {
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [history, setHistory] = useState<BacktestListItem[]>([]);
  const [phase, setPhase] = useState<BacktestPhase>('idle');
  const [phaseMessage, setPhaseMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [detail, setDetail] = useState<BacktestDetail | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [klines, setKlines] = useState<ChartKline[]>([]);
  const [klinesTruncated, setKlinesTruncated] = useState(false);
  // Bitget 股票代幣清單(僅供擴充美股標的選單,查詢失敗保持空陣列不影響既有清單)
  const [usStockTickers, setUsStockTickers] = useState<string[]>([]);
  // 防止元件卸載後 setState
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** 載入策略註冊表與歷史回測列表 */
  const loadInitialData = useCallback(async () => {
    try {
      const [strategyRes, listRes] = await Promise.all([
        getJson('strategies=1'),
        getJson('list=1'),
      ]);
      if (!aliveRef.current) return;
      setStrategies(strategyRes.strategies ?? []);
      setHistory(listRes.backtests ?? []);
    } catch (error) {
      console.error('載入回測初始資料失敗:', error);
    }

    // Bitget 標的清單獨立 try/catch:失敗不影響策略/歷史列表的正常載入
    try {
      const tickerRes = await getJson('usStockTickers=1');
      if (!aliveRef.current) return;
      setUsStockTickers(tickerRes.tickers ?? []);
    } catch (error) {
      console.error('載入 Bitget 美股標的清單失敗:', error);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  /** 載入指定回測的完整結果(詳情 + 明細 + K 線) */
  const loadResult = useCallback(async (id: number) => {
    setPhase('loading_result');
    setPhaseMessage('載入回測結果中...');
    const [detailRes, klineRes] = await Promise.all([
      getJson(`id=${id}`),
      getJson(`id=${id}&klines=1`),
    ]);
    if (!aliveRef.current) return;
    setDetail(detailRes.backtest);
    setTrades(detailRes.trades ?? []);
    setKlines(klineRes.klines ?? []);
    setKlinesTruncated(!!klineRes.truncated);
    setPhase('done');
    setPhaseMessage('');
  }, []);

  /** 主流程:建立 → 補資料 → 計算 → 載入結果 */
  const runBacktestFlow = useCallback(
    async (form: BacktestFormValues) => {
      setErrorMessage('');
      setDetail(null);
      setTrades([]);
      setKlines([]);

      try {
        // 1) 建立任務
        setPhase('creating');
        setPhaseMessage('建立回測任務...');
        const endTime = Date.now();
        const startTime = endTime - form.rangeDays * 24 * 60 * 60 * 1000;
        const symbolOption = getSymbolsByMarket(form.market).find(
          (s) => s.symbol === form.symbol
        );

        const { id } = await postJson({
          action: 'create',
          strategyId: form.strategyId,
          symbol: form.symbol,
          market: form.market,
          interval: form.interval,
          startTime,
          endTime,
          params: {
            initialCapital: form.initialCapital,
            feeRate: form.feeRatePct / 100,
            slippageBps: form.slippageBps,
            fillMode: form.fillMode,
            maxRiskPerTradePct: form.maxRiskPerTradePct,
            maxPositionSizePct: form.maxPositionSizePct,
            precision: symbolOption?.precision,
            strategyParams: form.strategyParams,
          },
        });

        // 2) prepare 輪詢補資料
        setPhase('preparing');
        for (let poll = 1; poll <= MAX_PREPARE_POLLS; poll++) {
          setPhaseMessage(`補抓歷史資料中(第 ${poll} 趟)...`);
          const prep = await postJson({ action: 'prepare', id });
          if (!aliveRef.current) return;
          setPhaseMessage(prep.message || '');
          if (prep.complete) break;
          if (poll === MAX_PREPARE_POLLS) {
            throw new Error('補資料輪詢超過上限,請稍後重試或縮短回測區間');
          }
        }

        // 3) 執行計算
        setPhase('running');
        setPhaseMessage('回測引擎逐根重放計算中...');
        await postJson({ action: 'run', id });

        // 4) 載入結果
        await loadResult(id);
        loadInitialData(); // 重新整理歷史列表
      } catch (error) {
        if (!aliveRef.current) return;
        setPhase('error');
        setErrorMessage((error as Error).message);
      }
    },
    [loadResult, loadInitialData]
  );

  /** 從歷史列表載入舊結果 */
  const viewHistoryResult = useCallback(
    async (id: number) => {
      setErrorMessage('');
      try {
        await loadResult(id);
      } catch (error) {
        setPhase('error');
        setErrorMessage((error as Error).message);
      }
    },
    [loadResult]
  );

  const isBusy = phase === 'creating' || phase === 'preparing' || phase === 'running' || phase === 'loading_result';

  return {
    strategies,
    history,
    phase,
    phaseMessage,
    errorMessage,
    detail,
    trades,
    klines,
    klinesTruncated,
    usStockTickers,
    isBusy,
    runBacktestFlow,
    viewHistoryResult,
  };
};
