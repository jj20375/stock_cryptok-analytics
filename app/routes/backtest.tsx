/**
 * 【詳細繁體中文註解】：策略回測頁
 *
 * 版面:左欄 = 回測設定表單 + 歷史回測列表;右欄 = 績效 KPI + 權益曲線 + K 線標記 + 交易明細。
 * 執行流程(useBacktest hook):建立任務 → 輪詢補資料 → 引擎計算 → 呈現結果。
 */

import { useState } from 'react';
import { redirect, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { AlertTriangle, FlaskConical, RefreshCw } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { getUserId } from '../utils/auth';
import { useBacktest } from '../features/backtest/useBacktest';
import { BacktestForm } from '../features/backtest/components/BacktestForm';
import { BacktestReport } from '../features/backtest/components/BacktestReport';
import { WaveGoalResult } from '../features/backtest/components/WaveGoalResult';
import { EquityCurveChart } from '../features/backtest/components/EquityCurveChart';
import { TradeListTable } from '../features/backtest/components/TradeListTable';
import { BacktestKlinePanel } from '../features/backtest/components/BacktestKlinePanel';
import type { BacktestTrade } from '../features/backtest/types';
import { cn } from '../utils/cn';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any).cloudflare.env;
  const userId = await getUserId(request, env);
  // 未登入導回登入頁(回測任務與結果依 userId 隔離)
  if (!userId) throw redirect('/login');
  return { userId };
}

export default function BacktestPage() {
  const {
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
  } = useBacktest();

  const [selectedTrade, setSelectedTrade] = useState<BacktestTrade | null>(null);

  // 【詳細繁體中文註解】：支援從首頁「Market Hot Picks」一鍵跳轉回測 —
  // 網址帶 ?market=US&symbol=ONDS&strategyId=trend_momentum 時,直接預填表單(不自動送出,
  // 讓使用者仍可先確認回測區間/參數再手動點「開始回測」)。
  const [searchParams] = useSearchParams();
  const initialMarket = searchParams.get('market');
  const initialSymbol = searchParams.get('symbol');
  const initialStrategyId = searchParams.get('strategyId');

  const statusLabel: Record<string, string> = {
    DONE: '完成',
    ERROR: '失敗',
    PENDING: '待執行',
    PREPARING: '補資料中',
    RUNNING: '計算中',
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1600px] mx-auto">
        <header className="flex items-center gap-3 border-b border-[#141414] pb-3">
          <FlaskConical size={22} />
          <div>
            <h1 className="text-xl font-bold font-serif leading-none">策略回測</h1>
            <p className="text-[11px] font-mono opacity-50 mt-1">
              歷史重放驗證策略體質 — 加密貨幣短線(15m/1h/4h)與虛擬幣概念美股(日線)
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* 左欄:設定 + 歷史 */}
          <div className="lg:col-span-1 flex flex-col gap-4">
            <BacktestForm
              strategies={strategies}
              isBusy={isBusy}
              extraUsTickers={usStockTickers}
              initialMarket={initialMarket as 'CRYPTO' | 'US' | 'TW' | null}
              initialSymbol={initialSymbol}
              initialStrategyId={initialStrategyId}
              onSubmit={runBacktestFlow}
            />

            <div className="bg-white/80 border border-[#141414] rounded-sm p-4 flex flex-col gap-2">
              <h2 className="text-sm font-bold font-serif border-b border-[#141414]/20 pb-2">歷史回測</h2>
              {history.length === 0 && (
                <p className="text-[10px] font-mono opacity-40">尚無回測紀錄</p>
              )}
              <div className="flex flex-col gap-1 max-h-72 overflow-y-auto custom-scrollbar">
                {history.map((item) => {
                  const result = item.resultJson ? JSON.parse(item.resultJson) : null;
                  return (
                    <button
                      key={item.id}
                      onClick={() => viewHistoryResult(item.id)}
                      className={cn(
                        'text-left border border-[#141414]/20 rounded-sm p-2 hover:bg-[#141414]/5 transition-colors',
                        detail?.id === item.id && 'border-[#141414] bg-[#141414]/5'
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-mono font-bold">
                          {item.symbol} · {item.interval}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] font-mono',
                            item.status === 'DONE' ? 'opacity-60' : 'text-amber-600'
                          )}
                        >
                          {statusLabel[item.status] ?? item.status}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-0.5">
                        <span className="text-[10px] font-mono opacity-50">{item.strategyId}</span>
                        {result && (
                          <span
                            className={cn(
                              'text-[10px] font-mono font-bold',
                              result.totalReturnPct >= 0 ? 'text-rose-500' : 'text-emerald-600'
                            )}
                          >
                            {result.totalReturnPct >= 0 ? '+' : ''}
                            {result.totalReturnPct}%
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 右欄:結果 */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            {isBusy && (
              <div className="bg-white/80 border border-[#141414] rounded-sm p-8 flex flex-col items-center gap-3">
                <RefreshCw size={24} className="animate-spin" />
                <p className="text-xs font-mono">{phaseMessage || '執行中...'}</p>
                <p className="text-[10px] font-mono opacity-40">
                  {phase === 'preparing' && '首次回測需向交易所補抓歷史 K 線,依區間長度約需數秒至一分鐘'}
                </p>
              </div>
            )}

            {phase === 'error' && (
              <div className="bg-rose-50 border border-rose-400 rounded-sm p-4 flex items-start gap-2">
                <AlertTriangle size={16} className="text-rose-500 mt-0.5" />
                <div>
                  <p className="text-xs font-mono font-bold text-rose-600">回測執行失敗</p>
                  <p className="text-[11px] font-mono text-rose-500 mt-1">{errorMessage}</p>
                </div>
              </div>
            )}

            {phase === 'done' && detail && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold font-serif">
                    {detail.symbol} · {detail.interval} · {detail.strategyId}
                  </h2>
                  <span className="text-[10px] font-mono opacity-50">
                    {new Date(detail.startTime).toLocaleDateString('zh-TW')} ~{' '}
                    {new Date(detail.endTime).toLocaleDateString('zh-TW')}
                  </span>
                </div>
                <BacktestReport detail={detail} />
                <WaveGoalResult detail={detail} />
                {detail.equityCurve && detail.result && (
                  <EquityCurveChart
                    equityCurve={detail.equityCurve}
                    initialCapital={detail.result.initialCapital}
                  />
                )}
                <BacktestKlinePanel
                  klines={klines}
                  trades={trades}
                  selectedTrade={selectedTrade}
                  truncated={klinesTruncated}
                />
                <TradeListTable
                  trades={trades}
                  selectedTradeId={selectedTrade?.id ?? null}
                  onSelectTrade={setSelectedTrade}
                />
                <p className="text-[10px] font-mono opacity-40 leading-relaxed">
                  模擬假設:同根 K 線停損優先於策略出場;滑價與手續費為估計值;SHORT
                  僅為回測模擬(現貨實盤不支援做空);fillMode=nextOpen 時訊號於下一根開盤成交。
                  回測績效不代表未來獲利。
                </p>
              </>
            )}

            {phase === 'idle' && (
              <div className="bg-white/50 border border-dashed border-[#141414]/40 rounded-sm p-12 flex flex-col items-center gap-2">
                <FlaskConical size={32} className="opacity-20" />
                <p className="text-xs font-mono opacity-50">設定左側參數後點「開始回測」</p>
                <p className="text-[10px] font-mono opacity-30">
                  或從歷史回測列表載入過去的結果
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
