/** @file TradingView 訊號績效頁：紙上配對報酬與原始訊號稽核；只呈現觀察結果，不下單。 */
import { useMemo, useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { loadTradingviewSignals } from '../services/tradingview/loader.server';
import { filterTrades, summarizeBySymbol, summarizeTrades } from '../services/tradingview/performance';
import { PerformanceCards, SymbolTable } from '../features/tradingviewSignals/PerformanceCards';
import { SignalLogTable, TradeTable } from '../features/tradingviewSignals/DetailTables';

export const loader = loadTradingviewSignals;

const MARKET_FILTERS: Array<[string, string]> = [['all', '全部'], ['tw_stock', '台股'], ['us_stock', '美股'], ['crypto', '虛擬幣歷史']];

export default function TradingviewSignalsPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [market, setMarket] = useState('all');
  const [symbol, setSymbol] = useState('');

  const filtered = useMemo(() => filterTrades(data.trades, { market, symbol }), [data.trades, market, symbol]);
  const summary = useMemo(() => summarizeTrades(filtered), [filtered]);
  const bySymbol = useMemo(() => summarizeBySymbol(filtered), [filtered]);

  return <AppLayout><div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
    <header className="flex flex-wrap justify-between items-start gap-4">
      <div><p className="text-xs tracking-widest opacity-60 mb-2">TRADINGVIEW SIGNALS</p>
        <h1 className="text-3xl font-bold">TradingView 訊號績效</h1>
        <p className="text-sm mt-3 opacity-75">外部策略訊號的紙上交易紀錄 · 進出場自動配對 · 可依市場與標的篩選</p></div>
      <button className="border border-current rounded px-4 py-2 text-sm" disabled={revalidator.state !== 'idle'}
        onClick={() => revalidator.revalidate()}>{revalidator.state === 'idle' ? '更新畫面' : '讀取中…'}</button>
    </header>

    <section className="rounded-xl border border-black/15 bg-white/70 p-4 text-sm space-y-2">
      <p><strong>這個數字代表什麼：</strong>把 TradingView 實際送達的進場與出場訊號配對成一筆交易，以訊號當下的價格計算報酬。這是「真的有觸發並送到」的紀錄，跟 TradingView 策略回測不同——包含實際延遲與漏送。</p>
      <p><strong>配對規則：</strong>BUY／LONG 開多、SHORT 開空、SELL／CLOSE／EXIT 平倉；沒有持倉時的 SELL 視為開空。同方向重複進場只記第一筆，不支援加碼與反手。</p>
      <p><strong>累積報酬（複利）</strong>假設每次全額投入單一部位、依出場時間連乘；<strong>合計（等權重）</strong>則是每筆固定金額的報酬加總。兩者並列避免單一數字誤導。</p>
      <p className="opacity-70">未扣手續費、滑價與稅費，樣本少時不代表已驗證勝率。原始訊號紀錄保留 {data.signalRetentionDays} 天，配對後的交易紀錄保留 {data.tradeRetentionDays} 天。</p>
      {!data.webhookEnabled
        ? <p className="text-amber-800">TradingView 外部訊號已停用，此頁保留歷史稽核；新的台股、美股訊號由系統雷達自行計算。</p>
        : !data.webhookConfigured && <p className="text-amber-800">尚未設定 TRADINGVIEW_WEBHOOK_SECRET，端點會拒絕所有請求。</p>}
    </section>

    {data.error && <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-4">{data.error}</p>}

    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap gap-2" aria-label="市場分類">{MARKET_FILTERS.map(([value, label]) =>
        <button key={value} aria-pressed={market === value} onClick={() => setMarket(value)}
          className={`rounded-full border border-black/20 px-4 py-2 text-sm ${market === value ? 'bg-[#141414] text-white' : 'bg-white/50'}`}>{label}</button>)}</div>
      <input aria-label="搜尋標的" placeholder="搜尋標的，例如 SOL 或 2330" value={symbol}
        onChange={event => setSymbol(event.target.value)}
        className="border border-black/20 bg-white/70 rounded px-3 py-2 text-sm" />
    </div>

    <PerformanceCards summary={summary} />
    <SymbolTable rows={bySymbol} />
    <TradeTable trades={filtered} />
    <SignalLogTable signals={data.signals} />
  </div></AppLayout>;
}
