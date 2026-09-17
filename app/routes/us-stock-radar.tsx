/** @file 美股潛力雷達頁：顯示 4 小時經典吃大魚、量價候選、日線確認與研究績效。 */
import { useEffect, useMemo, useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { UsStockPerformancePanel } from '../features/usStockRadar/PerformancePanel';
import { formatTaipeiTime, UsStockObservationTable, UsStockRadarCard } from '../features/usStockRadar/RadarCards';
import { StockChartDrawer } from '../features/usStockRadar/StockChartDrawer';
import { loadUsStockRadar } from '../services/usStockRadar/loader.server';
import { isUsStockCandidate, US_STOCK_PHASE_LABELS,
  type UsStockSnapshot } from '../services/usStockRadar/types';

export const loader = loadUsStockRadar;

export default function UsStockRadarPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [filter, setFilter] = useState('candidates');
  const [search, setSearch] = useState('');
  const [chartSnapshot, setChartSnapshot] = useState<UsStockSnapshot | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && revalidator.state === 'idle') revalidator.revalidate();
    }, 60_000);
    return () => clearInterval(timer);
  }, [revalidator.revalidate, revalidator.state]);
  /** 休市時保留最後一輪有效收盤；最新 barTime 從快照推導，不把休市摘要當成空榜。 */
  const latestBarTime = useMemo(() => Math.max(0, ...data.snapshots.map(item => item.signal?.barTime ?? 0)), [data.snapshots]);
  const latest = data.snapshots.filter(item => item.signal?.barTime === latestBarTime);
  const candidates = latest.filter(item => isUsStockCandidate(item.signal!));
  const errors = data.snapshots.filter(item => item.error && item.checkedAt >= (data.run?.startedAt ?? 0));
  const shown = latest.filter(item => {
    const query = search.trim().toLowerCase();
    if (query && !`${item.symbol} ${item.name}`.toLowerCase().includes(query)) return false;
    if (filter === 'all') return true;
    if (filter === 'candidates') return isUsStockCandidate(item.signal!);
    if (filter === 'bigFish') return item.signal!.bigFish.entry;
    return item.signal!.phase === filter;
  }).sort((left, right) => right.signal!.score - left.signal!.score || left.symbol.localeCompare(right.symbol));
  return <AppLayout><div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-xs tracking-widest opacity-60">US STOCK WATCHLIST</p><h1 className="text-3xl font-bold">美股潛力雷達</h1>
        <p className="mt-3 text-sm opacity-75">4 小時經典吃大魚 · 日線趨勢確認 · SPY 相對強弱</p></div>
      <button className="rounded border border-current px-4 py-2 text-sm" disabled={revalidator.state !== 'idle'} onClick={() => revalidator.revalidate()}>
        {revalidator.state === 'idle' ? '更新畫面' : '讀取中…'}</button>
    </header>

    <section className="space-y-2 rounded-xl border border-black/15 bg-white/70 p-4 text-sm">
      <p><strong>經典吃大魚 2.0：</strong>4 小時 MACD（12／26／9）金叉且收盤 &gt; EMA200 × 0.98，或 Supertrend（ATR 10、係數 4）翻綠；再由已收盤日線 EMA20／50 確認多頭方向。</p>
      <p><strong>美股品質分析：</strong>動態掃描 Yahoo 當日漲幅與成交活躍榜，再檢查 4 小時放量突破、回踩續強、近 20 日相對 SPY 強弱及 RSI／MACD 動能。</p>
      <p><strong>硬風控：</strong>股價至少 2 美元、20 日平均成交額至少 2,000 萬美元；距 4 小時 EMA20 超過 3 ATR 或當日漲逾 15% 列為過熱。槓桿 ETF（例如 TSLL）仍有每日重置與波動耗損。</p>
      <p><strong>排程：</strong>{data.enabled ? '每 15 分鐘輕量檢查，僅在新 4 小時／收盤段完成時掃描' : '尚未啟用'}；休市不沿用舊 K 線產生新訊號。每輪最多十檔動態候選及一檔歷史補算。</p>
      <p><strong>Slack：</strong>{data.slackConfigured ? '已連接獨立美股頻道，新訊號會由耐久佇列補送。' : '分析已可運作；獨立美股頻道 ID 尚未設定，因此目前不會發送。'}</p>
      <p className="opacity-65">分數代表條件符合程度，不是上漲機率；系統只觀察公開收盤行情，不會自動下單。</p>
    </section>

    {data.error && <p role="alert" className="rounded border border-red-400 bg-red-50 p-4">{data.error}</p>}
    {data.run?.error && <p role="status" className={`rounded border p-4 text-sm ${data.run.skipped ? 'border-black/15 bg-white/50' : 'border-amber-400 bg-amber-50'}`}>{data.run.error}</p>}
    <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {[
        ['當前候選', candidates.length], ['經典吃大魚', candidates.filter(item => item.signal!.bigFish.entry).length],
        ['最新有效掃描', latest.length], ['動態合格池', data.run?.eligible ?? '—'], ['資料異常', errors.length],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-black/10 bg-white/60 p-4">
        <p className="text-xs opacity-65">{label}</p><strong className="mt-2 block text-2xl">{value}</strong></div>)}
    </section>
    {latestBarTime > 0 && <p className="text-xs opacity-60">最後有效 4 小時收盤：{formatTaipeiTime(latest.find(item => item.signal)?.signal?.closedAt ?? latestBarTime)}（台北）
      {data.run && ` · 本輪選取 ${data.run.selected} 檔、完成 ${data.run.scanned} 檔、失敗 ${data.run.failed} 檔`}</p>}

    <div className="flex flex-wrap justify-between gap-4">
      <div className="flex flex-wrap gap-2" aria-label="名單分類">{[
        ['candidates', '優先觀察'], ['bigFish', '經典吃大魚'], ['BREAKOUT', '放量突破'],
        ['RETEST', '回踩續強'], ['WATCH', '提前關注'], ['EXTENDED', '漲幅過熱'], ['all', '全部已掃描'],
      ].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}
        className={`rounded-full border border-black/20 px-3 py-2 text-sm ${filter === value ? 'bg-[#141414] text-white' : 'bg-white/50'}`}>{label}</button>)}</div>
      <input aria-label="搜尋美股" placeholder="搜尋股票，例如 TSLL" value={search} onChange={event => setSearch(event.target.value)}
        className="rounded border border-black/20 bg-white/70 px-3 py-2 text-sm" />
    </div>

    {shown.length ? <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shown.map(snapshot =>
      <li key={snapshot.symbol}><UsStockRadarCard snapshot={snapshot} onOpenChart={setChartSnapshot} /></li>)}</ul> :
      <div className="rounded-xl border border-dashed border-black/25 p-10 text-center"><h2 className="font-semibold">目前沒有符合此分類的最新美股</h2>
        <p className="mt-2 text-sm opacity-65">{latest.length ? '等待下一根已收盤 4 小時線出現新條件。' : '首次有效掃描會在下一個美股交易時段產生資料。'}</p></div>}
    {errors.length > 0 && <details className="rounded border border-red-500/40 p-4 text-sm"><summary className="cursor-pointer">資料抓取異常（{errors.length} 檔）</summary>
      <ul className="mt-3 space-y-2">{errors.map(item => <li key={item.symbol}>{item.symbol}：{item.error}</li>)}</ul></details>}

    <UsStockPerformancePanel observations={data.observations} />
    <section className="space-y-4 rounded-xl border border-black/15 bg-white/70 p-5"><h2 className="text-xl font-bold">入選後追蹤</h2>
      <UsStockObservationTable observations={data.observations} /></section>
    <StockChartDrawer snapshot={chartSnapshot} onClose={() => setChartSnapshot(null)} />
  </div></AppLayout>;
}

export { US_STOCK_PHASE_LABELS };
