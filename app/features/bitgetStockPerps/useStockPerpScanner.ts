/** @file 管理使用者手動掃描、取消與 AI 解讀；部分結果和錯誤明示，卸載停止公開行情請求。 */
import { useEffect, useRef, useState } from 'react';
import type { StockPerpContract } from '../../services/bitgetStockPerps/market';
import { scanStockPerps, explainStockPerpPicks, type StockPerpScanProgress } from '../../services/bitgetStockPerps/scanner';
import type { ScanStrategy } from '../home/types';
import type { Timeframe } from '../../types';

export function useStockPerpScanner(contracts: StockPerpContract[], aiEnabled: boolean) {
  /** 表單選擇與上次結果分開保存，避免改選策略後把舊排名錯標成新規則。 */
  const [strategy, setStrategy] = useState<ScanStrategy>('trend');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [reportSettings, setReportSettings] = useState<{ strategy: ScanStrategy; timeframe: Timeframe } | null>(null);
  const [progress, setProgress] = useState<StockPerpScanProgress | null>(null);
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ai' | 'done' | 'cancelled' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  /** Ref 同步擋住重複啟動；React 尚未提交 disabled 狀態也只能存在一個掃描。 */
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = async () => {
    if (controllerRef.current || !contracts.length) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const actualTimeframe = strategy === 'daily_volume_spike' ? '1d' : timeframe;
    setReportSettings({ strategy, timeframe: actualTimeframe });
    setProgress(null); setMessage(null); setPhase('scanning');
    try {
      const completed = await scanStockPerps(contracts, strategy, actualTimeframe, controller.signal, setProgress);
      controller.signal.throwIfAborted();
      if (aiEnabled && completed.results.length) {
        setPhase('ai');
        try {
          const results = await explainStockPerpPicks(completed.results, actualTimeframe, controller.signal);
          controller.signal.throwIfAborted();
          setProgress({ ...completed, results });
        } catch (error) {
          controller.signal.throwIfAborted();
          setMessage(error instanceof Error ? error.message : 'AI 解讀失敗；技術排名已保留。');
        }
      }
      setPhase('done');
    } catch (error) {
      setPhase(controller.signal.aborted ? 'cancelled' : 'error');
      setMessage(controller.signal.aborted ? '掃描已取消，以下為已檢查商品的部分結果。'
        : error instanceof Error ? error.message : '掃描失敗，請稍後重試。');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  return { strategy, timeframe, reportSettings, progress, phase, message, busy: phase === 'scanning' || phase === 'ai',
    setStrategy: (next: ScanStrategy) => { setStrategy(next); if (next === 'daily_volume_spike') setTimeframe('1d'); },
    setTimeframe, run, cancel: () => controllerRef.current?.abort() };
}
