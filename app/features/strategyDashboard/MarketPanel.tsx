/**
 * @file 單一市場面板：上方重用市場漲跌羅盤，下方列出目前值得關注的標的；
 * 點擊卡片開啟既有雷達的 K 線抽屜。面板切走時不卸載，因此篩選、抽屜與資料都會保留。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MacroMarketCompass } from '../home/components/MacroMarketCompass';
import { PotentialChartDrawer } from '../potentialRadar/PotentialChartDrawer';
import { TwStockChartDrawer } from '../twStockRadar/TwStockChartDrawer';
import { StockChartDrawer } from '../usStockRadar/StockChartDrawer';
import type { DashboardMarket, DashboardPick } from '../../services/strategyDashboard/types';
import { MARKET_LABELS } from './format';
import { Disclaimer, PanelStatus } from './PanelStatus';
import { PickCard } from './PickCard';
import { useDashboardPanel } from './useDashboardPanel';
import { WatchList } from './WatchList';

/** 各市場對應的完整雷達頁，供使用者查看全部掃描結果與入選追蹤。 */
const RADAR_LINKS: Record<DashboardMarket, { to: string; label: string }> = {
  TW: { to: '/tw-stock-radar', label: '台股潛力雷達' },
  US: { to: '/us-stock-radar', label: '美股潛力雷達' },
  CRYPTO: { to: '/potential-radar', label: '潛力幣雷達' },
};

type VerifiedFilter = 'all' | 'verified';
type ChartTarget = Pick<DashboardPick, 'stockSnapshot' | 'cryptoSnapshot'>;

export function MarketPanel({ market, active }: { market: DashboardMarket; active: boolean }) {
  const { panel, loading, error, lastSuccessAt, refresh } = useDashboardPanel(market, active);
  /** 被選取的快照只控制 K 線抽屜；候選卡與觀察清單共用同一個抽屜。 */
  const [chartPick, setChartPick] = useState<ChartTarget | null>(null);
  /** 只看已驗證：隱藏「未經回測驗證」的訊號；切換面板時保留選擇。 */
  const [verifiedFilter, setVerifiedFilter] = useState<VerifiedFilter>('all');
  /** 相對時間用的時鐘；每 30 秒更新，不觸發資料請求。 */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);

  const picks = (panel?.picks ?? []).filter(pick => verifiedFilter === 'all' || pick.validation.status !== 'UNVERIFIED');
  const unverifiedCount = (panel?.picks ?? []).filter(pick => pick.validation.status === 'UNVERIFIED').length;
  const radarLink = RADAR_LINKS[market];

  return <section aria-label={`${MARKET_LABELS[market]}面板`} className="space-y-4">
    <MacroMarketCompass market={market} />
    <PanelStatus panel={panel} loading={loading} error={error} lastSuccessAt={lastSuccessAt} now={now} onRefresh={refresh} />

    <div className="space-y-3 rounded-xl border border-black/15 bg-white/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">目前值得關注的{MARKET_LABELS[market]}</h2>
          <p className="text-xs opacity-65">
            {panel ? `本輪完成分析 ${panel.scannedCount} 檔，列出 ${panel.picks.length} 檔候選（其中 ${unverifiedCount} 檔未經回測驗證）` : '讀取中…'}
            ・<Link to={radarLink.to} className="underline">查看{radarLink.label}全部結果 →</Link></p>
        </div>
        <div className="flex gap-2 text-xs" role="group" aria-label="驗證篩選">
          {([['all', '全部候選'], ['verified', '只看已驗證']] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={verifiedFilter === value} onClick={() => setVerifiedFilter(value)}
              className={`rounded-full border px-3 py-1.5 ${verifiedFilter === value ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200' : 'border-black/20 bg-white/60'}`}>
              {label}</button>)}
        </div>
      </div>
      <Disclaimer />
      {panel && <details className="text-xs opacity-75"><summary className="cursor-pointer">訊號規則</summary>
        <p className="mt-1 leading-5">{panel.ruleSummary}</p></details>}

      {!panel && loading && <p className="rounded-xl border border-dashed border-black/25 p-8 text-center text-sm">
        正在讀取{MARKET_LABELS[market]}雷達結果；若需即時補算，首次可能需要 10–30 秒。</p>}
      {!panel && !loading && error && <p className="rounded-xl border border-dashed border-rose-500/60 p-8 text-center text-sm">
        無法取得{MARKET_LABELS[market]}清單：{error}</p>}
      {panel && picks.length > 0 && <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {picks.map((pick, index) => <li key={pick.symbol}>
          <PickCard pick={pick} rank={index + 1} now={now} onOpenChart={setChartPick} /></li>)}</ul>}
      {panel && !picks.length && <div className="rounded-xl border border-dashed border-black/25 p-8 text-center">
        <h3 className="font-semibold">目前沒有符合條件的{MARKET_LABELS[market]}</h3>
        <p className="mt-2 text-sm opacity-75">{verifiedFilter === 'verified' && panel.picks.length
          ? `有 ${panel.picks.length} 檔候選，但都尚未經過回測或足量入選追蹤驗證；切回「全部候選」可查看。`
          : panel.emptyReason}</p></div>}
      {panel && <WatchList items={panel.watchlist} open={!panel.picks.length} onOpenChart={setChartPick} />}

      {panel && panel.errors.length > 0 && <details className="rounded border border-rose-500/40 p-3 text-sm">
        <summary className="cursor-pointer">資料抓取異常（{panel.errors.length} 項）</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{panel.errors.map(item => <li key={item}>{item}</li>)}</ul></details>}
    </div>

    {market === 'TW' && <TwStockChartDrawer snapshot={chartPick?.stockSnapshot ?? null} onClose={() => setChartPick(null)} />}
    {market === 'US' && <StockChartDrawer snapshot={chartPick?.stockSnapshot ?? null} onClose={() => setChartPick(null)} />}
    {market === 'CRYPTO' && <PotentialChartDrawer snapshot={chartPick?.cryptoSnapshot ?? null} onClose={() => setChartPick(null)} />}
  </section>;
}
